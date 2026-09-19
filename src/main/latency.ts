// ============================================================
// M3tr0VPN — замер пинга. Логика 1:1 из v2rayN (SpeedtestService.cs).
//
// ОСНОВНОЙ тест («Пинг», как «Test real delay» в v2rayN):
//  RunRealPingAsync → LoadCoreConfigSpeedtest(selecteds):
//  ОДНО ядро со ВСЕМИ серверами — на каждый сервер свой mixed-
//  инбаунд (уникальный порт) + свой outbound, routing
//  inboundTag→outboundTag. Ядро стартует, затем каждый сервер
//  тестируется параллельно; упавшие перетестируются ещё раз.
//  Сам замер — ConnectionHandler.GetRealPingTime: ДВА HTTP-запроса
//  через прокси-порт сервера с паузой 100 мс, результат =
//  МИНИМУМ (второй запрос идёт по уже тёплому соединению =
//  1–2 RTT — именно поэтому v2rayN показывает «низкие» числа).
//
// TCP-пинг («Tcping» в меню — как GetTcpingTime в v2rayN):
//  DNS → ПЕРВЫЙ адрес, ОДИН TCP-коннект, таймаут 5 с. Быстрый
//  RTT до порта сервера. Если сервер отвергает «голый» SYN
//  (xhttp за фолбэками) или UDP-протокол без TCP-соседей —
//  сквозной тест одиночным временным ядром, чтобы у пользователя
//  было число для КАЖДОГО подключения.
//
// probeServerTunnel(): проба ОДНОГО сервера временным ядром Xray
// (forceXray) — vpn.ts использует для умного выбора ядра.
// ============================================================

import { spawn, type ChildProcess } from 'child_process'
import net from 'net'
import fs from 'fs'
import path from 'path'
import { app, net as electronNet, session, type Session } from 'electron'
import type { AppSettings, CoreKind, ServerProfile } from '@shared/types'
import { effectiveCore } from '@shared/types'
import {
  buildXrayLatencyConfig,
  buildXraySpeedtestConfig,
  type XraySpeedtestEntry
} from './xray/config'
import {
  buildSingboxLatencyConfig,
  buildSingboxSpeedtestConfig,
  type SingboxSpeedtestEntry
} from './singbox/config'
import { coreDir } from './xray/paths'
import { resolveHostIps, resolveServerIp, isIpLiteral } from './resolve'
import { fetchCertSha256Pin } from './cert-pin'

/** v2rayN: SpeedPingTestUrl по умолчанию */
const TEST_URL = 'http://www.gstatic.com/generate_204'
const CORE_START_TIMEOUT_MS = 10000
/** v2rayN GetRealPingTime: таймаут одного запроса (LocalFetch) */
const FETCH_TIMEOUT_MS = 8000
/** v2rayN: пауза между двумя запросами одного сервера */
const FETCH_PAUSE_MS = 100
/** v2rayN GetTcpingTime: 5 секунд */
const TCP_PING_TIMEOUT_MS = 5000

export interface LatencyOutcome {
  latencyMs: number | null
  error: string | null
}

/** Активные временные ядра — чтобы убить их при выходе из приложения */
const activeChildren = new Set<ChildProcess>()
let running = false
let runningTcp = false

export function isLatencyTestRunning(): boolean {
  return running || runningTcp
}

/** Убить все временные ядра замера (выход из приложения) */
export function killLatencyCores(): void {
  for (const child of activeChildren) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* уже мёртв */
    }
  }
  activeChildren.clear()
}

// ------------------------------------------------------------
// Порты и сессии
// ------------------------------------------------------------

function freeLocalPort(): Promise<number> {
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

function waitLocalPort(port: number, timeoutMs: number, onExit: Promise<never>): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const sock = net.connect({ port, host: '127.0.0.1' })
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - started > timeoutMs) {
          reject(new Error('core did not start'))
        } else {
          setTimeout(attempt, 120)
        }
      })
    }
    onExit.then(
      () => reject(new Error('core exited')),
      (err) => reject(err)
    )
    attempt()
  })
}

// ------------------------------------------------------------
// Пул сессий Electron для проксированных запросов: на каждый
// ПАРАЛЛЕЛЬНЫЙ замер своя сессия (setProxy глобален для сессии),
// после замера возвращаем в пул — новых сетевых контекстов при
// повторных замерах не создаётся (Session.close() в Electron 44 нет).
// ------------------------------------------------------------
const sessionPool: Session[] = []
let sessionCounter = 0
function acquireSession(): Session {
  return sessionPool.pop() ?? session.fromPartition(`m3tr0-latency-${sessionCounter++}`, { cache: false })
}
function releaseSession(ses: Session): void {
  sessionPool.push(ses)
}

// ------------------------------------------------------------
// Человекочитаемые причины ошибок
// ------------------------------------------------------------

function humanizeNetError(err: Error): string {
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const map: Record<string, string> = {
    ERR_CONNECTION_TIMED_OUT: 'timeout',
    ERR_TIMED_OUT: 'timeout',
    ERR_CONNECTION_REFUSED: 'refused',
    ERR_PROXY_CONNECTION_FAILED: 'core error',
    ERR_TUNNEL_CONNECTION_FAILED: 'server rejected',
    ERR_NAME_NOT_RESOLVED: 'dns',
    ERR_EMPTY_RESPONSE: 'no response',
    ERR_CONNECTION_RESET: 'reset',
    ERR_CERT_AUTHORITY_INVALID: 'tls',
    ERR_SSL_PROTOCOL_ERROR: 'tls'
  }
  if (map[code]) return map[code]
  const msg = err.message || 'error'
  return msg.length > 40 ? msg.slice(0, 40) : msg
}

// ------------------------------------------------------------
// Умный выбор ядра (общая логика с vpn.ts)
// ------------------------------------------------------------

/** Серверу нужен insecure-TLS, а пина нет — Xray 26.x так не умеет */
export function needsInsecurePin(server: ServerProfile): boolean {
  if (server.protocol === 'Hysteria2') {
    return Boolean(server.sb?.insecure) && !server.sb?.pinSHA256
  }
  return Boolean(
    server.stream.security === 'tls' &&
      server.stream.tls?.insecure &&
      !server.stream.tls?.pinnedPeerCertSha256
  )
}

/** TOFU-пин по TCP-TLS (null — не снялся: hy2/QUIC или сервер молчит) */
export async function tlsCertPin(server: ServerProfile): Promise<string | null> {
  if (server.protocol === 'Hysteria2') return null // QUIC — по TCP не снять
  const sni =
    server.stream.tls?.serverName ||
    (!isIpLiteral(server.address) ? server.address : undefined)
  return fetchCertSha256Pin(server.address, server.port, sni)
}

/** Копия сервера с пришпиленным пином (для конфига Xray) */
export function withCertPin(server: ServerProfile, pin: string): ServerProfile {
  if (server.protocol === 'Hysteria2') {
    return { ...server, sb: { ...(server.sb ?? {}), pinSHA256: pin } }
  }
  return {
    ...server,
    stream: {
      ...server.stream,
      tls: { ...(server.stream.tls ?? { serverName: '' }), pinnedPeerCertSha256: pin }
    }
  }
}

// ------------------------------------------------------------
// Замер через прокси-порт — v2rayN GetRealPingTime 1:1:
// ДВА запроса, пауза 100 мс, результат = МИНИМУМ
// ------------------------------------------------------------

function fetchOnce(ses: Session, port: number, timeoutMs: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false
    const req = electronNet.request({ url: TEST_URL, session: ses, redirect: 'manual' })
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        req.abort()
      } catch {
        /* запрос уже закрыт */
      }
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs)
    req.on('response', (res) => {
      res.on('data', () => undefined)
      res.on('error', () => undefined)
      // ЛЮБОЙ HTTP-ответ = туннель жив (v2rayN GetAsync без
      // EnsureSuccessStatusCode — 4xx/5xx тоже «успех» замера)
      finish(() => resolve(Date.now()))
    })
    req.on('error', (err) => finish(() => reject(err)))
    req.on('abort', () => finish(() => reject(new Error('aborted'))))
    req.end()
  })
}

/**
 * GetRealPingTime: замер начинается ДО запроса; сессия тёплая со
 * второй попытки — минимум двух запросов = чистая задержка туннеля.
 * Сессия должна быть монопольно занята этим сервером на время замера.
 */
async function realPingTime(ses: Session, port: number, timeoutMs = FETCH_TIMEOUT_MS): Promise<number> {
  await ses.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}` })
  const results: number[] = []
  let lastError: Error | null = null
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, FETCH_PAUSE_MS))
    const started = Date.now()
    try {
      await fetchOnce(ses, port, timeoutMs)
      results.push(Date.now() - started)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  if (results.length > 0) return Math.min(...results)
  throw lastError ?? new Error('timeout')
}

// ------------------------------------------------------------
// Запуск/остановка временного ядра
// ------------------------------------------------------------

interface CoreHandle {
  child: ChildProcess
  exited: Promise<never>
}

function spawnCore(core: CoreKind, cfgPath: string): CoreHandle {
  const bin = path.join(
    coreDir(),
    core === 'singbox'
      ? process.platform === 'win32'
        ? 'sing-box.exe'
        : 'sing-box'
      : process.platform === 'win32'
        ? 'xray.exe'
        : 'xray'
  )
  const child = spawn(bin, ['run', '-c', cfgPath], {
    windowsHide: true,
    cwd: coreDir(),
    env: { ...process.env, XRAY_LOCATION_ASSET: coreDir() },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  activeChildren.add(child)
  const exited = new Promise<never>((_resolve, reject) => {
    child.once('exit', () => reject(new Error('core exited')))
  })
  return { child, exited }
}

function killChild(child: ChildProcess): void {
  activeChildren.delete(child)
  const forceTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* уже мёртв */
    }
  }, 1500)
  child.once('exit', () => clearTimeout(forceTimer))
  try {
    child.kill()
  } catch {
    clearTimeout(forceTimer)
  }
}

// ------------------------------------------------------------
// ОСНОВНОЙ ТЕСТ: одно ядро со всеми серверами (v2rayN 1:1)
// ------------------------------------------------------------

interface SpeedtestItem {
  server: ServerProfile
  port: number
}

/**
 * Запуск мульти-серверного ядра и замер всех его серверов:
 *  1. ждём готовности ВСЕХ портов (параллельно);
 *  2. каждый сервер: GetRealPingTime (2 запроса, минимум);
 *  3. упавшие — ОДИН повтор (v2rayN RunRealPingBatchAsync
 *     перетестирует неудавшихся; WG/AWG успевают поднять
 *     хандшейк за это время).
 */
async function runSpeedtestCore(
  core: CoreKind,
  servers: ServerProfile[],
  settings: AppSettings,
  onUpdate: (server: ServerProfile, outcome: LatencyOutcome) => void
): Promise<void> {
  if (servers.length === 0) return

  // порты + «пришпиливание» IP (анти-цикл при живом TUN)
  const pins = new Map<string, string | null>()
  await Promise.all(
    [...new Set(servers.map((s) => s.address))].map(async (addr) => {
      pins.set(addr, await resolveServerIp(addr))
    })
  )

  const items: SpeedtestItem[] = []
  for (const server of servers) {
    items.push({ server, port: await freeLocalPort() })
  }

  const dir = path.join(app.getPath('userData'), 'latency')
  fs.mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, `speedtest-${core}.json`)
  const config =
    core === 'singbox'
      ? buildSingboxSpeedtestConfig(
          items.map(({ server, port }): SingboxSpeedtestEntry => {
            return { server, port, serverIp: pins.get(server.address) ?? null }
          })
        )
      : buildXraySpeedtestConfig(
          items.map(({ server, port }): XraySpeedtestEntry => {
            return { server, port, serverIp: pins.get(server.address) ?? null }
          }),
          settings
        )
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')

  const { child, exited } = spawnCore(core, cfgPath)
  let coreError = ''
  const takeError = (d: Buffer): void => {
    const text = d.toString().trim()
    if (text) coreError = text.split(/\r?\n/).slice(-1)[0].slice(0, 120)
  }
  child.stdout?.on('data', takeError)
  child.stderr?.on('data', takeError)

  const failed = new Map<ServerProfile, string>()
  // сессия на каждый сервер: параллельные замеры через разные порты
  // не делят одну сессию (setProxy глобален для сессии)
  const sessions = new Map<ServerProfile, Session>()
  for (const { server } of items) sessions.set(server, acquireSession())
  try {
    // готовность: ВСЕ порты должны принимать соединения
    await Promise.all(
      items.map(({ port }) => waitLocalPort(port, CORE_START_TIMEOUT_MS, exited))
    )
    // v2rayN: после старта ядра — небольшая пауза на инициализацию
    await new Promise((r) => setTimeout(r, 300))

    // все серверы параллельно (v2rayN Parallel.ForEachAsync)
    await Promise.all(
      items.map(async ({ server, port }) => {
        try {
          const ms = await realPingTime(sessions.get(server)!, port)
          onUpdate(server, { latencyMs: ms, error: null })
        } catch (err) {
          failed.set(server, humanizeNetError(err instanceof Error ? err : new Error(String(err))))
        }
      })
    )

    // повтор для упавших (v2rayN RunRealPingBatchAsync → retest)
    if (failed.size > 0) {
      const retryItems = items.filter(({ server }) => failed.has(server))
      await Promise.all(
        retryItems.map(async ({ server, port }) => {
          try {
            const ms = await realPingTime(sessions.get(server)!, port)
            onUpdate(server, { latencyMs: ms, error: null })
          } catch (err) {
            const reason = humanizeNetError(err instanceof Error ? err : new Error(String(err)))
            onUpdate(server, { latencyMs: null, error: /core did not start/.test(reason) && coreError ? `core: ${coreError}` : reason })
          }
        })
      )
    }
  } catch (err) {
    // ядро не поднялось — все серверы этой группы «failed»
    const message = err instanceof Error ? err.message : String(err)
    const reason = /core did not start/.test(message) && coreError ? `core: ${coreError}` : message
    for (const { server } of items) {
      onUpdate(server, { latencyMs: null, error: humanizeNetError(new Error(reason)) })
    }
  } finally {
    killChild(child)
    for (const ses of sessions.values()) releaseSession(ses)
  }
}

/**
 * «Test real delay» — основной тест пинга, числа совпадают с v2rayN:
 * одно ядро на группу протокола (xray / sing-box), 2 запроса на
 * сервер, минимум, повтор для упавших.
 */
export async function testAllServers(
  servers: ServerProfile[],
  settings: AppSettings,
  onUpdate: (server: ServerProfile, outcome: LatencyOutcome) => void
): Promise<void> {
  if (running) return
  running = true
  try {
    // Группировка по ядру + insecure-обработка для xray-группы
    // (снимаем TOFU-пин; не снялся — сервер уходит в sing-box-группу)
    const xrayServers: ServerProfile[] = []
    const sbServers: ServerProfile[] = []
    await Promise.all(
      servers.map(async (srv) => {
        let server = srv
        let core: CoreKind = effectiveCore(server, settings.coreOverrides)
        if (core === 'xray' && needsInsecurePin(server)) {
          const pin = await tlsCertPin(server)
          if (pin) {
            server = withCertPin(server, pin)
          } else {
            core = 'singbox'
          }
        }
        if (core === 'xray') xrayServers.push(server)
        else sbServers.push(server)
      })
    )
    // обе группы параллельно (каждая — своё ядро)
    await Promise.all([
      runSpeedtestCore('xray', xrayServers, settings, onUpdate),
      runSpeedtestCore('singbox', sbServers, settings, onUpdate)
    ])
  } finally {
    running = false
  }
}

// ------------------------------------------------------------
// TCP-пинг («Tcping» из v2rayN — второй пункт меню)
// ------------------------------------------------------------

/** Протоколы поверх UDP: TCP-коннект к их порту невозможен */
function isUdpProtocol(server: ServerProfile): boolean {
  return ['Hysteria', 'Hysteria2', 'TUIC', 'WireGuard', 'AmneziaWG'].includes(server.protocol)
}

function tcpPingOnce(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const sock = net.connect({ host, port })
    const done = (fn: () => void): void => {
      clearTimeout(timer)
      sock.destroy()
      fn()
    }
    const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs)
    sock.once('connect', () => done(() => resolve(Date.now() - started)))
    sock.once('error', (err) => done(() => reject(err)))
  })
}

/**
 * GetTcpingTime 1:1: DNS → ПЕРВЫЙ адрес (AddressList.First()),
 * ОДИН коннект, 5 с. Для UDP-протоколов — TCP-порт другого сервера
 * того же хоста (честный RTT до машины).
 */
async function tcpPingServer(server: ServerProfile, tcpFallbackPort: number | null): Promise<LatencyOutcome> {
  const ips = await resolveHostIps(server.address)
  const port = isUdpProtocol(server) && tcpFallbackPort ? tcpFallbackPort : server.port
  const host = ips.length > 0 ? ips[0] : server.address
  try {
    const ms = await tcpPingOnce(host, port, TCP_PING_TIMEOUT_MS)
    return { latencyMs: ms, error: null }
  } catch (err) {
    const e = (err ?? new Error('error')) as NodeJS.ErrnoException
    let reason = e.code ?? e.message ?? 'error'
    if (reason === 'ETIMEDOUT' || /timeout/i.test(reason)) reason = 'timeout'
    else if (reason === 'ENOTFOUND' || reason === 'EAI_AGAIN') reason = 'dns'
    else if (reason === 'ECONNREFUSED') reason = 'refused'
    else if (reason === 'EHOSTUNREACH' || reason === 'ENETUNREACH') reason = 'unreachable'
    else if (typeof reason === 'string' && reason.length > 40) reason = reason.slice(0, 40)
    return { latencyMs: null, error: reason }
  }
}

/**
 * TCP-пинг всех серверов (параллельно, без ядер) + фолбэк на
 * сквозной замер одиночным временным ядром для «молчащих» портов.
 */
export async function testAllServersTcp(
  servers: ServerProfile[],
  settings: AppSettings,
  onUpdate: (server: ServerProfile, outcome: LatencyOutcome) => void
): Promise<void> {
  if (runningTcp) return
  runningTcp = true
  try {
    // адрес → первый доступный TCP-порт (из TCP-протоколов)
    const tcpPortByHost = new Map<string, number>()
    for (const s of servers) {
      if (!isUdpProtocol(s) && !tcpPortByHost.has(s.address)) {
        tcpPortByHost.set(s.address, s.port)
      }
    }
    await Promise.all(
      servers.map(async (server) => {
        const fallback = tcpPortByHost.get(server.address) ?? null
        let outcome = await tcpPingServer(server, fallback)
        // TCP-коннект не прошёл (сервер отвергает «голый» SYN — так
        // делает часть xhttp-inbound за фолбэками; или UDP-протокол
        // без TCP-соседей): сквозная задержка одиночным ядром
        if (outcome.latencyMs == null) {
          outcome = await testOneServer(server, settings)
        }
        onUpdate(server, outcome)
      })
    )
  } finally {
    runningTcp = false
  }
}

// ------------------------------------------------------------
// Одиночный сквозной тест (фолбэк TCP-пинга и проба из vpn.ts)
// ------------------------------------------------------------

/**
 * Проба туннеля до одного сервера временным ЯДРОМ XRAY (врем. ядро
 * + generate_204). true — Xray способен установить соединение (сертификат
 * валиден). Используется vpn.ts при выборе ядра для insecure-серверов
 * без пина: если false — откат на sing-box (insecure).
 */
export async function probeServerTunnel(server: ServerProfile, settings: AppSettings): Promise<boolean> {
  const outcome = await testOneServer(server, settings, true)
  return outcome.latencyMs !== null
}

async function testOneServer(
  srv: ServerProfile,
  settings: AppSettings,
  forceXray = false
): Promise<LatencyOutcome> {
  let server = srv
  let core: CoreKind = forceXray ? 'xray' : effectiveCore(server, settings.coreOverrides)
  const httpPort = await freeLocalPort()
  const dir = path.join(app.getPath('userData'), 'latency')
  fs.mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, 'test-single.json')

  // «Пришпиливаем» IP: при живом TUN системный DNS врем. ядра ушёл бы
  // в туннель (а туннель может быть нерабочим) — а IP уже исключён из
  // маршрутов TUN, так что тест идёт напрямую, как в v2rayN.
  const serverIp = await resolveServerIp(server.address)

  // Xray 26.x не имеет allowInsecure: для TLS-серверов с insecure=1
  // без пина — снимаем TOFU-отпечаток (TCP-TLS протоколы); hy2 (QUIC)
  // и недоступные для пиннинга сервера тестируем через sing-box.
  // forceXray (проба из vpn.ts) — проверяем именно Xray, без фолбэка.
  if (core === 'xray' && !forceXray && needsInsecurePin(server)) {
    const pin = await tlsCertPin(server)
    if (pin) {
      server = withCertPin(server, pin)
    } else {
      core = 'singbox'
    }
  }

  const config =
    core === 'singbox'
      ? buildSingboxLatencyConfig(server, httpPort, serverIp)
      : buildXrayLatencyConfig(server, settings, httpPort, serverIp)
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8')

  const { child, exited } = spawnCore(core, cfgPath)
  let coreError = ''
  const takeError = (d: Buffer): void => {
    const text = d.toString().trim()
    if (text) coreError = text.split(/\r?\n/).slice(-1)[0].slice(0, 120)
  }
  child.stdout?.on('data', takeError)
  child.stderr?.on('data', takeError)

  const ses = acquireSession()
  try {
    await waitLocalPort(httpPort, CORE_START_TIMEOUT_MS, exited)
    const ms = await realPingTime(ses, httpPort)
    return { latencyMs: ms, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/core did not start/.test(message) && coreError) {
      return { latencyMs: null, error: `core: ${coreError}` }
    }
    return { latencyMs: null, error: humanizeNetError(err instanceof Error ? err : new Error(message)) }
  } finally {
    killChild(child)
    releaseSession(ses)
  }
}
