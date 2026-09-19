// ============================================================
// M3tr0VPN — менеджер процесса Xray-core
// Запуск/остановка ядра, ожидание готовности, сбор журнала,
// опрос статистики.
//
// ГОТОВНОСТЬ — по внутренней строке ядра «core: Xray … started»
// (она печатается ПОСЛЕ старта ВСЕХ инбаундов, включая TUN).
// Раньше ждали открытия socks-порта — он открывается ДО создания
// wintun-адаптера (инбаунды стартуют по порядку), и приложение
// показывало «Подключено» при ещё не поднятом туннеле (лог
// 19.09: hysteria-сессии «умирали» от ручного disconnect).
//
// СТАТИСТИКА — «metrics»-эндпоинт Xray, GET /debug/vars раз в
// секунду (ровно как StatisticsXrayService в v2rayN): дельты
// кумулятивных счётчиков stats.outbound[proxy] = скорость.
// Прежний способ (`xray api statsquery` дочерним процессом) сам
// по себе жил — но соединения к dokodemo api-инбаунду ДО конца
// старта ядра дают «non existing outTag: api» и спамят лог.
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import { app } from 'electron'
import type { AppRule, AppSettings, LogEntry, ServerProfile, SpeedTick, TransportMode } from '@shared/types'
import { buildXrayConfig, type CorePorts } from './config'
import { DEFAULT_PORTS } from './config'
import { coreBinary, coreDir, coreConfigPath } from './paths'
import { settleTunAdapter } from '../tun-adapter'

const STATS_INTERVAL_MS = 1000
/** Прокси-режим: порты открываются мгновенно. TUN: создание wintun-
 * адаптера может занять до нескольких секунд (а при зависании PnP —
 * заметно дольше); как v2rayN — даём ядру время, а не убиваем его
 * посреди создания адаптера (это клинит PnP до перезапуска). */
const READY_TIMEOUT_PROXY_MS = 12000
const READY_TIMEOUT_TUN_MS = 25000
/** Внутренняя строка полного старта ядра (все инбаунды подняты) */
const CORE_STARTED_RE = /core: Xray [\w.\-]+ started/

export interface StartOptions {
  server: ServerProfile
  settings: AppSettings
  appRules: AppRule[]
  mode: TransportMode
  ports?: CorePorts
  /** Разрешённый заранее IP сервера (TUN-режим: разрывает DNS-цикл) */
  serverIp?: string | null
  /** IP всех серверов подписки — вычитаются из таблицы маршрутов TUN */
  excludeIps?: string[]
  /** Имя TUN-адаптера (ротация при retry — обходит wintun-коллизии) */
  tunAdapterName?: string
}

export class XrayManager extends EventEmitter {
  private proc: ChildProcess | null = null
  private statsTimer: NodeJS.Timeout | null = null
  private logBuffer: LogEntry[] = []
  private totals = { down: 0, up: 0 }
  /** Последняя кумулятивная выборка metrics (для дельт) */
  private lastCum = { down: -1, up: -1 }
  private coreVersionCache: string | null = null
  private starting = false
  private lastPorts: CorePorts = DEFAULT_PORTS
  private recentErrors: string[] = []
  /** Режим последнего запуска — для settle-гигиены адаптера при stop */
  private lastMode: TransportMode = 'proxy'
  /** IP, «пришпиленный» в конфиг последнего TUN-запуска (для диалога конфига) */
  private lastServerIp: string | null = null
  /** Имя TUN-адаптера последнего запуска */
  private lastTunName: string | null = null
  /** Процесс, успешно прошедший фазу старта. Смерть ДО готовности —
   * штатная ситуация: start() уже отклонился с текстом ошибки (например,
   * exit 23 «адаптер уже существует»), и контроллер делает свой
   * retry. Событие 'exit' в этом случае НЕ эмитим — иначе onCoreExit
   * параллельно делает emergencyStop и state:'error', и retry
   * сражается сам с собой (лог 19.09: «каскадная смерть» TUN). */
  private readyProc: ChildProcess | null = null

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  /** Порты текущей/последней сессии ядер */
  get ports(): CorePorts {
    return this.lastPorts
  }

  private lastErrorText(): string {
    return this.recentErrors.slice(-3).join(' | ')
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

  /** Версия ядра (кэшируется) */
  async coreVersion(): Promise<string> {
    if (this.coreVersionCache) return this.coreVersionCache
    return new Promise((resolve) => {
      try {
        const p = spawn(coreBinary(), ['version'], {
          env: { ...process.env, XRAY_LOCATION_ASSET: coreDir() },
          windowsHide: true
        })
        let out = ''
        p.stdout?.on('data', (d) => (out += d.toString()))
        p.on('error', () => resolve('Xray'))
        p.on('close', () => {
          const m = out.match(/Xray (\S+)/)
          this.coreVersionCache = m ? `Xray ${m[1]}` : 'Xray'
          resolve(this.coreVersionCache)
        })
      } catch {
        resolve('Xray')
      }
    })
  }

  /** Сгенерировать и записать config.json (без запуска ядра) */
  writeConfig(opts: StartOptions): void {
    const config = buildXrayConfig(
      opts.settings,
      opts.server,
      opts.appRules,
      opts.mode,
      opts.ports,
      opts.serverIp,
      opts.excludeIps,
      opts.tunAdapterName
    )
    fs.writeFileSync(coreConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  }

  /** Сгенерировать конфиг и вернуть объект (для диалога «config.json») */
  buildConfig(opts: StartOptions): Record<string, unknown> {
    return buildXrayConfig(
      opts.settings,
      opts.server,
      opts.appRules,
      opts.mode,
      opts.ports,
      opts.serverIp ?? (opts.mode === 'tun' ? this.lastServerIp : null),
      opts.excludeIps,
      opts.tunAdapterName ?? this.lastTunName ?? undefined
    )
  }

  async start(opts: StartOptions): Promise<void> {
    if (this.starting) throw new Error('core is already starting')
    if (this.running) await this.stop()

    this.starting = true
    this.recentErrors = []
    this.lastCum = { down: -1, up: -1 }
    try {
      const ports = opts.ports ?? this.ports
      this.lastPorts = ports
      this.lastMode = opts.mode
      this.lastServerIp = opts.serverIp ?? null
      this.lastTunName = opts.tunAdapterName ?? null
      this.writeConfig({ ...opts, ports })
      this.pushLog(
        'info',
        'app',
        `core starting: ${opts.server.protocol} → ${opts.server.address}:${opts.server.port} [${opts.mode}]${
          opts.serverIp ? ` (pinned ${opts.serverIp})` : ''
        }${opts.mode === 'tun' ? ` [adapter ${this.lastTunName ?? 'M3tr0VPN'}]` : ''}`
      )

      const child = spawn(coreBinary(), ['run', '-c', coreConfigPath()], {
        env: { ...process.env, XRAY_LOCATION_ASSET: coreDir() },
        windowsHide: true,
        cwd: path.dirname(coreBinary())
      })
      this.proc = child
      this.totals = { down: 0, up: 0 }

      // Готовность = внутренняя строка «core: Xray … started» — она
      // печатается после старта ВСЕХ инбаундов (в TUN-режиме это
      // значит «wintun-адаптер создан и туннель поднят»)
      let startedResolve: (() => void) | null = null
      const coreStarted = new Promise<void>((resolve) => {
        startedResolve = resolve
      })

      child.stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().split(/\r?\n/).filter(Boolean)) {
          const clean = line.replace(/^\d{4}\/\d{2}\/\d{2} [\d:.]+\s*/, '')
          this.pushLog(parseLevel(line), 'core', clean)
          if (/\[(Error|Fatal)\]|failed|invalid/i.test(line)) {
            this.recentErrors.push(clean)
            if (this.recentErrors.length > 6) this.recentErrors.shift()
          }
          if (startedResolve && CORE_STARTED_RE.test(clean)) {
            startedResolve()
            startedResolve = null
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
          this.pushLog('error', 'core', `core exited with code ${code}`)
        }
        // Погибшее ДО готовности ядро — не «авария приложения»: об этом
        // уже знает start() (reject) и логика повтора контроллера
        if (wasReady) this.emit('exit', code, signal)
      })
      child.on('error', (err) => {
        this.pushLog('error', 'app', `failed to spawn core: ${err.message}`)
      })

      // Готовность: внутренняя строка полного старта ИЛИ смерть ядра
      // (с текстом ошибки). В прокси-режиме строка приходит сразу за
      // открытием порта; в TUN — только после создания адаптера.
      const exited = new Promise<never>((_resolve, reject) => {
        child.once('exit', (code) => {
          reject(new Error(this.lastErrorText() || `core exited with code ${code}`))
        })
      })
      const readyTimeout = opts.mode === 'tun' ? READY_TIMEOUT_TUN_MS : READY_TIMEOUT_PROXY_MS
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`core did not fully start within ${readyTimeout / 1000}s`)), readyTimeout).unref?.()
      })
      await Promise.race([coreStarted, exited, timeout])
      this.readyProc = child
      this.pushLog('info', 'core', 'Xray started')
      this.startStatsTimer()
    } finally {
      this.starting = false
    }
  }

  async stop(): Promise<void> {
    this.stopStatsTimer()
    const child = this.proc
    const hadTun = this.lastMode === 'tun'
    if (!child) {
      // Процесс не жил — но после падения TUN-адаптер мог остаться висеть
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
    // Зомби-гигиена (Windows): пока у родителя открыты stdio-пайпы
    // убитого процесса, процесс-объект живёт и ДЕРЖИТ wintun-адаптер —
    // следующий xray зависает на «Creating adapter». Закрываем пайпы.
    try {
      child.stdout?.destroy()
    } catch {
      /* уже закрыт */
    }
    try {
      child.stderr?.destroy()
    } catch {
      /* уже закрыт */
    }
    // wintun-адаптер удаляется драйвером асинхронно: ждём исчезновения,
    // иначе следующий запуск xray зависнет на создании адаптера с тем же
    // именем (см. комментарий в tun-adapter.ts)
    if (hadTun && process.platform === 'win32') {
      await settleTunAdapter((msg) => this.pushLog('warn', 'app', msg))
    }
    this.pushLog('info', 'app', 'core stopped')
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

  /**
   * Опрос статистики — metrics-эндпоинт Xray, ровно как
   * StatisticsXrayService в v2rayN: GET /debug/vars раз в секунду,
   * дельты кумулятивных счётчиков stats.outbound[proxy*] = скорость.
   * Через outbound «proxy» проходит ВЕСЬ туннелированный трафик
   * независимо от инбаунда (mixed/tun). Без dokodemo api-инбаунда —
   * нет и спама «non existing outTag: api» во время старта TUN.
   */
  private async pollStats(): Promise<void> {
    if (!this.running) return
    try {
      const res = await fetch(`http://127.0.0.1:${this.ports.api}/debug/vars`, {
        signal: AbortSignal.timeout(1500)
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        stats?: { outbound?: Record<string, { uplink?: number; downlink?: number }> }
      }
      let up = 0
      let down = 0
      for (const [tag, counters] of Object.entries(data.stats?.outbound ?? {})) {
        // как v2rayN: все теги, начинающиеся с «proxy» (балансировщики
        // дают proxy-1, proxy-2, …)
        if (tag === 'proxy' || tag.startsWith('proxy-')) {
          up += counters.uplink ?? 0
          down += counters.downlink ?? 0
        }
      }
      if (this.lastCum.down < 0) {
        // первая выборка — базовая точка
        this.lastCum = { down, up }
        return
      }
      if (down < this.lastCum.down || up < this.lastCum.up) {
        // счётчики уменьшились (перезапуск ядра) — сброс базы
        this.lastCum = { down, up }
        return
      }
      const dDown = down - this.lastCum.down
      const dUp = up - this.lastCum.up
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
      /* ядро ещё поднимается / перезапускается — пропускаем тик */
    }
  }
}

function parseLevel(line: string): LogEntry['level'] {
  if (/\[(Error|Fatal)\]/i.test(line)) return 'error'
  if (/\[Warning\]/i.test(line)) return 'warn'
  return 'info'
}

/** Единый инстанс на приложение */
export const xray = new XrayManager()

/** Путь к файлу журнала приложения (для «Открыть папку логов») */
export function appLogFile(): string {
  return path.join(app.getPath('userData'), 'logs', `m3tr0vpn-${new Date().toISOString().slice(0, 10)}.log`)
}
