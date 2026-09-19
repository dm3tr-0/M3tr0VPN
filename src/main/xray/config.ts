// ============================================================
// M3tr0VPN — генератор config.json для реального Xray-core.
// ЛОГИКА 1:1 С v2rayN master (ServiceLib/Services/CoreConfig/V2ray):
//  - SampleClientConfig: log warning, freedom+blackhole outbounds,
//    routing.domainStrategy IPIfNonMatch;
//  - ОДИН mixed-инбаунд (socks+http на одном порту — protocol
//    "mixed", ровно как v2rayN BuildInbound), sniffing http/tls;
//  - статистика — «metrics»-эндпоинт Xray (V2rayStatisticService:
//    metrics.listen + policy.system.statsOutbound*) вместо старого
//    dokodemo api-инбаунда (он давал «non existing outTag: api»
//    пока ядро поднимает TUN-адаптер, и спамил в лог);
//  - НАТИВНЫЙ TUN-инбаунд Xray один в один SampleTunInbound
//    (MTU 9000, gateway, dns [1.1.1.1, 8.8.8.8],
//    autoOutboundsInterface "auto", sniffing routeOnly);
//  - правила TUN — SampleTunRules (windows-junk → block);
//  - Hysteria2 → protocol "hysteria" с settings.version=2 — ровно
//    как V2rayOutboundService (вкл. alpn/fingerprint из ссылки,
//    finalmask udp salamander + quicParams);
//  - WireGuard → нативный wireguard-outbound (как v2rayN);
//  - allowInsecure УДАЛЁН в Xray 26.x — вместо него hex-пин
//    pinnedPeerCertSha256 (из ссылки pinSHA256/pcs или TOFU-пин
//    из cert-pin.ts);
//  - ws "host" вынесен из headers (deprecated) в поле host.
// ============================================================

import os from 'os'
import type { AppRule, AppSettings, ServerProfile, StreamSettings, TransportMode } from '@shared/types'
import type { CorePorts } from '../ports'
import { isIpLiteral } from '../resolve'
import { normalizePinToHex } from '../cert-pin'

export type { CorePorts }
export const DEFAULT_PORTS: CorePorts = { socks: 10808, http: 10809, api: 15490, clash: 9090 }

type Json = Record<string, unknown>

/** Имя TUN-адаптера по умолчанию (совпадает с tun-adapter.ts) */
const TUN_IFACE = 'M3tr0VPN'
const TUN_ADDRESS_V4 = '172.18.0.1/30'
const TUN_ADDRESS_V6 = 'fdfe:dcba:9876::1/126'
/** v2rayN SampleTunInbound: MTU 9000 */
const TUN_MTU = 9000

/**
 * «Пришпиливание» resolved-IP вместо домена в адрес сервера.
 *
 * В режиме TUN системный DNS-запрос Xray перехватывается туннелем
 * и уходит обратно в Xray — вечный цикл («сайты не открываются»).
 * Поэтому адрес сервера заменяем на IP, разрешённый заранее, а
 * домен сохраняем в SNI/Host/authority — сервер видит тот же TLS,
 * что и при обычном подключении по домену.
 */
/** hopInterval «30s» → «30» (формат udpHop.interval в Xray) */
function hopIntervalSeconds(hopInterval?: string): string {
  const m = (hopInterval ?? '').match(/^(\d+)/)
  return m ? m[1] : '30'
}

export function withPinnedIp(server: ServerProfile, ip: string | null | undefined): ServerProfile {
  if (!ip || isIpLiteral(server.address)) return server
  const domain = server.address
  const stream: StreamSettings = { ...server.stream }
  const sb = server.sb ? { ...server.sb } : undefined

  if (stream.security === 'tls') {
    stream.tls = { ...(stream.tls ?? { serverName: '' }), serverName: stream.tls?.serverName || domain }
  }
  if (stream.security === 'reality' && stream.reality) {
    stream.reality = { ...stream.reality, serverName: stream.reality.serverName || domain }
  }
  if (stream.network === 'ws' && stream.ws) {
    stream.ws = { ...stream.ws, host: stream.ws.host || domain }
  }
  if (stream.network === 'httpupgrade' && stream.httpupgrade) {
    stream.httpupgrade = { ...stream.httpupgrade, host: stream.httpupgrade.host || domain }
  }
  if (stream.network === 'xhttp' && stream.xhttp) {
    stream.xhttp = { ...stream.xhttp, host: stream.xhttp.host || domain }
  }
  if (stream.network === 'grpc' && stream.grpc) {
    // authority пуст → Xray подставит адрес (уже IP) — за CDN это ломает роутинг
    stream.grpc = { ...stream.grpc, authority: stream.grpc.authority || domain }
  }
  // Hysteria2: домен живёт в sb.sni (serverName TLS) — меняем адрес
  // на IP, но исходный домен остаётся в SNI
  if (server.protocol === 'Hysteria2' && sb && !sb.sni) {
    sb.sni = domain
  }
  return { ...server, address: ip, stream, ...(sb ? { sb } : {}) }
}

function sniffing(destOverride: string[], routeOnly = false): Json {
  return { enabled: true, destOverride, routeOnly }
}

/** DNS-провайдер: IP для UDP-резолва через туннель (как v2rayN) */
function dnsIp(settings: AppSettings): string {
  switch (settings.dns) {
    case 'google':
      return '8.8.8.8'
    case 'quad9':
      return '9.9.9.9'
    case 'cloudflare':
    case 'auto':
    default:
      return '1.1.1.1'
  }
}

/** Есть ли у машины глобальный IPv6-адрес (2000::/3)? */
export function hasGlobalIpv6(): boolean {
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const iface of list ?? []) {
        if (iface.family === 'IPv6' && !iface.internal) {
          const scoped = (iface.address ?? '').toLowerCase()
          // глобальный юникаст начинается с 2xxx:/3xxx:, link-local — fe80::
          if (scoped.startsWith('2') || scoped.startsWith('3')) return true
        }
      }
    }
  } catch {
    /* best effort */
  }
  return false
}

// ------------------------------------------------------------
// Математика подсетей: 0.0.0.0/0 минус исключаемые IP
// (v2rayN делает то же самое для autoSystemRoutingTable)
// ------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!Number.isInteger(v) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n
}

function intToIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

/** '1.2.3.4/32' → [start, end] (только IPv4) */
function cidrToRange(cidr: string): [number, number] | null {
  const [ip, prefixStr] = cidr.split('/')
  const prefix = prefixStr === undefined ? 32 : Number(prefixStr)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const base = ipv4ToInt(ip ?? '')
  if (base === null) return null
  if (prefix === 0) return [0, 0xffffffff]
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const size = 1 << (32 - prefix)
  const start = (base & mask) >>> 0
  return [start, start + size - 1]
}

/** [start, end] → минимальный список CIDR */
function rangeToCidrs(start: number, end: number): string[] {
  const out: string[] = []
  let s = start
  while (s <= end) {
    // максимальный размер блока, выровненный по s и влезающий в end
    let maxSize = 1
    while (s % (maxSize * 2) === 0 && s + maxSize * 2 - 1 <= end && maxSize < 0x80000000) {
      maxSize *= 2
    }
    const prefix = 32 - Math.log2(maxSize)
    out.push(`${intToIpv4(s)}/${prefix}`)
    s += maxSize
  }
  return out
}

/**
 * 0.0.0.0/0 minus excluded CIDRs — так v2rayN строит таблицу
 * маршрутов TUN: серверные IP идут мимо туннеля (анти-цикл).
 */
function routingTableMinus(excludeCidrs: string[]): string[] {
  const holes: Array<[number, number]> = []
  for (const cidr of excludeCidrs) {
    const r = cidrToRange(cidr)
    if (r) holes.push(r)
  }
  if (holes.length === 0) return ['0.0.0.0/0']
  holes.sort((a, b) => a[0] - b[0])
  const out: string[] = []
  let cursor = 0
  for (const [hs, he] of holes) {
    if (hs > cursor) out.push(...rangeToCidrs(cursor, Math.min(hs - 1, 0xffffffff)))
    cursor = Math.max(cursor, he + 1)
  }
  if (cursor <= 0xffffffff) out.push(...rangeToCidrs(cursor, 0xffffffff))
  return out.length > 0 ? out : ['0.0.0.0/0']
}

function buildStreamSettings(stream: StreamSettings): Json {
  const out: Json = { network: stream.network, security: stream.security }

  if (stream.security === 'tls' && stream.tls) {
    const pin = stream.tls.pinnedPeerCertSha256 ? normalizePinToHex(stream.tls.pinnedPeerCertSha256) : null
    out.tlsSettings = {
      serverName: stream.tls.serverName,
      ...(stream.tls.fingerprint ? { fingerprint: stream.tls.fingerprint } : {}),
      ...(stream.tls.alpn?.length ? { alpn: stream.tls.alpn } : {}),
      ...(pin ? { pinnedPeerCertSha256: pin } : {})
    }
  }
  if (stream.security === 'reality' && stream.reality) {
    out.realitySettings = {
      serverName: stream.reality.serverName,
      fingerprint: stream.reality.fingerprint || 'chrome',
      publicKey: stream.reality.publicKey,
      shortId: stream.reality.shortId,
      ...(stream.reality.spiderX ? { spiderX: stream.reality.spiderX } : {})
    }
  }
  if (stream.network === 'ws' && stream.ws) {
    out.wsSettings = { path: stream.ws.path || '/', host: stream.ws.host || '' }
  }
  if (stream.network === 'grpc' && stream.grpc) {
    out.grpcSettings = {
      serviceName: stream.grpc.serviceName || '',
      ...(stream.grpc.authority ? { authority: stream.grpc.authority } : {})
    }
  }
  if (stream.network === 'httpupgrade' && stream.httpupgrade) {
    out.httpupgradeSettings = { path: stream.httpupgrade.path || '/', host: stream.httpupgrade.host || '' }
  }
  if (stream.network === 'xhttp' && stream.xhttp) {
    // Xray 26.x: network "xhttp" (ранее splithttp), режим — extra из ссылки
    out.xhttpSettings = {
      path: stream.xhttp.path || '/',
      host: stream.xhttp.host || '',
      ...(stream.xhttp.mode ? { mode: stream.xhttp.mode } : {})
    }
  }
  return out
}

function proxyOutbound(
  server: ServerProfile,
  settings: AppSettings,
  tag = 'proxy'
): Json {
  // В TUN-режиме адрес уже «пришпилен» IP (withPinnedIp) — домен
  // живёт в serverName/Host транспорта
  const stream = buildStreamSettings(server.stream)
  // mux несовместим с xhttp (у него собственный мультиплексор) и
  // не имеет смысла для QUIC (hysteria2) и WireGuard
  const mux = { enabled: settings.mux && server.stream.network !== 'xhttp', concurrency: 8 }
  const secret = server.uuid
  const sb = server.sb ?? {}

  // ---- Hysteria2 на Xray — один в один v2rayN master ----
  // protocol "hysteria", settings.version = 2, транспорт "hysteria"
  // + hysteriaSettings{version,auth} + finalmask{udp:[salamander],
  // quicParams{congestion, udpHop}} + tlsSettings{serverName, alpn,
  // fingerprint, pinnedPeerCertSha256}.
  if (server.protocol === 'Hysteria2') {
    // v2rayN FillBoundStreamSettings: tlsSettings{serverName(sni),
    // alpn(из ссылки), fingerprint, pinnedPeerCertSha256(CertSha)}
    const tlsSettings: Json = {
      serverName: sb.sni || (!isIpLiteral(server.address) ? server.address : '')
    }
    const pin = sb.pinSHA256 ? normalizePinToHex(sb.pinSHA256) : null
    if (pin) tlsSettings.pinnedPeerCertSha256 = pin
    if (sb.alpn?.length) tlsSettings.alpn = sb.alpn
    const hyStream: Json = {
      network: 'hysteria',
      security: 'tls',
      tlsSettings,
      hysteriaSettings: { version: 2, auth: sb.password ?? secret }
    }
    const quicParams: Json = {}
    if ((sb.upMbps ?? 0) > 0 || (sb.downMbps ?? 0) > 0) {
      quicParams.congestion = 'brutal'
      if ((sb.upMbps ?? 0) > 0) quicParams.brutalUp = `${sb.upMbps}mbps`
      if ((sb.downMbps ?? 0) > 0) quicParams.brutalDown = `${sb.downMbps}mbps`
    } else {
      quicParams.congestion = 'bbr'
    }
    if (sb.serverPorts) {
      quicParams.udpHop = {
        ports: sb.serverPorts.replace(/:/g, '-'),
        interval: hopIntervalSeconds(sb.hopInterval)
      }
    }
    const finalmask: Json = { quicParams }
    if (sb.obfsType) {
      const mask: Json = { password: sb.obfsPassword ?? '' }
      finalmask.udp = [{ type: 'salamander', settings: mask }]
    }
    hyStream.finalmask = finalmask
    return {
      tag,
      protocol: 'hysteria',
      settings: { address: server.address, port: server.port, version: 2 },
      streamSettings: hyStream
    }
  }

  // ---- WireGuard на Xray — как V2rayOutboundService (v2rayN) ----
  if (server.protocol === 'WireGuard') {
    const endpointHost = server.address.includes(':') ? `[${server.address}]` : server.address
    return {
      tag,
      protocol: 'wireguard',
      settings: {
        secretKey: sb.wgPrivateKey ?? secret,
        address: sb.wgAddresses?.length ? sb.wgAddresses : ['172.16.0.2/32'],
        peers: [
          {
            publicKey: sb.wgPeerPublicKey ?? '',
            endpoint: `${endpointHost}:${server.port}`,
            ...(sb.wgPreSharedKey ? { preSharedKey: sb.wgPreSharedKey } : {})
          }
        ],
        ...(sb.wgMtu ? { mtu: sb.wgMtu } : {}),
        ...(sb.wgDns?.length ? { remoteDNS: sb.wgDns } : {})
      }
    }
  }

  switch (server.protocol) {
    case 'VLESS':
      return {
        tag,
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: server.address,
              port: server.port,
              users: [
                {
                  id: secret,
                  encryption: 'none',
                  ...(server.flow ? { flow: server.flow } : {})
                }
              ]
            }
          ]
        },
        streamSettings: stream,
        mux
      }
    case 'VMess':
      return {
        tag,
        protocol: 'vmess',
        settings: {
          vnext: [
            {
              address: server.address,
              port: server.port,
              users: [{ id: secret, alterId: 0, security: 'auto' }]
            }
          ]
        },
        streamSettings: stream,
        mux
      }
    case 'Trojan':
      return {
        tag,
        protocol: 'trojan',
        settings: {
          servers: [{ address: server.address, port: server.port, password: secret }]
        },
        streamSettings: stream,
        mux
      }
    case 'Shadowsocks':
      return {
        tag,
        protocol: 'shadowsocks',
        settings: {
          servers: [
            {
              address: server.address,
              port: server.port,
              method: server.method || 'aes-256-gcm',
              password: secret
            }
          ]
        },
        streamSettings: stream,
        mux
      }
    default:
      // Hysteria(v1)/TUIC/AmneziaWG обслуживает только sing-box —
      // сюда мы не попадаем (см. shared/types.ts coreForProtocol)
      throw new Error(`protocol ${server.protocol} is not supported by Xray core`)
  }
}

/**
 * Локальные инбаунды — ровно как v2rayN: ОДИН mixed-порт
 * (protocol "mixed" обслуживает и socks, и http на одном порту;
 * системный прокси указывает на него). Готовность TUN-режима
 * определяется по строке «Xray … started», а не по порту.
 */
function localInbounds(ports: CorePorts): Json[] {
  return [
    {
      tag: 'mixed-in',
      port: ports.socks,
      listen: '127.0.0.1',
      protocol: 'mixed',
      settings: { auth: 'noauth', udp: true },
      sniffing: sniffing(['http', 'tls'])
    }
  ]
}

/**
 * НАТИВНЫЙ TUN-инбаунд Xray — один в один с v2rayN 7.x
 * (SampleTunInbound + V2rayInboundService.GenInbounds):
 *  - autoSystemRoutingTable: 0.0.0.0/0 (минус IP серверов) — на
 *    Windows заменяет таблицу маршрутов семейства;
 *  - autoOutboundsInterface: "auto" — ВСЕ исходящие сокеты ядра
 *    привязываются к физическому интерфейсу (не к TUN) →
 *    соединение с VPN-сервером физически не может завертеться
 *    в туннель (это и есть главный анти-цикл);
 *  - dns: адреса, назначаемые адаптеру (SetDNS) — Windows шлёт
 *    на них запросы, они попадают в TUN и перехватываются
 *    правилом роутинга (port 53 → outbound "dns").
 */
function tunInbound(settings: AppSettings, excludeIps: string[], adapterName: string): Json {
  const excludeCidrs = excludeIps
    .filter((ip) => !ip.includes(':'))
    .map((ip) => (ip.includes('/') ? ip : `${ip}/32`))
  const table = routingTableMinus(excludeCidrs)
  const ipv6 = settings.ipv6 && hasGlobalIpv6()
  if (ipv6) table.push('::/0')
  const dns = dnsIp(settings)
  return {
    tag: 'tun-in',
    protocol: 'tun',
    settings: {
      name: adapterName,
      MTU: TUN_MTU,
      gateway: [TUN_ADDRESS_V4, ...(settings.ipv6 ? [TUN_ADDRESS_V6] : [])],
      dns: [dns, '8.8.8.8'],
      autoSystemRoutingTable: table,
      autoOutboundsInterface: 'auto'
    },
    sniffing: sniffing(['http', 'tls'], true)
  }
}

/**
 * Правила маршрутизации.
 *  TUN: сначала гигиена Windows-мусора (как SampleTunRules v2rayN),
 *  затем перехват DNS из туннеля в DNS-модуль, затем process-
 *  исключения (раздельное туннелирование), private → direct и
 *  финальное правило. В режиме прокси — та же модель продукта
 *  без TUN-специфики.
 */
function routingRules(
  settings: AppSettings,
  excludedApps: AppRule[],
  mode: TransportMode
): Json[] {
  const rules: Json[] = []

  if (mode === 'tun') {
    // v2rayN SampleTunRules: не тянем в туннель windows-junk UDP и multicast
    rules.push({ type: 'field', network: 'udp', port: '135,137-139,5353', outboundTag: 'block' })
    rules.push({ type: 'field', ip: ['224.0.0.0/3', 'ff00::/8'], outboundTag: 'block' })
    // DNS из TUN → встроенный DNS-модуль Xray (hijack)
    rules.push({ type: 'field', inboundTag: ['tun-in'], port: 53, outboundTag: 'dns' })
    // страховка (v2rayN BuildRoutingDirectExe): процессы ядер не
    // заворачиваем в туннель. 'self/' — сам Xray, 'xray/' — путь к
    // бинарнику, 'sing-box' — по имени процесса
    rules.push({
      type: 'field',
      process: ['self/', 'xray/', 'sing-box', 'sing-box.exe'],
      outboundTag: 'direct'
    })
  }

  const processNames = excludedApps
    .filter((app) => app.enabled && app.appId.trim().length > 0)
    .map((app) => app.appId.trim())
  if (processNames.length > 0) {
    rules.push({ type: 'field', process: processNames, outboundTag: 'direct' })
  }

  rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' })

  const domains = settings.selectedDomains.map((d) => d.trim()).filter((d) => d.length > 0)
  if (domains.length > 0) {
    rules.push({ type: 'field', domain: domains, outboundTag: 'proxy' })
    rules.push({ type: 'field', network: 'tcp,udp', outboundTag: 'direct' })
  } else {
    rules.push({ type: 'field', network: 'tcp,udp', outboundTag: 'proxy' })
  }

  return rules
}

/**
 * DNS-модуль Xray (v2rayN-схема):
 *  - домен VPN-сервера → 'localhost' (системный DNS, напрямую);
 *  - основной резолвер — IP выбранного провайдера: его запросы
 *    идут через routing → proxy, то есть DNS разрешается ЧЕРЕЗ
 *    туннель (нет утечек к провайдеру и DNS-подмен);
 *  - запасной — второй публичный IP.
 */
function dnsConfig(settings: AppSettings, server: ServerProfile): Json {
  const primary = dnsIp(settings)
  const fallback = primary === '8.8.8.8' ? '1.1.1.1' : '8.8.8.8'
  const sDomain = server.address && !isIpLiteral(server.address) ? server.address : null
  return {
    servers: [
      ...(sDomain
        ? [{ address: 'localhost', domains: [sDomain, `domain:${sDomain}`], skipFallback: true }]
        : []),
      primary,
      fallback
    ],
    queryStrategy: settings.ipv6 ? 'UseIP' : 'UseIPv4'
  }
}

/**
 * Сборка полного config.json для xray-core.
 * Результат гарантированно сериализуем в JSON (никаких undefined).
 */
export function buildXrayConfig(
  settings: AppSettings,
  server: ServerProfile,
  excludedApps: AppRule[],
  mode: TransportMode,
  ports: CorePorts = DEFAULT_PORTS,
  serverIp?: string | null,
  excludeIps?: string[],
  tunAdapterName?: string
): Json {
  // IP подставляем только в TUN-режиме: в прокси-режиме Xray сам
  // нормально разрешает домен через системный DNS (TUN нет — цикла нет)
  const effective = mode === 'tun' ? withPinnedIp(server, serverIp) : server
  const inbounds = localInbounds(ports)
  if (mode === 'tun') {
    inbounds.push(tunInbound(settings, excludeIps ?? [], tunAdapterName || TUN_IFACE))
  }
  return {
    log: { loglevel: 'warning' },
    dns: dnsConfig(settings, server),
    // v2rayN GenStatistic: stats + metrics + policy.system.statsOutbound*.
    // Опрос — GET /debug/vars (StatisticsXrayService), без dokodemo
    // api-инбаунда и правила api→api («non existing outTag: api»)
    stats: {},
    policy: {
      system: {
        statsOutboundUplink: true,
        statsOutboundDownlink: true
      }
    },
    metrics: { listen: `127.0.0.1:${ports.api}` },
    inbounds,
    outbounds: [
      proxyOutbound(effective, settings),
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
      { tag: 'dns', protocol: 'dns' }
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: routingRules(settings, excludedApps, mode)
    }
  }
}

/**
 * Минимальный конфиг для замера реального пинга (врем. инстанс ядра):
 * один http-инбаунд + outbound сервера. Без статистики, api и routing —
 * весь трафик инбаунда уходит в первый outbound ('proxy').
 */
export function buildXrayLatencyConfig(
  server: ServerProfile,
  settings: AppSettings,
  httpPort: number,
  serverIp?: string | null
): Json {
  // Пиннинг и для замера: при живом TUN системный DNS временного
  // ядра уходит в туннель — а туннель может быть нерабочим.
  const effective = withPinnedIp(server, serverIp)
  return {
    log: { loglevel: 'error' },
    inbounds: [
      {
        tag: 'http-in',
        port: httpPort,
        listen: '127.0.0.1',
        protocol: 'http',
        settings: {},
        sniffing: sniffing(['http', 'tls'])
      }
    ],
    outbounds: [proxyOutbound(effective, settings), { tag: 'direct', protocol: 'freedom' }]
  }
}

/**
 * Мульти-серверный speedtest-конфиг — 1:1 v2rayN
 * GenerateClientSpeedtestConfig: на КАЖДЫЙ сервер свой mixed-инбаунд
 * (уникальный порт) + свой outbound, а routing связывает их парой
 * правил inboundTag → outboundTag. Один процесс Xray тестирует ВСЕ
 * серверы параллельно — ровно как «Test real delay» в v2rayN.
 */
export interface XraySpeedtestEntry {
  server: ServerProfile
  port: number
  /** «Пришпиленный» IP (анти-цикл при живом TUN) */
  serverIp?: string | null
}

export function buildXraySpeedtestConfig(
  entries: XraySpeedtestEntry[],
  settings: AppSettings
): Json {
  const inbounds: Json[] = []
  const outbounds: Json[] = [{ tag: 'direct', protocol: 'freedom' }]
  const rules: Json[] = []
  for (const { server, port, serverIp } of entries) {
    const inTag = `in${port}`
    const outTag = `proxy${port}`
    // v2rayN: mixed-инбаунд, udp, noauth, БЕЗ sniffing — домен из
    // прокси-запроса уходит на сервер как есть (remote resolution)
    inbounds.push({
      tag: inTag,
      listen: '127.0.0.1',
      port,
      protocol: 'mixed',
      settings: { udp: true, auth: 'noauth' }
    })
    outbounds.push(proxyOutbound(withPinnedIp(server, serverIp), settings, outTag))
    rules.push({ type: 'field', inboundTag: [inTag], outboundTag: outTag })
  }
  return {
    log: { loglevel: 'error' },
    inbounds,
    outbounds,
    routing: { rules }
  }
}
