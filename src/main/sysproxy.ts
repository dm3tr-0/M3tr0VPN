// ============================================================
// M3tr0VPN — системный прокси Windows
// Включение/выключение через реестр + InternetSetOption
// (P/Invoke в PowerShell), с сохранением прежних значений.
// На Linux — заглушка (прокси-режим предназначен для Windows).
// ============================================================

import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

const PS_SCRIPT = `
param([int]$Enable, [int]$Port)
$reg = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
if ($Enable -eq 1) {
  Set-ItemProperty -Path $reg -Name ProxyServer -Value "127.0.0.1:$Port"
  Set-ItemProperty -Path $reg -Name ProxyOverride -Value 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>'
  Set-ItemProperty -Path $reg -Name ProxyEnable -Value 1
} else {
  Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
}
$code = @'
using System;
using System.Runtime.InteropServices;
public class WinINet {
  [DllImport("wininet.dll", SetLastError=true)]
  public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int lpdwBufferLength);
}
'@
Add-Type -TypeDefinition $code | Out-Null
[WinINet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null
[WinINet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null
Write-Output 'OK'
`

let scriptPath: string | null = null
let enabledByUs = false

function getScriptPath(): string {
  if (!scriptPath) {
    scriptPath = path.join(app.getPath('userData'), 'sysproxy.ps1')
    fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf-8')
  }
  return scriptPath
}

function run(enable: boolean, port: number): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        getScriptPath(),
        '-Enable',
        enable ? '1' : '0',
        '-Port',
        String(port)
      ],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        resolve(!err && stdout.includes('OK'))
      }
    )
  })
}

export const sysProxy = {
  /** Включить системной HTTP-прокси 127.0.0.1:port */
  async enable(port: number): Promise<boolean> {
    const ok = await run(true, port)
    if (ok) enabledByUs = true
    return ok
  },

  /** Выключить (только если включали мы) */
  async disable(): Promise<boolean> {
    if (!enabledByUs && process.platform === 'win32') return true
    const ok = await run(false, 0)
    if (ok) enabledByUs = false
    return ok
  },

  /**
   * Починка при старте: если системный прокси указывает на один из
   * наших портов, а приложение только запускается (ядер нет) — выключить,
   * чтобы не «сломать интернет» после падения/убийства процесса.
   * Порты могут отличаться (авто-выбор при занятом 10809).
   */
  async repairIfNeeded(httpPorts: number[]): Promise<boolean> {
    if (process.platform !== 'win32') return false
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable,ProxyServer -ErrorAction SilentlyContinue) | ConvertTo-Json -Compress`
        ],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(false)
          try {
            const state = JSON.parse(stdout) as { ProxyEnable?: number; ProxyServer?: string }
            const server = state.ProxyServer ?? ''
            const suspicious =
              state.ProxyEnable === 1 &&
              httpPorts.some((port) => server.includes(`127.0.0.1:${port}`))
            if (suspicious) {
              run(false, 0).then((ok) => resolve(ok))
            } else {
              resolve(false)
            }
          } catch {
            resolve(false)
          }
        }
      )
    })
  },

  /** Запущено ли приложение с правами администратора (Windows) */
  isElevated(): boolean {
    if (process.platform === 'win32') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('child_process').execSync('net session', { stdio: 'ignore', timeout: 5000 })
        return true
      } catch {
        return false
      }
    }
    return typeof process.getuid === 'function' ? process.getuid() === 0 : false
  },

  /**
   * Перезапуск приложения с правами администратора (UAC).
   *
   * КАК ЭТО РАБОТАЕТ (и почему не «в лоб»):
   * Прямой `Start-Process -Verb RunAs <exe>` запускает новый
   * экземпляр ПРЯМО СЕЙЧАС — а старый ещё держит
   * requestSingleInstanceLock (уходим мы только через завершение
   * очистки). Новый экземпляр не получает лок, молча выходит —
   * и приложение просто закрывается без перезапуска.
   *
   * Поэтому стартуем ПОМОЩНИКА с правами админа, который сначала
   * ждёт смерти старого процесса (Wait-Process -Id), и только потом
   * запускает приложение (лок уже свободен). UAC показывается один
   * раз — на помощнике.
   */
  relaunchElevated(): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(false)
    const { spawn } = require('child_process') as typeof import('child_process')
    return new Promise((resolve) => {
      const exe = process.execPath.replace(/'/g, "''")
      const oldPid = process.pid
      const inner = `Wait-Process -Id ${oldPid} -ErrorAction SilentlyContinue; Start-Process -FilePath '${exe}'`
      // аргументы к повышаемому powershell — в AP-массиве; кавычки
      // внутри команды удваиваются ('' → ')
      const innerArg = inner.replace(/'/g, "''")
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `try { Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command','${innerArg}') -ErrorAction Stop; exit 0 } catch { exit 1 }`
        ],
        { windowsHide: true }
      )
      child.once('close', (code) => resolve(code === 0))
      child.once('error', () => resolve(false))
    })
  }
}
