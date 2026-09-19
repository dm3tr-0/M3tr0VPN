// ============================================================
// M3tr0VPN — регистрация IPC-обработчиков
// ============================================================

import { BrowserWindow, dialog, shell, app, clipboard, ipcMain, nativeImage } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import jsQR from 'jsqr'
import type { AppSettings, LogEntry, ServerProfile, SpeedTick } from '@shared/types'
import { OVERRIDABLE_PROTOCOLS, effectiveCore, type Protocol } from '@shared/types'
import type { ManualServerInput, Result } from '@shared/ipc-api'
import type { Store } from './store'
import { VpnController } from './vpn'
import { xray, appLogFile } from './xray/manager'
import { singbox, singboxConfigFile } from './singbox/manager'
import { coreConfigPath } from './xray/paths'
import { sysProxy } from './sysproxy'
import { parseShareLink } from './uri'
import { addSubscription, refreshSubscription } from './subscriptions'
import { detectCountry } from './uri'
import { testAllServers, testAllServersTcp, isLatencyTestRunning } from './latency'

const ok = <T>(data?: T): Result<T> => ({ ok: true, data })
const fail = (error: string, extra?: { needsElevation?: boolean }): Result<never> => ({
  ok: false,
  error,
  ...extra
})

export interface IpcDeps {
  getWindow: () => BrowserWindow | null
  store: Store
  vpn: VpnController
  quitApp: () => void
}

function validDomains(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined
  return list.map((d) => String(d).trim().toLowerCase()).filter((d) => d.length > 0)
}

/** Журнал: подписка + ссылки «Сайт»/«Поддержка» из 3x-ui, если заданы */
function logSubscriptionMeta(prefix: string, sub: { name: string; websiteUrl?: string | null; supportUrl?: string | null }): void {
  const extra = [
    sub.websiteUrl ? `website: ${sub.websiteUrl}` : null,
    sub.supportUrl ? `support: ${sub.supportUrl}` : null
  ]
    .filter(Boolean)
    .join(' · ')
  xray.pushLog('info', 'app', `${prefix}: ${sub.name}${extra ? ` (${extra})` : ''}`)
}

export function registerIpc(deps: IpcDeps): { snapshotState: () => void } {
  const { store, vpn } = deps
  const win = (): BrowserWindow | null => deps.getWindow()

  const buildSnapshot = (withLogs = false) => ({
    servers: store.servers,
    subscriptions: store.subscriptions,
    appRules: store.appRules,
    settings: store.settings,
    status: vpn.getStatus(),
    logs: withLogs ? [...xray.getLogs(), ...singbox.getLogs()].sort((a, b) => a.t - b.t) : [],
    coreVersion: '…',
    singboxVersion: '…',
    appVersion: app.getVersion(),
    platform: process.platform,
    isElevated: sysProxy.isElevated(),
    transportAvailable: { tun: true }
  })

  const snapshotState = (): void => {
    const w = win()
    if (w && !w.isDestroyed()) {
      w.webContents.send('m3tr0:state-changed', buildSnapshot())
    }
  }

  // ---------- окно ----------
  ipcMain.on('m3tr0:window-minimize', () => win()?.minimize())
  ipcMain.on('m3tr0:window-maximize', () => {
    const w = win()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('m3tr0:window-close', () => win()?.close())
  ipcMain.handle('m3tr0:window-is-maximized', () => win()?.isMaximized() ?? false)

  // ---------- состояние ----------
  ipcMain.handle('m3tr0:get-state', async () => {
    const snap = buildSnapshot(true)
    snap.coreVersion = await xray.coreVersion()
    snap.singboxVersion = await singbox.coreVersion()
    return snap
  })

  // ---------- соединение ----------
  ipcMain.handle('m3tr0:connect', async () => {
    xray.pushLog('info', 'app', 'user action: connect')
    const res = await vpn.connect()
    return res.ok ? ok() : fail(res.error ?? 'connect failed', { needsElevation: res.needsElevation })
  })

  ipcMain.handle('m3tr0:disconnect', async () => {
    xray.pushLog('info', 'app', 'user action: disconnect')
    await vpn.disconnect()
    return ok()
  })

  // ---------- серверы ----------
  ipcMain.handle('m3tr0:add-server-uri', (_e, uri: string) => {
    const parsed = parseShareLink(uri)
    if (!parsed.ok) return fail(parsed.error)
    store.addServer(parsed.profile)
    return ok(parsed.profile)
  })

  ipcMain.handle('m3tr0:add-server-manual', (_e, input: ManualServerInput) => {
    if (!input.address || !input.port || !input.uuid) return fail('missing fields')
    const name = input.name || `${input.address}:${input.port}`
    const profile: ServerProfile = {
      id: randomUUID(),
      name,
      protocol: input.protocol,
      address: input.address,
      port: input.port,
      country: detectCountry(name),
      uuid: input.uuid,
      method: input.method,
      flow: input.flow,
      stream: input.stream,
      latencyMs: null,
      latencyError: null,
      load: 0,
      subscriptionId: null,
      subscriptionName: null,
      createdAt: new Date().toISOString()
    }
    store.addServer(profile)
    return ok(profile)
  })

  ipcMain.handle('m3tr0:update-server', (_e, { id, patch }: { id: string; patch: Partial<ServerProfile> }) => {
    const updated = store.updateServer(id, patch)
    return updated ? ok() : fail('not found')
  })

  ipcMain.handle('m3tr0:delete-server', (_e, id: string) => {
    store.deleteServer(id)
    if (vpn.getStatus().serverId === id && vpn.getStatus().state === 'connected') {
      void vpn.disconnect()
    }
    return ok()
  })

  ipcMain.handle('m3tr0:select-server', (_e, id: string) => {
    const target = store.servers.find((s) => s.id === id)
    if (!target) return fail('not found')
    const prev = store.settings.selectedServerId
    store.patchSettings({ selectedServerId: id })
    if (prev !== id) {
      xray.pushLog('info', 'app', `user action: server selected: ${target.protocol} ${target.name}`)
    }
    if (prev !== id && (vpn.getStatus().state === 'connected' || vpn.getStatus().state === 'connecting')) {
      void vpn.restartCore()
    }
    return ok()
  })

  // ---------- замер пинга ----------
  // Real delay — главная кнопка: «Test real delay» из v2rayN 1:1 — одно
  // ядро со всеми серверами, 2 запроса на сервер (второй по тёплому
  // соединению), минимум; упавшие перетестируются. TCP-пинг — в меню.
  ipcMain.handle('m3tr0:test-latency-real', async () => {
    const servers = store.servers
    if (servers.length === 0) return ok(store.servers)
    if (isLatencyTestRunning()) return ok(store.servers)
    xray.pushLog('info', 'app', `user action: latency test started (${servers.length} servers, real)`)
    await testAllServers(servers, store.settings, (server, outcome) => {
      store.updateServer(server.id, {
        latencyMs: outcome.latencyMs,
        latencyError: outcome.error
      })
      xray.pushLog(
        outcome.latencyMs != null ? 'info' : 'warn',
        'app',
        `latency(real): ${server.protocol} ${server.name} → ${
          outcome.latencyMs != null ? `${outcome.latencyMs} ms` : `failed (${outcome.error ?? 'unknown'})`
        }`
      )
    })
    return ok(store.servers)
  })

  // ---------- TCP-пинг (Tcping из v2rayN — пункт меню) ----------
  // DNS → первый адрес, один коннект, 5 с. UDP-протоколы (hy2/awg/…)
  // пингуются по TCP-порту того же хоста из подписки; «молчащие»
  // порты — сквозной замер одиночным временным ядром.
  ipcMain.handle('m3tr0:test-latency', async () => {
    const servers = store.servers
    if (servers.length === 0) return ok(store.servers)
    if (isLatencyTestRunning()) return ok(store.servers)
    xray.pushLog('info', 'app', `user action: latency test started (${servers.length} servers, tcp)`)
    await testAllServersTcp(servers, store.settings, (server, outcome) => {
      store.updateServer(server.id, {
        latencyMs: outcome.latencyMs,
        latencyError: outcome.error
      })
      // «refused» = сервер активен, но порт ЗАКРЫТ: почти всегда
      // inbound выключен/не поднялся в панели 3x-ui (не клиентская
      // проблема) — подсказываем прямо в журнале
      const hint =
        outcome.latencyMs == null && outcome.error === 'refused'
          ? ' — порт закрыт на сервере, проверьте inbound в панели 3x-ui'
          : ''
      xray.pushLog(
        outcome.latencyMs != null ? 'info' : 'warn',
        'app',
        `latency(tcp): ${server.protocol} ${server.name} → ${
          outcome.latencyMs != null ? `${outcome.latencyMs} ms` : `failed (${outcome.error ?? 'unknown'})`
        }${hint}`
      )
    })
    return ok(store.servers)
  })

  // ---------- подписки ----------
  ipcMain.handle('m3tr0:add-subscription', async (_e, { name, url }: { name: string; url: string }) => {
    try {
      const res = await addSubscription(store, name, url)
      if (res.ok && res.subscription) {
        logSubscriptionMeta('subscription added', res.subscription)
      }
      return res.ok ? ok(res.subscription) : fail(res.error ?? 'fetch failed')
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'fetch failed')
    }
  })

  ipcMain.handle('m3tr0:refresh-subscription', async (_e, id: string) => {
    try {
      const res = await refreshSubscription(store, id)
      if (res.ok && res.subscription) {
        logSubscriptionMeta('subscription updated', res.subscription)
      }
      return res.ok ? ok(res.subscription) : fail(res.error ?? 'fetch failed')
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'fetch failed')
    }
  })

  ipcMain.handle('m3tr0:delete-subscription', (_e, id: string) => {
    store.deleteSubscription(id)
    if (
      vpn.getStatus().state === 'connected' &&
      !store.servers.some((s) => s.id === store.settings.selectedServerId)
    ) {
      void vpn.disconnect()
    }
    return ok()
  })

  // ---------- приложения-исключения ----------
  // Изменение правил туннелирования ПРИ ЖИВОМ ПОДКЛЮЧЕНИИ — ядра
  // конфигурируются на старте, поэтому переконфигурируем их
  // автоматически (с дебаунсом на серию быстрых переключений).
  let rulesRestartTimer: NodeJS.Timeout | null = null
  const scheduleRulesRestart = (reason: string): void => {
    const st = vpn.getStatus().state
    if (st !== 'connected' && st !== 'connecting') return
    if (rulesRestartTimer) clearTimeout(rulesRestartTimer)
    rulesRestartTimer = setTimeout(() => {
      rulesRestartTimer = null
      const st2 = vpn.getStatus().state
      if (st2 === 'connected' || st2 === 'connecting') {
        xray.pushLog('info', 'app', `routing rules changed (${reason}); rebuilding connection…`)
        void vpn.restartCore()
      }
    }, 800)
  }

  ipcMain.handle('m3tr0:add-app', (_e, input: { appId: string; appName: string; icon: string }) => {
    if (!input.appId.trim()) return fail('empty process name')
    if (store.appRules.some((r) => r.appId.toLowerCase() === input.appId.trim().toLowerCase())) {
      return fail('duplicate')
    }
    const rule = {
      id: randomUUID(),
      appId: input.appId.trim(),
      appName: input.appName || input.appId.trim(),
      icon: input.icon || 'app-window',
      enabled: true
    }
    store.addApp(rule)
    scheduleRulesRestart('app added')
    return ok(rule)
  })

  ipcMain.handle('m3tr0:update-app', (_e, { id, patch }: { id: string; patch: { enabled?: boolean } }) => {
    const updated = store.updateApp(id, patch)
    if (updated) scheduleRulesRestart(patch.enabled !== undefined ? 'app toggled' : 'app updated')
    return updated ? ok() : fail('not found')
  })

  ipcMain.handle('m3tr0:delete-app', (_e, id: string) => {
    store.deleteApp(id)
    scheduleRulesRestart('app removed')
    return ok()
  })

  // ---------- настройки ----------
  ipcMain.handle('m3tr0:update-settings', async (_e, patch: Partial<AppSettings>) => {
    const normalized: Partial<AppSettings> = { ...patch }
    const domains = validDomains(patch.selectedDomains)
    if (domains) normalized.selectedDomains = domains
    if (patch.language && patch.language !== 'ru' && patch.language !== 'en') delete normalized.language
    if (patch.transportMode && patch.transportMode !== 'proxy' && patch.transportMode !== 'tun') {
      delete normalized.transportMode
    }
    // «Ядро для протокола» (как CoreTypeItem в v2rayN): валидный набор
    if (patch.coreOverrides !== undefined) {
      const clean: Partial<Record<Protocol, 'xray' | 'singbox'>> = {}
      const raw = patch.coreOverrides as Record<string, unknown> | undefined
      if (raw && typeof raw === 'object') {
        for (const proto of OVERRIDABLE_PROTOCOLS) {
          const v = raw[proto]
          if (v === 'xray' || v === 'singbox') {
            if (v === 'singbox') clean[proto] = v // xray — дефолт, не храним
          }
        }
      }
      normalized.coreOverrides = clean
    }

    const wantsTun = normalized.transportMode === 'tun'
    if (wantsTun && !sysProxy.isElevated()) {
      // сохраняем настройку, но ядро не перезапускаем — нужны права
      store.patchSettings(normalized)
      return { ok: true, needsElevation: true }
    }

    const needsRestart = VpnController.needsCoreRestart(normalized)
    store.patchSettings(normalized)

    if (patch.launchAtStartup !== undefined) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtStartup })
    }

    if (needsRestart && (vpn.getStatus().state === 'connected' || vpn.getStatus().state === 'connecting')) {
      const res = await vpn.restartCore()
      if (!res.ok) return fail(res.error ?? 'restart failed', { needsElevation: res.needsElevation })
    }
    return ok()
  })

  // ---------- конфиг ядра ----------
  ipcMain.handle('m3tr0:show-config', () => {
    const server = store.selectedServer()
    if (!server) return fail('no server selected')
    const settings = store.settings
    const appRules = store.appRules
    const mode = settings.transportMode
    const ports = xray.ports
    const configs: Array<{ name: string; config: Record<string, unknown> }> = []

    if (effectiveCore(server, settings.coreOverrides) === 'singbox') {
      configs.push({
        name: 'sing-box — config.json',
        config: singbox.buildConfig({
          server,
          settings,
          appRules,
          mode,
          role: vpn.currentSingboxRole() ?? (mode === 'proxy' ? 'proxy' : 'tun-direct'),
          ports
        })
      })
    } else {
      // Конфиг Xray: в TUN-режиме включает нативный tun-инбаунд
      configs.push({
        name: 'Xray — config.json',
        config: xray.buildConfig({ server, settings, appRules, mode, ports })
      })
    }
    return ok({ configs })
  })

  ipcMain.handle('m3tr0:export-config', async () => {
    const w = win()
    if (!w) return fail('no window')
    const server = store.selectedServer()
    if (!server) return fail('no server selected')
    const settings = store.settings
    const appRules = store.appRules
    const mode = settings.transportMode
    const ports = xray.ports

    const targets: Array<{ file: string; write: () => void }> = []
    if (effectiveCore(server, settings.coreOverrides) === 'singbox') {
      targets.push({
        file: 'sing-box-config.json',
        write: () => {
          fs.writeFileSync(
            singboxConfigFile(),
            JSON.stringify(
              singbox.buildConfig({
                server,
                settings,
                appRules,
                mode,
                role: vpn.currentSingboxRole() ?? (mode === 'proxy' ? 'proxy' : 'tun-direct'),
                ports
              }),
              null,
              2
            ),
            'utf-8'
          )
        }
      })
    } else {
      targets.push({
        file: 'config.json',
        write: () => {
          xray.writeConfig({ server, settings, appRules, mode, ports })
        }
      })
    }

    const target = dialog.showSaveDialogSync(w, {
      defaultPath: targets[0].file,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (!target) return fail('cancelled')
    try {
      for (const t of targets) {
        t.write()
      }
      // первый файл — по выбранному пути, второй — рядом
      if (targets.length === 2) {
        fs.copyFileSync(singboxConfigFile(), target.replace(/\.json$/, '-singbox.json'))
      }
      fs.copyFileSync(targets[0].file === 'config.json' ? coreConfigPath() : singboxConfigFile(), target)
      return ok(target)
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'write failed')
    }
  })

  // ---------- журнал ----------
  ipcMain.handle('m3tr0:get-logs', () =>
    [...xray.getLogs(), ...singbox.getLogs()].sort((a, b) => a.t - b.t)
  )
  ipcMain.handle('m3tr0:clear-logs', () => {
    xray.clearLogs()
    singbox.clearLogs()
    return ok()
  })
  ipcMain.handle('m3tr0:open-logs-folder', () => {
    const dir = path.dirname(appLogFile())
    fs.mkdirSync(dir, { recursive: true })
    // Последний лог-файл (гарантируем наличие)
    if (!fs.existsSync(appLogFile())) fs.writeFileSync(appLogFile(), '', 'utf-8')
    void shell.openPath(dir)
    return ok()
  })
  ipcMain.handle('m3tr0:open-external', (_e, url: string) => {
    // Разрешаем только безопасные схемы: http(s), mailto (поддержка 3x-ui),
    // tg: и мессенджеры. file:// и прочее — блокируем.
    if (/^(https?|mailto|tg|slack|discord|skype):/i.test(url) && url.length <= 512) {
      void shell.openExternal(url)
    }
    return ok()
  })

  // ---------- QR из буфера обмена ----------
  ipcMain.handle('m3tr0:scan-qr-clipboard', async () => {
    try {
      // Electron 44: асинхронный W3C-стиль clipboard API
      const items = await clipboard.read()
      let blob: Blob | null = null
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'))
        if (imgType) {
          blob = (await item.getType(imgType)) as Blob
          break
        }
      }
      if (!blob) return fail('no image in clipboard')
      const buf = Buffer.from(await blob.arrayBuffer())
      const image = nativeImage.createFromBuffer(buf)
      const size = image.getSize()
      if (!size.width || !size.height) return fail('empty image')
      const bitmap = image.toBitmap()
      const decoded = jsQR(
        new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength),
        size.width,
        size.height
      )
      if (!decoded || !decoded.data) return fail('no QR code found')
      return ok(decoded.data)
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'scan failed')
    }
  })

  // ---------- перезапуск с правами администратора ----------
  ipcMain.handle('m3tr0:relaunch-elevated', async () => {
    const granted = await sysProxy.relaunchElevated()
    if (granted) {
      setTimeout(() => deps.quitApp(), 400)
      return ok()
    }
    return fail('elevation declined')
  })

  ipcMain.handle('m3tr0:quit-app', () => {
    deps.quitApp()
    return ok()
  })

  // ---------- события наружу ----------
  store.on('changed', snapshotState)
  vpn.on('status', snapshotState)

  // Поток журнала и скоростей в renderer (оба ядра)
  const forwardLog = (entry: LogEntry): void => {
    const w = win()
    if (w && !w.isDestroyed()) w.webContents.send('m3tr0:log', entry)
  }
  xray.on('log', forwardLog)
  singbox.on('log', forwardLog)
  const forwardStats = (tick: SpeedTick): void => {
    const w = win()
    if (w && !w.isDestroyed()) w.webContents.send('m3tr0:stats', tick)
  }
  xray.on('stats', forwardStats)
  singbox.on('stats', forwardStats)

  return { snapshotState }
}
