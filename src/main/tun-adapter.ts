// ============================================================
// M3tr0VPN — гигиена wintun-адаптеров на Windows.
//
// Проблема (лог 2026-09-19): при переключении серверов xray убивается
// TerminateProcess-ом, а wintun-адаптер удаляется PnP-драйвером
// АСИНХРОННО (0.5–15 с, при живом QUIC/UDP-трафике дольше). Следующий
// xray стартует через пару секунд и падает с exit 23:
// «Failed to setup adapter (0xC0000035): Cannot create a file when
// that file already exists» — создание устройства наткнулось на
// недоудалённое. При этом Windows мог переименовать дубликат в
// «M3tr0VPN 2» (wintun.dll сам удаляет такие сироты — видели в логе).
//
// Решение:
//  1) после остановки ядра ЖДЁМ исчезновения адаптера (settle);
//  2) зависший — выкорчёвываем pnputil /remove-device;
//  3) ищем ШИРОКО: PnP-устройства с именем M3tr0VPN*/xray_tun*
//     (wildcard — ловит и «M3tr0VPN 2») + сетевые подключения с
//     такими же именами. Курсив «Wintun» в описании адаптера не
//     используем как единственный признак — чтобы не трогать
//     живые адаптеры WireGuard-клиента пользователя.
// TUN-режим всегда запущен от админа.
// ============================================================

import { execFile } from 'child_process'

/** Имена адаптеров, за которыми следим (наш + v2rayN-левовер) */
export const TUN_IFACES = ['M3tr0VPN', 'xray_tun'] as const
/** Должен совпадать с interface_name в singbox/config.ts и name в xray/config.ts */
export const TUN_IFACE: string = TUN_IFACES[0]

function psFilter(): string {
  // PnP-имена с wildcard: M3tr0VPN, M3tr0VPN 2, xray_tun, xray_tun 2 …
  return TUN_IFACES.map((n) => `Name LIKE '${n}%'`).join(' OR ')
}

function runPowerShell(script: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => resolve(err ? '' : stdout.toString())
    )
  })
}

/**
 * PnP-InstanceID найденных адаптеров. Ищем по ДВУМ подсистемам:
 *  - Win32_PnPEntity — имя УСТРОЙСТВА (M3tr0VPN*, xray_tun*);
 *  - Get-NetAdapter — имя ПОДКЛЮЧЕНИЯ (Windows мог переименовать
 *    дубликат в «M3tr0VPN 2» уже на уровне подключения).
 */
function findAdapterInstanceIds(): Promise<string[]> {
  const script = `
$ids = @()
foreach ($p in (Get-CimInstance Win32_PnPEntity -Filter "${psFilter()}" -ErrorAction SilentlyContinue)) {
  if ($p.PNPDeviceID) { $ids += $p.PNPDeviceID }
}
$names = @(${TUN_IFACES.map((n) => `'${n}*'`).join(',')})
foreach ($na in (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
  $n = $_.Name
  ($names | Where-Object { $n -like $_ }).Count -gt 0
})) {
  if ($na.PnPInstanceID) { $ids += $na.PnPInstanceID }
}
$ids | Select-Object -Unique
`
  return runPowerShell(script, 8000).then((out) =>
    out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  )
}

/**
 * Ждём в одном PowerShell-процессе, пока ВСЕ адаптеры исчезнут.
 * Возвращает true, если адаптеров нет (или исчезли за таймаут).
 */
function waitAdaptersGone(timeoutMs: number): Promise<boolean> {
  const script = `
function Test-AnyAdapter {
  foreach ($p in (Get-CimInstance Win32_PnPEntity -Filter "${psFilter()}" -ErrorAction SilentlyContinue)) {
    if ($p) { return $true }
  }
  $names = @(${TUN_IFACES.map((n) => `'${n}*'`).join(',')})
  foreach ($na in (Get-NetAdapter -ErrorAction SilentlyContinue)) {
    $n = $na.Name
    if (($names | Where-Object { $n -like $_ }).Count -gt 0) { return $true }
  }
  return $false
}
$deadline = (Get-Date).AddMilliseconds(${timeoutMs})
while ((Get-Date) -lt $deadline) {
  if (-not (Test-AnyAdapter)) { 'gone'; exit }
  Start-Sleep -Milliseconds 250
}
'stuck'
`
  return runPowerShell(script, timeoutMs + 6000).then((out) => out.trim() === 'gone')
}

/** Удалить устройство адаптера через pnputil (нужны права админа) */
function removeDevice(instanceId: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'pnputil',
      ['/remove-device', instanceId],
      { timeout: 10000, windowsHide: true },
      (err) => resolve(!err)
    )
  })
}

export type SettleResult = 'gone' | 'removed' | 'still-stuck' | 'skipped'

/**
 * Дождаться очистки адаптеров после остановки ядра (Windows).
 * Если адаптер завис — попробовать pnputil и подождать ещё.
 */
export async function settleTunAdapter(log?: (msg: string) => void): Promise<SettleResult> {
  if (process.platform !== 'win32') return 'skipped'
  // обычный путь: драйвер удаляет адаптер сам за 0.5–5 с
  // (wintun-запрос устройства внутри ядра висит до 15 с — берём
  // с запасом, чтобы не убить ядро посреди создания адаптера)
  if (await waitAdaptersGone(6000)) return 'gone'
  log?.(`tun adapter is stuck, removing device`)
  const ids = await findAdapterInstanceIds()
  for (const id of ids) {
    await removeDevice(id)
  }
  if (ids.length === 0) {
    // адаптер виден одной из подсистем, но instance-id не достали —
    // даём PnP ещё времени
    if (await waitAdaptersGone(5000)) return 'gone'
  } else if (await waitAdaptersGone(5000)) {
    log?.('stuck tun adapter removed')
    return 'removed'
  }
  log?.('tun adapter still present after removal attempt')
  return 'still-stuck'
}

/**
 * Подготовка к запуску TUN (Windows): если адаптер висит с прошлого
 * запуска — выкорчевать и дождаться исчезновения. Нет адаптера —
 * быстро возвращаемся (один CIM-запрос).
 */
export async function prepareTunStart(log?: (msg: string) => void): Promise<boolean> {
  if (process.platform !== 'win32') return true
  const ids = await findAdapterInstanceIds()
  if (ids.length === 0) return true
  log?.(`removing leftover tun adapter(s) before start`)
  for (const id of ids) {
    await removeDevice(id)
  }
  const ok = await waitAdaptersGone(8000)
  if (!ok) log?.('warning: tun adapter still present, trying to start anyway')
  return ok
}
