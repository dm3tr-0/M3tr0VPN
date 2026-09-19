// ============================================================
// M3tr0VPN — контроллер соединения (архитектура v2rayN 7.24.9)
// Оркестрация ядер — «как в v2rayN»:
//  - ядро для протокола: effectiveCore() — дефолт Xray для ВСЕГО,
//    включая Hysteria2 и WireGuard (v2rayN 7.24.9 делает так же);
//    только Hysteria(v1)/TUIC/AmneziaWG — sing-box (в Xray их нет);
//    переключается в настройках («Ядро для протокола»);
//  - Xray 26.x не имеет allowInsecure: для ссылок с insecure=1
//    без pinSHA256 — TOFU-пин сертификата (TCP-TLS протоколы) или
//    проба туннеля временным ядром (hy2/QUIC); если сервер
//    self-signed и Xray его не принимает — откат на sing-box,
//    который insecure понимает (сайты открываются в любом случае).
//
// Схемы:
//  proxy + xray-протокол    → xray (socks+http)  + системный прокси
//  proxy + sb-протокол      → sing-box (mixed)   + системный прокси
//  tun   + xray-протокол    → ОДИН xray с нативным tun-инбаундом
//                             (как в v2rayN: без sing-box-цепочки;
//                             исходящие сокеты ядра привязаны
//                             к физическому интерфейсу — циклов нет)
//  tun   + sb-протокол      → sing-box (tun + свой outbound)
// ============================================================

import { EventEmitter } from 'events'
import type {
  AppRule,
  AppSettings,
  ConnectionStatus,
  ServerProfile,
  TransportMode
} from '@shared/types'
import { effectiveCore } from '@shared/types'
import type { Store } from './store'
import { xray } from './xray/manager'
import { singbox } from './singbox/manager'
import type { SingboxRole, SingboxStartInput } from './singbox/config'
import { describeAmnezia } from './singbox/config'
import { sysProxy } from './sysproxy'
import { allocateCorePorts, killStaleCores, type CorePorts } from './ports'
import { coreDir } from './xray/paths'
import { prepareTunStart } from './tun-adapter'
import { resolveAllServerIps, resolveServerIp } from './resolve'
import { needsInsecurePin, tlsCertPin, withCertPin, probeServerTunnel } from './latency'

/**
 * Имя TUN-адаптера с суффиксом попытки. wintun на Windows не умеет
 * быстро пересоздавать адаптер с тем же именем (PnP доводит удаление
 * асинхронно, до 15 с) — при retry берём СВЕЖЕЕ имя: коллизия
 * «Cannot create a file when that file already exists» (exit 23)
 * невозможна в принципе. Первая попытка — каноническое «M3tr0VPN».
 */
function tunNameForAttempt(attempt: number): string {
  return attempt <= 1 ? 'M3tr0VPN' : `M3tr0VPN-${attempt}`
}

/** Пауза между TUN-попытками: PnP нужно время довести удаление */
function tunRetryDelayMs(attempt: number): number {
  return Math.min(2000 * attempt, 6000)
}

export class VpnController extends EventEmitter {
  private store: Store
  private status: ConnectionStatus = {
    state: 'disconnected',
    serverId: null,
    serverLabel: '',
    protocol: '',
    transport: null,
    since: null,
    error: null,
    speedDown: 0,
    speedUp: 0,
    totalDown: 0,
    totalUp: 0
  }
  /** фаза управляемой остановки — события exit ядер игнорируем */
  private stopping = false
  private currentPorts: CorePorts | null = null
  /** Выполняющийся connect()/restartCore() — повторные клики «Подключить»
   * ждут ЕГО же, а не запускают второй старт ядер параллельно (лог
   * 19.09: второй connect во время retry убил рабочее ядро как «stale») */
  private connectInFlight: Promise<{ ok: boolean; needsElevation?: boolean; error?: string }> | null =
    null

  constructor(store: Store) {
    super()
    this.store = store

    // Любое ядро упало само по себе (не через disconnect)
    const onCoreExit = (core: string): void => {
      if (this.stopping) return
      if (this.status.state === 'connected' || this.status.state === 'connecting') {
        void this.emergencyStop()
        this.setStatus({
          state: 'error',
          error: `${core} stopped unexpectedly`,
          speedDown: 0,
          speedUp: 0
        })
      }
    }
    xray.on('exit', () => onCoreExit('core'))
    singbox.on('exit', () => onCoreExit('sing-box'))

    const onStats = (tick: { down: number; up: number; totalDown: number; totalUp: number }): void => {
      if (this.status.state === 'connected') {
        this.status = {
          ...this.status,
          speedDown: tick.down,
          speedUp: tick.up,
          totalDown: tick.totalDown,
          totalUp: tick.totalUp
        }
        this.emit('status', this.status)
      }
    }
    xray.on('stats', onStats)
    singbox.on('stats', onStats)
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  private setStatus(patch: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  /** Аварийная остановка без смены статуса (его выставляет вызывающий) */
  private async emergencyStop(): Promise<void> {
    this.stopping = true
    try {
      await sysProxy.disable()
    } catch {
      /* best effort */
    }
    // TUN (sing-box) гасим первым: пока он жив, трафик завёрнут в ядро
    try {
      await singbox.stop()
    } catch {
      /* best effort */
    }
    try {
      await xray.stop()
    } catch {
      /* best effort */
    }
    this.stopping = false
  }

  /** Запуск ядер по схеме режима/протокола */
  private async startCores(server: ServerProfile, settings: AppSettings): Promise<CorePorts> {
    // 0) подметаем осиротевшие процессы ядер из нашего каталога.
    // ВАЖНО: только когда оба ядра не работают — живое ядро может
    // принадлежать нашему же retry (TUN-повтор), его убивать нельзя
    // (лог 19.09: «killed 1 stale core process» снёс поднятое ядро)
    if (!xray.running && !singbox.running) {
      try {
        const killed = await killStaleCores(coreDir())
        if (killed.length > 0) {
          xray.pushLog('warn', 'app', `killed ${killed.length} stale core process(es) from previous run`)
        }
      } catch {
        /* best effort */
      }
    }

    // 1) свободные порты (10808 → 1080 → 2080 → …)
    const ports = await allocateCorePorts()
    this.currentPorts = ports

    const mode = settings.transportMode as TransportMode
    // Ядро для протокола — «как в v2rayN» (GetCoreType): настройка
    // «ядро для протокола» → дефолт Xray (теперь и для hy2/wireguard);
    // Hysteria(v1)/TUIC/AmneziaWG — только sing-box
    const core = effectiveCore(server, settings.coreOverrides)
    xray.pushLog('info', 'app', `core selected: ${core === 'xray' ? 'Xray' : 'sing-box'} for ${server.protocol}`)

    if (mode === 'proxy') {
      if (core === 'singbox') {
        // Пиннинг IP и в прокси-режиме: сквозной пинг при живом
        // туннеле должен идти напрямую (лог 19.09: AWG «не работает»)
        const serverIp = await resolveServerIp(server.address)
        const amneziaDesc = describeAmnezia(server)
        if (amneziaDesc) xray.pushLog('info', 'app', amneziaDesc)
        await singbox.start({
          server,
          settings,
          appRules: this.store.appRules,
          mode,
          role: 'proxy',
          ports,
          serverIp
        })
      } else {
        // В прокси-режиме TUN нет — Xray сам разрешает домен системным DNS,
        // IP не «пришпиливаем» (как в v2rayN)
        await this.startXraySmart(server, settings, mode, ports, null, [])
      }
      return ports
    }

    // TUN: сначала убедимся, что wintun-адаптер свободен — иначе
    // ядро зависает на «open interface take too much time»
    await prepareTunStart((msg) => xray.pushLog('warn', 'app', msg))

    // Резолвим адреса ДО подъёма TUN — пока туннеля нет, системный
    // DNS работает напрямую (как делает v2rayN перед стартом TUN).
    // IP выбранного сервера «пришпиливаем» в конфиг ядра (SNI остаётся
    // доменом), IP всех серверов исключаем из маршрутов TUN.
    const excludeIps = await resolveAllServerIps(this.store.servers)
    if (excludeIps.length > 0) {
      xray.pushLog('info', 'app', `resolved ${excludeIps.length} server ip(s), excluded from tun routes`)
    }

    if (core === 'singbox') {
      const serverIp = await resolveServerIp(server.address)
      if (!serverIp) {
        xray.pushLog(
          'warn',
          'app',
          `could not resolve ${server.address} upfront; falling back to system dns inside core`
        )
      }
      // Диагностика AWG: какие параметры обфускации реально применены
      const amneziaDesc = describeAmnezia(server)
      if (amneziaDesc) xray.pushLog('info', 'app', amneziaDesc)
      await this.startSingboxWithTunRetry({
        server,
        settings,
        appRules: this.store.appRules,
        mode,
        role: 'tun-direct',
        ports,
        excludeIps,
        // Пиннинг IP endpoint'а — обязателен для AWG в TUN: без него
        // резолв домена сервера уходит в ещё не подняный туннель
        serverIp
      })
      return ports
    }

    // TUN + xray-протокол: ОДИН процесс Xray с нативным tun-инбаундом.
    // Анти-цикл из трёх уровней (как v2rayN):
    //  1) autoOutboundsInterface — сокеты ядра привязаны к физическому
    //     интерфейсу, в TUN они не попадают;
    //  2) IP серверов вычтены из autoSystemRoutingTable;
    //  3) адрес сервера «пришпилен» IP (домен живёт в SNI).
    const serverIp = await resolveServerIp(server.address)
    if (!serverIp) {
      xray.pushLog(
        'warn',
        'app',
        `could not resolve ${server.address} upfront; falling back to system dns inside core`
      )
    }
    await this.startXraySmart(server, settings, mode, ports, serverIp, excludeIps)
    return ports
  }

  /**
   * Умный старт Xray — «как в v2rayN», но устойчивее к self-signed:
   *  1) TLS-по-TCP с insecure=1 без пина → снимаем отпечаток сертификата
   *     (TOFU) и пиним его в конфиг (Xray 26.x allowInsecure не умеет);
   *  2) hy2 (QUIC — отпечаток по TCP не снять) и недоступные сервера →
   *     проба туннеля временным ядром ДО старта основного: если сервер
   *     отвечает — остаёмся на Xray (валидный сертификат), нет —
   *     откат на sing-box, который понимает insecure напрямую.
   */
  private async startXraySmart(
    server: ServerProfile,
    settings: AppSettings,
    mode: TransportMode,
    ports: CorePorts,
    serverIp: string | null,
    excludeIps: string[]
  ): Promise<void> {
    let effective = server
    let probeNeeded = false

    if (needsInsecurePin(server)) {
      const pin = await tlsCertPin(server)
      if (pin) {
        effective = withCertPin(server, pin)
        xray.pushLog(
          'info',
          'app',
          `self-signed certificate pinned (TOFU): ${server.address} sha256:${pin.slice(0, 12)}…`
        )
      } else {
        // hy2/QUIC или сервер не отдал сертификат по TCP: возможно,
        // сертификат валидный и insecure=1 в ссылке просто избыточен —
        // проверяем туннель временным ядром до старта основного
        probeNeeded = true
      }
    }

    if (probeNeeded) {
      xray.pushLog(
        'info',
        'app',
        `probing ${server.protocol} tunnel before starting xray (insecure link without cert pin)`
      )
      const ok = await probeServerTunnel(server, settings)
      if (!ok) {
        xray.pushLog(
          'warn',
          'app',
          `xray cannot establish ${server.protocol} to ${server.address} (self-signed tls without pin); falling back to sing-box`
        )
        const role = mode === 'tun' ? 'tun-direct' : 'proxy'
        if (mode === 'tun') {
          await prepareTunStart((msg) => xray.pushLog('warn', 'app', msg))
        }
        await this.startSingboxWithTunRetry({
          server,
          settings,
          appRules: this.store.appRules,
          mode,
          role,
          ports,
          ...(mode === 'tun' ? { excludeIps, serverIp } : { serverIp: null })
        })
        return
      }
      xray.pushLog('info', 'app', 'tunnel probe ok — using xray')
    }

    await this.startXrayWithTunRetry({
      server: effective,
      settings,
      appRules: this.store.appRules,
      mode,
      ports,
      serverIp,
      excludeIps
    })
  }

  /**
   * Запуск Xray в TUN-режиме с повторами: создание wintun-адаптера —
   * самая хрупкая часть (PnP удаляет прошлое устройство асинхронно,
   * до 15 с; выход 23 «already exists» — норма при быстром
   * переключении серверов). Гасим ядро, выкорчёвываем адаптер
   * (pnputil), ждём и пробуем снова — до 3 попыток, чтобы
   * переключение серверов не «умирало» до перезапуска приложения.
   */
  private async startXrayWithTunRetry(input: {
    server: ServerProfile
    settings: AppSettings
    appRules: AppRule[]
    mode: TransportMode
    ports: CorePorts
    serverIp: string | null
    excludeIps: string[]
  }): Promise<void> {
    if (input.mode !== 'tun') {
      await xray.start(input)
      return
    }
    const MAX_ATTEMPTS = 4
    for (let attempt = 1; ; attempt++) {
      try {
        await xray.start({ ...input, tunAdapterName: tunNameForAttempt(attempt) })
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(message)
        }
        xray.pushLog(
          'warn',
          'app',
          `xray tun start failed (${message}); retry ${attempt}/${MAX_ATTEMPTS - 1} with fresh adapter name`
        )
      }
      try {
        await xray.stop()
      } catch {
        /* ядро уже мертво */
      }
      await prepareTunStart((msg) => xray.pushLog('warn', 'app', msg))
      // Пауза растёт с попыткой: PnP нужно время довести удаление
      await new Promise((r) => setTimeout(r, tunRetryDelayMs(attempt)))
    }
  }

  /**
   * Запуск sing-box в TUN-роли с повторами: если адаптер завис
   * (не поднялся за таймаут) — гасим ядро, выкорчёвываем адаптер
   * и пробуем ещё раз (до 3 попыток).
   */
  private async startSingboxWithTunRetry(input: SingboxStartInput): Promise<void> {
    if (input.role !== 'tun-direct') {
      await singbox.start(input)
      return
    }
    const MAX_ATTEMPTS = 4
    for (let attempt = 1; ; attempt++) {
      try {
        await singbox.start({ ...input, tunAdapterName: tunNameForAttempt(attempt) })
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (attempt >= MAX_ATTEMPTS) {
          throw new Error(message)
        }
        xray.pushLog(
          'warn',
          'app',
          `tun start failed (${message}); retry ${attempt}/${MAX_ATTEMPTS - 1} with fresh adapter name`
        )
      }
      try {
        await singbox.stop()
      } catch {
        /* ядро уже мертво */
      }
      await prepareTunStart((msg) => xray.pushLog('warn', 'app', msg))
      await new Promise((r) => setTimeout(r, tunRetryDelayMs(attempt)))
    }
  }

  /** Изменились ли параметры, требующие перезапуска ядра */
  static needsCoreRestart(patch: Partial<AppSettings>): boolean {
    return (
      patch.selectedServerId !== undefined ||
      patch.mux !== undefined ||
      patch.ipv6 !== undefined ||
      patch.dns !== undefined ||
      patch.selectedDomains !== undefined ||
      patch.transportMode !== undefined ||
      patch.coreOverrides !== undefined
    )
  }

  async connect(): Promise<{ ok: boolean; needsElevation?: boolean; error?: string }> {
    // Дедупликация: клики по кнопке во время подключения/TUN-повтора
    // возвращают ОДИН и тот же промис — второй параллельный старт
    // ядер невозможен (лог 19.09: второй connect убил рабочее ядро)
    if (this.connectInFlight) return this.connectInFlight
    if (this.status.state === 'connected' || this.status.state === 'connecting') {
      return { ok: true }
    }
    const server = this.store.selectedServer()
    if (!server) {
      this.setStatus({ state: 'error', error: 'no server selected' })
      return { ok: false, error: 'no server selected' }
    }

    const settings = this.store.settings
    if (settings.transportMode === 'tun' && !sysProxy.isElevated()) {
      return { ok: false, needsElevation: true }
    }

    this.setStatus({
      state: 'connecting',
      serverId: server.id,
      serverLabel: server.name,
      protocol: server.protocol,
      transport: settings.transportMode,
      error: null,
      speedDown: 0,
      speedUp: 0,
      totalDown: 0,
      totalUp: 0
    })

    const run = async (): Promise<{ ok: boolean; needsElevation?: boolean; error?: string }> => {
      try {
        const ports = await this.startCores(server, settings)
        if (settings.transportMode === 'proxy') {
          // Системный прокси → mixed-инбаунд (socks+http на одном
          // порту, как v2rayN)
          await sysProxy.enable(ports.socks)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await this.emergencyStop()
        this.setStatus({ state: 'error', error: message, speedDown: 0, speedUp: 0 })
        return { ok: false, error: message }
      }

      this.setStatus({ state: 'connected', since: Date.now(), error: null })
      return { ok: true }
    }
    const promise = run().finally(() => {
      if (this.connectInFlight === promise) this.connectInFlight = null
    })
    this.connectInFlight = promise
    return promise
  }

  async disconnect(): Promise<{ ok: boolean }> {
    this.stopping = true
    try {
      await sysProxy.disable()
      await singbox.stop()
      await xray.stop()
    } finally {
      this.stopping = false
    }
    this.setStatus({
      state: 'disconnected',
      since: null,
      speedDown: 0,
      speedUp: 0
    })
    return { ok: true }
  }

  /** Перезапуск ядра с новой конфигурацией (с сохранением сессии) */
  async restartCore(): Promise<{ ok: boolean; needsElevation?: boolean; error?: string }> {
    if (this.status.state !== 'connected') {
      return this.connect()
    }
    const server = this.store.selectedServer()
    if (!server) {
      await this.disconnect()
      return { ok: false, error: 'no server selected' }
    }
    const settings = this.store.settings
    if (settings.transportMode === 'tun' && !sysProxy.isElevated()) {
      await this.disconnect()
      return { ok: false, needsElevation: true }
    }

    const wasProxy = this.status.transport === 'proxy'
    const since = this.status.since

    this.setStatus({ state: 'connecting', error: null })
    this.stopping = true
    try {
      await singbox.stop()
      await xray.stop()
    } finally {
      this.stopping = false
    }

    try {
      const ports = await this.startCores(server, settings)
      if (settings.transportMode === 'proxy') {
        await sysProxy.enable(ports.socks)
      } else if (wasProxy) {
        await sysProxy.disable()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.emergencyStop()
      this.setStatus({ state: 'error', error: message, since: null })
      return { ok: false, error: message }
    }

    this.setStatus({
      state: 'connected',
      since: since ?? Date.now(),
      serverLabel: server.name,
      protocol: server.protocol,
      transport: settings.transportMode,
      error: null
    })
    return { ok: true }
  }

  /** Полная очистка при выходе из приложения */
  async forceCleanup(): Promise<void> {
    try {
      await sysProxy.disable()
    } catch {
      /* best effort */
    }
    try {
      await singbox.stop()
    } catch {
      /* best effort */
    }
    try {
      await xray.stop()
    } catch {
      /* best effort */
    }
  }

  /** Порты текущей сессии (для sysproxy.repair при старте) */
  get ports(): CorePorts | null {
    return this.currentPorts
  }

  /** Какая роль sing-box используется сейчас (для диалога конфигов) */
  currentSingboxRole(): SingboxRole | null {
    if (this.status.state !== 'connected' && this.status.state !== 'connecting') return null
    const server = this.store.selectedServer()
    if (!server || !this.currentPorts) return null
    if (effectiveCore(server, this.store.settings.coreOverrides) !== 'singbox') return null
    return this.store.settings.transportMode === 'proxy' ? 'proxy' : 'tun-direct'
  }
}
