// ============================================================
// M3tr0VPN — менеджер процесса sing-box.
// Запуск/остановка, готовность по clash-api (GET /version),
// журнал, статистика скоростей через REST GET /connections
// (uploadTotal/downloadTotal → дельты за интервал).
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import { app } from 'electron'
import type { AppRule, AppSettings, LogEntry, ServerProfile, SpeedTick, TransportMode } from '@shared/types'
import type { CorePorts } from '../ports'
import { buildSingboxConfig, type SingboxRole, type SingboxStartInput } from './config'
import { coreDir } from '../xray/paths'
import { settleTunAdapter } from '../tun-adapter'

const STATS_INTERVAL_MS = 2000
/** TUN (вкл. AmneziaWG) открывает wintun-интерфейс до 10+ с —
 * «open interface take too much time to finish!» в логах; 12с не
 * хватало, ядро убивалось на полпути. Даём 20с (как xray). */
const READY_TIMEOUT_MS = 20000

export type { SingboxStartInput }

function singboxBinary(): string {
  return path.join(coreDir(), process.platform === 'win32' ? 'sing-box.exe' : 'sing-box')
}

/** Конфиг кладём в userData (единое место с xray-конфигом) */
function configTarget(): string {
  const dir = path.join(app.getPath('userData'), 'singbox')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'config.json')
}

/** Ждём, пока clash-api ответит на GET /version */
async function waitClashApi(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/version`, {
        signal: AbortSignal.timeout(1000)
      })
      if (res.ok) return
    } catch {
      /* ещё не готов */
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`sing-box did not open clash-api on port ${port} within ${timeoutMs / 1000}s`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

export class SingBoxManager extends EventEmitter {
  private proc: ChildProcess | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private logBuffer: LogEntry[] = []
  private totals = { down: 0, up: 0 }
  private lastCum = { down: -1, up: -1 }
  private versionCache: string | null = null
  private starting = false
  private lastPorts: CorePorts | null = null
  private recentErrors: string[] = []
  /** Роль последнего запуска — нужна для очистки TUN-адаптера при stop() */
  private lastRole: SingboxRole | null = null
  /** Процесс, успешно прошедший фазу старта (см. комментарий в XrayManager):
   * смерть до готовности — это reject в start() и retry контроллера,
   * а не «авария» с emergencyStop. */
  private readyProc: ChildProcess | null = null

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  get ports(): CorePorts | null {
    return this.lastPorts
  }

  /** Последняя роль ('proxy' | 'tun-direct' | null) */
  get role(): SingboxRole | null {
    return this.lastRole
  }

  pushLog(level: LogEntry['level'], source: LogEntry['source'], message: string): void {
    this.logBuffer.push({ t: Date.now(), level, source, message })
    if (this.logBuffer.length > 600) this.logBuffer.splice(0, this.logBuffer.length - 600)
    this.emit('log', this.logBuffer[this.logBuffer.length - 1])
  }

  getLogs(): LogEntry[] {
    return this.logBuffer
  }

  clearLogs(): void {
    this.logBuffer = []
    this.emit('logs-cleared')
  }

  async coreVersion(): Promise<string> {
    if (this.versionCache) return this.versionCache
    return new Promise((resolve) => {
      try {
        const p = spawn(singboxBinary(), ['version'], { windowsHide: true, cwd: coreDir() })
        let out = ''
        p.stdout?.on('data', (d) => (out += d.toString()))
        p.on('error', () => resolve('sing-box'))
        p.on('close', () => {
          const m = out.match(/sing-box version (\S+)/)
          this.versionCache = m ? `sing-box ${m[1]}` : 'sing-box'
          resolve(this.versionCache)
        })
      } catch {
        resolve('sing-box')
      }
    })
  }

  /** Сгенерировать и вернуть объект конфига (диалог «config.json») */
  buildConfig(input: SingboxStartInput): Record<string, unknown> {
    return buildSingboxConfig(input)
  }

  private lastErrorText(): string {
    return this.recentErrors.slice(-3).join(' | ')
  }

  async start(input: SingboxStartInput): Promise<void> {
    if (this.starting) throw new Error('sing-box is already starting')
    if (this.running) await this.stop()

    this.starting = true
    this.recentErrors = []
    this.lastRole = input.role
    try {
      const config = buildSingboxConfig(input)
      const cfgPath = configTarget()
      fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')
      this.lastPorts = input.ports
      this.totals = { down: 0, up: 0 }
      this.lastCum = { down: -1, up: -1 }
      this.pushLog(
        'info',
        'app',
        `sing-box starting: ${input.server.protocol} → ${input.server.address}:${input.server.port} [${input.role}]`
      )

      const child = spawn(singboxBinary(), ['run', '-c', cfgPath], {
        windowsHide: true,
        cwd: coreDir()
      })
      this.proc = child

      child.stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
          this.pushLog(parseLevel(line), 'core', line)
          if (/fatal|error/i.test(line)) {
            this.recentErrors.push(line)
            if (this.recentErrors.length > 6) this.recentErrors.shift()
          }
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
          this.pushLog('error', 'core', line)
          this.recentErrors.push(line)
          if (this.recentErrors.length > 6) this.recentErrors.shift()
        }
      })
      child.on('exit', (code, signal) => {
        const wasRunning = this.proc === child
        const wasReady = this.readyProc === child
        this.proc = null
        if (wasReady) this.readyProc = null
        this.stopStatsTimer()
        if (wasRunning && code !== null && code !== 0) {
          this.pushLog('error', 'core', `sing-box exited with code ${code}`)
        }
        // Ядро умерло ДО готовности — это ошибка start() (и retry),
        // а не неожиданная авария работающего подключения
        if (wasReady) this.emit('exit', code, signal)
      })
      child.on('error', (err) => {
        this.pushLog('error', 'app', `failed to spawn sing-box: ${err.message}`)
      })

      // Готовность: clash-api отвечает ИЛИ процесс умер (с текстом ошибки)
      const exited = new Promise<never>((_resolve, reject) => {
        child.once('exit', (code) => {
          reject(new Error(this.lastErrorText() || `sing-box exited with code ${code}`))
        })
      })
      await Promise.race([waitClashApi(input.ports.clash, READY_TIMEOUT_MS), exited])
      this.readyProc = child
      this.pushLog('info', 'core', 'sing-box started')
      this.startStatsTimer()
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    this.stopStatsTimer()
    const child = this.proc
    const hadTun = this.lastRole === 'tun-direct'
    if (!child) {
      // Процесс не жил — но после падения адаптер мог остаться висеть
      if (hadTun && process.platform === 'win32') {
        await settleTunAdapter((msg) => this.pushLog('warn', 'app', msg))
      }
      return
    }
    this.proc = null
    this.readyProc = null
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already dead */
        }
        resolve()
      }, 1500)
      child.once('exit', () => {
        clearTimeout(killTimer)
        resolve()
      })
      try {
        child.kill()
      } catch {
        clearTimeout(killTimer)
        resolve()
      }
    })
    // wintun-адаптер удаляется драйвером асинхронно: ждём его исчезновения,
    // иначе следующий запуск sing-box зависнет на «open interface take
    // too much time» (адаптер с тем же именем/IP ещё жив)
    if (hadTun && process.platform === 'win32') {
      await settleTunAdapter((msg) => this.pushLog('warn', 'app', msg))
    }
    this.pushLog('info', 'app', 'sing-box stopped')
  }

  private startStatsTimer(): void {
    this.stopStatsTimer()
    this.pollStats()
    this.statsTimer = setInterval(() => this.pollStats(), STATS_INTERVAL_MS)
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
  }

  /** GET /connections → дельты кумулятивных счётчиков = скорости */
  private async pollStats(): Promise<void> {
    if (!this.running || !this.lastPorts) return
    try {
      const res = await fetch(`http://127.0.0.1:${this.lastPorts.clash}/connections`, {
        signal: AbortSignal.timeout(1500)
      })
      if (!res.ok) return
      const data = (await res.json()) as { uploadTotal?: number; downloadTotal?: number }
      const up = typeof data.uploadTotal === 'number' ? data.uploadTotal : 0
      const down = typeof data.downloadTotal === 'number' ? data.downloadTotal : 0
      if (this.lastCum.down < 0) {
        // первый опрос — базовая точка
        this.lastCum = { down, up }
        return
      }
      const dDown = Math.max(0, down - this.lastCum.down)
      const dUp = Math.max(0, up - this.lastCum.up)
      this.lastCum = { down, up }
      this.totals.down += dDown
      this.totals.up += dUp
      const tick: SpeedTick = {
        down: dDown / (STATS_INTERVAL_MS / 1000),
        up: dUp / (STATS_INTERVAL_MS / 1000),
        totalDown: this.totals.down,
        totalUp: this.totals.up
      }
      this.emit('stats', tick)
    } catch {
      /* ядро перезапускается — пропускаем тик */
    }
  }
}

function parseLevel(line: string): LogEntry['level'] {
  if (/\b(FATAL|ERROR)\b/i.test(line)) return 'error'
  if (/\bWARN\b/i.test(line)) return 'warn'
  return 'info'
}

/** Единый инстанс на приложение */
export const singbox = new SingBoxManager()

/** Путь к файлу конфигурации sing-box (для экспорта) */
export function singboxConfigFile(): string {
  return configTarget()
}
