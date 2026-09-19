// ============================================================
// M3tr0VPN — динамический выбор портов ядер + уборка «осиротевших»
// процессов ядер после падения/убийства приложения.
//
// Почему: фиксированные порты (10808/10809) могут быть заняты —
// остаточным xray.exe от прошлого запуска, v2rayN (его порты по
// умолчанию совпадают) или исключённым диапазоном Hyper-V.
// Занятый порт = «failed to listen TCP on …» и мёртвое ядро.
// ============================================================

import net from 'net'
import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface CorePorts {
  /** socks-порт Xray (также сюда заворачивает TUN-трафик sing-box) */
  socks: number
  /** http-порт: системный прокси и mixed-инбаунд sing-box */
  http: number
  /** grpc API Xray (statsquery) */
  api: number
  /** clash-api sing-box (REST /connections для скоростей) */
  clash: number
}

/** Кандидаты socks-порта (mixed-инбаунд: socks+http на одном порту). 10808 первым — «как у людей». */
export const SOCKS_PORT_CANDIDATES: readonly number[] = [10808, 1080, 2080, 28080, 38080]
export const API_PORT_CANDIDATES: readonly number[] = [15490, 15491, 25490]
export const CLASH_PORT_CANDIDATES: readonly number[] = [9090, 9091, 19090]

/**
 * Все порты, которые мы могли включить в системный прокси.
 * Системный прокси указывает на mixed-порт (= socks-кандидат), но
 * старые сборки использовали http-порт (socks+1) — чиним оба.
 */
export function httpPortCandidates(): number[] {
  return SOCKS_PORT_CANDIDATES.flatMap((p) => [p, p + 1])
}

/** Проверка: порт свободен для прослушивания на 127.0.0.1? */
export function portFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer({ pauseOnConnect: true })
    srv.once('error', () => resolve(false))
    srv.once('listening', () => {
      srv.close(() => resolve(true))
    })
    srv.listen(port, host)
  })
}

async function pickFree(candidates: readonly number[]): Promise<number> {
  for (const port of candidates) {
    if (await portFree(port)) return port
  }
  // всё занято — просим у ОС любой свободный
  return new Promise((resolve, reject) => {
    const srv = net.createServer({ pauseOnConnect: true })
    srv.once('error', () => reject(new Error('no free port')))
    srv.once('listening', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.listen(0, '127.0.0.1')
  })
}

/** Случайный свободный порт из верхнего диапазона */
async function randomFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const cand = 20000 + Math.floor(Math.random() * 20000)
    if (await portFree(cand)) return cand
  }
  return new Promise((resolve, reject) => {
    const srv = net.createServer({ pauseOnConnect: true })
    srv.once('error', () => reject(new Error('no free port')))
    srv.once('listening', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.listen(0, '127.0.0.1')
  })
}

/**
 * Выделить свободный набор портов под ядра.
 * http = socks + 1 (если занят — любой свободный).
 */
export async function allocateCorePorts(): Promise<CorePorts> {
  let socks = -1
  for (const cand of SOCKS_PORT_CANDIDATES) {
    if ((await portFree(cand)) && (await portFree(cand + 1))) {
      socks = cand
      break
    }
  }
  if (socks === -1) {
    socks = await randomFreePort()
  }
  const http = (await portFree(socks + 1)) ? socks + 1 : await randomFreePort()
  const api = await pickFree(API_PORT_CANDIDATES)
  const clash = await pickFree(CLASH_PORT_CANDIDATES)
  return { socks, http, api, clash }
}

// ------------------------------------------------------------
// Уборка процессов ядер, оставшихся от прошлого запуска.
// Убиваем ТОЛЬКО процессы, чей exe лежит в нашем каталоге core.
// ------------------------------------------------------------

function listPidsLinux(coreDir: string): Promise<number[]> {
  return new Promise((resolve) => {
    let pids: number[] = []
    try {
      const entries = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))
      for (const pid of entries) {
        try {
          const link = fs.readlinkSync(path.join('/proc', pid, 'exe'))
          if (typeof link === 'string' && link.startsWith(coreDir)) pids.push(Number(pid))
        } catch {
          /* нет доступа — не наш процесс */
        }
      }
    } catch {
      /* /proc недоступен */
    }
    resolve(pids)
  })
}

function listPidsWindows(coreDir: string): Promise<number[]> {
  return new Promise((resolve) => {
    const ps = `
$dir = '${coreDir.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "Name='xray.exe' OR Name='sing-box.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) } |
  ForEach-Object { Write-Output $_.ProcessId }
`
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([])
        const pids = stdout
          .split(/\r?\n/)
          .map((l) => Number(l.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
        resolve(pids)
      }
    )
  })
}

function killPids(pids: number[]): void {
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(pid), '/F', '/T'], { timeout: 5000, windowsHide: true }, () => undefined)
      } else {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* уже мёртв */
        }
      }
    } catch {
      /* best effort */
    }
  }
}

/** Убить процессы ядер из нашего каталога (возврат: список PID). */
export async function killStaleCores(coreDir: string): Promise<number[]> {
  const pids =
    process.platform === 'win32' ? await listPidsWindows(coreDir) : await listPidsLinux(coreDir)
  if (pids.length > 0) killPids(pids)
  return pids
}
