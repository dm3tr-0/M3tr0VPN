// ============================================================
// M3tr0VPN — генератор config.json для sing-box.
// Ядро: sing-box 1.13.x (extended-сборка с AmneziaWG).
// Все конструкции проверены `sing-box check` на 1.13.16-extended:
//  - mixed/tun инбаунды, sniff/hijack-dns как rule actions;
//  - hysteria/hysteria2/tuic outbounds (server_ports «1000:2000»);
//  - wireguard ENDPOINT (outbound wg удалён в 1.13) + amnezia;
//  - vless/vmess/trojan/shadowsocks outbounds (когда ядро для
//    протокола переключено на sing-box в настройках);
//  - process_name (исключения приложений) — только в TUN;
//  - clash_api /connections → uploadTotal/downloadTotal;
//  - DNS: новый формат (type: udp|local) + route.default_domain_resolver.
// Роли: 'proxy' (системный прокси) и 'tun-direct' (TUN со своим
// outbound). TUN для xray-протоколов больше НЕ здесь — его
// поднимает сам Xray (нативный tun-инбаунд, как в v2rayN 7.x).
// ============================================================

import type {
  AppRule,
  AppSettings,
  ServerProfile,
  StreamSettings,
  TransportMode
} from '@shared/types'
import type { CorePorts } from '../ports'
import { isIpLiteral } from '../resolve'

type Json = Record<string, unknown>

const TUN_ADDRESS_V4 = '172.19.0.1/30'
const TUN_ADDRESS_V6 = 'fdfe:dcba:9876::1/126'
const TUN_IFACE = 'M3tr0VPN'

/**
 * Роль конфига sing-box:
 *  - 'proxy'      : режим системного прокси (mixed-инбаунд + outbound);
 *  - 'tun-direct' : TUN для sing-box-протокола (tun + свой outbound).
 */
export type SingboxRole = 'proxy' | 'tun-direct'

export interface SingboxStartInput {
  server: ServerProfile
  settings: AppSettings
  appRules: AppRule[]
  mode: TransportMode
  role: SingboxRole
  ports: CorePorts
  /**
   * Разрешённые заранее IP всех серверов (подписка + ручные).
   * Исключаются из маршрутов TUN (route_exclude_address) — иначе
   * соединение ядра с VPN-сервером снова попадает в TUN: цикл,
   * из-за которого «сайты не открываются». Плюс сквозной замер
   * пинга при живом туннеле идёт напрямую, а не через него.
   */
  excludeIps?: string[]
  /**
   * Разрешённый заранее IP выбранного сервера — «пришпиливается»
   * в адрес endpoint'а WireGuard/AWG (домен остаётся только в SNI
   * TLS-протоколов). В TUN-режиме это разрывает цикл «endpoint
   * домен → системный DNS → туннель → endpoint». Обязательно для
   * AmneziaWG (лог 19.09: днс внутри туннеля умирал, пока не
   * поднялся WireGuard, а он не поднимался, пока не разрешился домен).
   */
  serverIp?: string | null
  /** Имя TUN-адаптера (ротация при retry — обходит wintun-коллизии) */
  tunAdapterName?: string
}

function dnsServerAddress(settings: AppSettings): string {
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

/**
 * DNS-адрес для WG/AWG: как wg-quick/Amnezia — DNS из конфига
 * (поле DNS = …) имеет приоритет над выбором пользователя.
 */
function dnsServerAddressFor(server: ServerProfile, settings: AppSettings): string {
  if (
    (server.protocol === 'WireGuard' || server.protocol === 'AmneziaWG') &&
    server.sb?.wgDns?.length
  ) {
    const first = server.sb.wgDns[0].replace(/\/.*$/, '').trim()
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(first)) return first
  }
  return dnsServerAddress(settings)
}

function tlsBlock(server: ServerProfile): Json {
  const sb = server.sb ?? {}
  return {
    enabled: true,
    ...(sb.sni ? { server_name: sb.sni } : {}),
    ...(sb.insecure ? { insecure: true } : {}),
    ...(sb.alpn?.length ? { alpn: sb.alpn } : {})
  }
}

/** Домен сервера, если адрес — не IP-литерал (для анти-цикла DNS) */
function serverDomain(server: ServerProfile): string | null {
  return server.address && !isIpLiteral(server.address) ? server.address : null
}

/** CIDR-вид для route_exclude_address (1.2.3.4 → 1.2.3.4/32) */
function toCidr(ip: string): string {
  return ip.includes('/') ? ip : ip.includes(':') ? `${ip}/128` : `${ip}/32`
}

/** TLS/Reality блок sing-box из StreamSettings сервера */
function streamTls(stream: StreamSettings): Json | undefined {
  if (stream.security === 'tls' && stream.tls) {
    return {
      enabled: true,
      server_name: stream.tls.serverName,
      ...(stream.tls.alpn?.length ? { alpn: stream.tls.alpn } : {}),
      ...(stream.tls.fingerprint
        ? { utls: { enabled: true, fingerprint: stream.tls.fingerprint } }
        : {})
    }
  }
  if (stream.security === 'reality' && stream.reality) {
    return {
      enabled: true,
      server_name: stream.reality.serverName,
      utls: { enabled: true, fingerprint: stream.reality.fingerprint || 'chrome' },
      reality: {
        enabled: true,
        public_key: stream.reality.publicKey,
        short_id: stream.reality.shortId
      }
    }
  }
  return undefined
}

/** Транспорт sing-box из StreamSettings сервера */
function streamTransport(stream: StreamSettings): Json | undefined {
  switch (stream.network) {
    case 'ws':
      return {
        type: 'ws',
        path: stream.ws?.path || '/',
        ...(stream.ws?.host ? { headers: { Host: stream.ws.host } } : {})
      }
    case 'grpc':
      return { type: 'grpc', service_name: stream.grpc?.serviceName || '' }
    case 'httpupgrade':
      return {
        type: 'httpupgrade',
        path: stream.httpupgrade?.path || '/',
        host: stream.httpupgrade?.host || ''
      }
    default:
      return undefined
  }
}

/** Outbound выбранного протокола (тег настраивается — для speedtest-конфига). */
function protocolOutbound(
  server: ServerProfile,
  serverIp?: string | null,
  tag = 'proxy'
): Json {
  const sb = server.sb ?? {}
  // «Пришпиливаем» IP (замер пинга при живом TUN): домен уходит в SNI
  const address = serverIp && !isIpLiteral(server.address) ? serverIp : server.address
  const sniFallback = serverIp && !isIpLiteral(server.address) ? server.address : undefined
  switch (server.protocol) {
    case 'Hysteria2':
      return {
        type: 'hysteria2',
        tag,
        server: address,
        server_port: server.port,
        password: sb.password ?? server.uuid,
        ...(sb.serverPorts ? { server_ports: [sb.serverPorts] } : {}),
        ...(sb.hopInterval ? { hop_interval: sb.hopInterval } : {}),
        ...(sb.obfsType
          ? { obfs: { type: 'salamander', ...(sb.obfsPassword ? { password: sb.obfsPassword } : {}) } }
          : {}),
        ...(sb.upMbps ? { up_mbps: sb.upMbps } : {}),
        ...(sb.downMbps ? { down_mbps: sb.downMbps } : {}),
        tls: { ...tlsBlock(server), ...(sniFallback ? { server_name: sb.sni || sniFallback } : {}) }
      }
    case 'Hysteria':
      return {
        type: 'hysteria',
        tag,
        server: address,
        server_port: server.port,
        auth_str: sb.password ?? server.uuid,
        ...(sb.upMbps ? { up_mbps: sb.upMbps } : {}),
        ...(sb.downMbps ? { down_mbps: sb.downMbps } : {}),
        ...(sb.obfsType === 'salamander' && sb.obfsPassword
          ? { obfs: 'salamander', obfs_password: sb.obfsPassword }
          : {}),
        tls: { ...tlsBlock(server), ...(sniFallback ? { server_name: sb.sni || sniFallback } : {}) }
      }
    case 'TUIC':
      return {
        type: 'tuic',
        tag,
        server: address,
        server_port: server.port,
        uuid: server.uuid,
        password: sb.tuicPassword ?? '',
        ...(sb.congestionControl ? { congestion_control: sb.congestionControl } : {}),
        ...(sb.udpRelayMode ? { udp_relay_mode: sb.udpRelayMode } : {}),
        tls: { ...tlsBlock(server), ...(sniFallback ? { server_name: sb.sni || sniFallback } : {}) }
      }
    case 'WireGuard':
    case 'AmneziaWG': {
      const peer: Json = {
        address: address,
        port: server.port,
        public_key: sb.wgPeerPublicKey ?? '',
        allowed_ips: ['0.0.0.0/0', '::/0']
      }
      if (sb.wgPreSharedKey) peer.pre_shared_key = sb.wgPreSharedKey
      if (sb.wgKeepalive) peer.persistent_keepalive_interval = sb.wgKeepalive
      const amnezia = sb.amnezia
      const amneziaBlock: Json | null = amnezia
        ? {
            ...(amnezia.jc ? { jc: amnezia.jc } : {}),
            ...(amnezia.jmin ? { jmin: amnezia.jmin } : {}),
            ...(amnezia.jmax ? { jmax: amnezia.jmax } : {}),
            ...(amnezia.s1 ? { s1: amnezia.s1 } : {}),
            ...(amnezia.s2 ? { s2: amnezia.s2 } : {}),
            ...(amnezia.s3 ? { s3: amnezia.s3 } : {}),
            ...(amnezia.s4 ? { s4: amnezia.s4 } : {}),
            // AWG 1.0: заголовки — ДИАПАЗОНЫ («88» / «88-157»),
            // сырой строкой из конфига (badoption.Range понимает обе)
            ...(amnezia.h1 ? { h1: amnezia.h1 } : {}),
            ...(amnezia.h2 ? { h2: amnezia.h2 } : {}),
            ...(amnezia.h3 ? { h3: amnezia.h3 } : {}),
            ...(amnezia.h4 ? { h4: amnezia.h4 } : {}),
            // AWG 2.0 «магия» спец-хендшейков — строки-цепочки
            ...(amnezia.i1 ? { i1: amnezia.i1 } : {}),
            ...(amnezia.i2 ? { i2: amnezia.i2 } : {}),
            ...(amnezia.i3 ? { i3: amnezia.i3 } : {}),
            ...(amnezia.i4 ? { i4: amnezia.i4 } : {}),
            ...(amnezia.i5 ? { i5: amnezia.i5 } : {}),
            // AWG 2.1+ / sing-box-extended: HPK (base64 → UAPI hex
            // делает сам sing-box), паддинг, тайминги.
            // ВНИМАНИЕ: random_trailers/disable_cookies есть в UAPI
            // форка, но НЕТ ни в одном релизном бинарнике (проверено
            // 2.6.5 и 2.7.1) — не эмитим, иначе весь конфиг отвергнут.
            ...(amnezia.headerProtectionKey
              ? { header_protection_key: amnezia.headerProtectionKey }
              : {}),
            ...(amnezia.contentPaddingAddition
              ? { content_padding_addition: amnezia.contentPaddingAddition }
              : {}),
            ...(amnezia.rekeyAfterTime ? { rekey_after_time: amnezia.rekeyAfterTime } : {}),
            ...(amnezia.rekeyTimeout ? { rekey_timeout: amnezia.rekeyTimeout } : {}),
            ...(amnezia.rejectAfterTime ? { reject_after_time: amnezia.rejectAfterTime } : {}),
            ...(amnezia.keepaliveTimeout ? { keepalive_timeout: amnezia.keepaliveTimeout } : {}),
            ...(amnezia.maxHandshakeAttempts
              ? { max_handshake_attempts: amnezia.maxHandshakeAttempts }
              : {})
          }
        : null
      return {
        type: 'wireguard',
        tag,
        // КРИТИЧНО для Windows: без detour sing-box использует
        // WinRingBind, который ВСЕГДА открывает и AF_INET6-сокет —
        // на системах с отключённым/сломанным IPv6 это WSAEINVAL
        // «unable to update bind» и полностью мёртвый WireGuard/AWG.
        // С detour используется ClientBind: один udp4-сокет
        // (или подключённый сокет до сервера) через direct-outbound.
        detour: 'direct',
        address: sb.wgAddresses?.length ? sb.wgAddresses : ['172.16.0.2/32'],
        private_key: sb.wgPrivateKey ?? '',
        ...(sb.wgMtu ? { mtu: sb.wgMtu } : {}),
        ...(server.protocol === 'AmneziaWG' && amneziaBlock ? { amnezia: amneziaBlock } : {}),
        peers: [peer]
      }
    }
    // ---- протоколы «на базе Xray», переключённые на sing-box ----
    case 'VLESS':
      return {
        type: 'vless',
        tag,
        server: address,
        server_port: server.port,
        uuid: server.uuid,
        ...(server.flow ? { flow: server.flow } : {}),
        ...(streamTls(server.stream)
          ? {
              tls: {
                ...streamTls(server.stream),
                ...(sniFallback && !streamTls(server.stream)?.server_name
                  ? { server_name: sniFallback }
                  : {})
              }
            }
          : sniFallback
            ? { tls: { enabled: true, server_name: sniFallback } }
            : {}),
        ...(streamTransport(server.stream) ?? {})
      }
    case 'VMess':
      return {
        type: 'vmess',
        tag,
        server: address,
        server_port: server.port,
        uuid: server.uuid,
        security: 'auto',
        alter_id: 0,
        ...(streamTls(server.stream) ?? {}),
        ...(streamTransport(server.stream) ?? {})
      }
    case 'Trojan':
      return {
        type: 'trojan',
        tag,
        server: address,
        server_port: server.port,
        password: server.uuid,
        ...(streamTls(server.stream) ?? {}),
        ...(streamTransport(server.stream) ?? {})
      }
    case 'Shadowsocks':
      return {
        type: 'shadowsocks',
        tag,
        server: address,
        server_port: server.port,
        method: server.method || 'aes-256-gcm',
        password: server.uuid
      }
    default:
      throw new Error(`protocol ${server.protocol} is not supported by sing-box`)
  }
}

/**
 * Правила маршрутизации (модель продукта — та же, что у Xray):
 *  TUN: process-исключения → direct; домен VPN-сервера → direct
 *  (анти-цикл); geo private → direct; selectedDomains непуст →
 *  эти домены → proxy + final direct; пуст → final proxy.
 *  В режиме proxy (без TUN) process-правила не применяются.
 */
function routeRules(
  settings: AppSettings,
  excludedApps: AppRule[],
  withTun: boolean,
  sDomain: string | null
): Json[] {
  const rules: Json[] = []
  if (withTun) {
    rules.push({ action: 'sniff' })
    rules.push({ protocol: 'dns', action: 'hijack-dns' })
    // Домен самого VPN-сервера — напрямую (страховка пиннинга IP):
    // пока SNI не снифнут, соответствие по имени не сработает, но
    // для hijack-dns-запросов работает dns-правило ниже
    if (sDomain) {
      rules.push({ domain: [sDomain], domain_suffix: [`.${sDomain}`], outbound: 'direct' })
    }
    const processNames = excludedApps
      .filter((app) => app.enabled && app.appId.trim().length > 0)
      .map((app) => app.appId.trim())
    if (processNames.length > 0) {
      rules.push({ process_name: processNames, outbound: 'direct' })
    }
  }
  rules.push({ ip_is_private: true, outbound: 'direct' })

  const domains = settings.selectedDomains.map((d) => d.trim()).filter((d) => d.length > 0)
  if (domains.length > 0) {
    rules.push({ domain_suffix: domains, outbound: 'proxy' })
  }
  return rules
}

/**
 * Сборка полного config.json для sing-box.
 * Результат гарантированно сериализуем в JSON (никаких undefined).
 */
export function buildSingboxConfig(opts: SingboxStartInput): Json {
  const { server, settings, appRules, role, ports, excludeIps, serverIp, tunAdapterName } = opts
  const withTun = role !== 'proxy'
  const sDomain = serverDomain(server)
  const excludeCidrs = (excludeIps ?? []).map(toCidr).filter((c) => c)

  const inbounds: Json[] = []
  if (role === 'proxy') {
    inbounds.push({
      type: 'mixed',
      tag: 'mixed-in',
      listen: '127.0.0.1',
      listen_port: ports.http
    })
  } else {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: tunAdapterName || TUN_IFACE,
      address: [TUN_ADDRESS_V4, ...(settings.ipv6 ? [TUN_ADDRESS_V6] : [])],
      mtu: 9000,
      auto_route: true,
      // v2rayN (tun_singbox_inbound): strict_route ВЫКЛЮЧЕН — на
      // Windows strict_route добавляет WFP-правила, которые ломают
      // входящий UDP (ответы WireGuard-сервера) на части машин
      strict_route: false,
      // IP VPN-серверов — МИМО туннеля: соединение ядра с сервером
      // не должно заворачиваться обратно в туннель (иначе цикл)
      ...(excludeCidrs.length > 0 ? { route_exclude_address: excludeCidrs } : {})
    })
  }

  const outbounds: Json[] = []
  const endpoints: Json[] = []
  if (server.protocol === 'WireGuard' || server.protocol === 'AmneziaWG') {
    // В sing-box 1.11+ WireGuard — ENDPOINT (outbound удалён в 1.13);
    // адрес — «пришпиленный» IP (анти-цикл DNS, см. serverIp)
    endpoints.push(protocolOutbound(server, serverIp ?? null))
  } else {
    outbounds.push(protocolOutbound(server, serverIp ?? null))
  }
  outbounds.push({ type: 'direct', tag: 'direct' })

  const domains = settings.selectedDomains.map((d) => d.trim()).filter((d) => d.length > 0)

  const config: Json = {
    // AmneziaWG — уровень 'debug': видны строки wireguard-форка
    // («Sending handshake initiation», ответы сервера) — без них
    // «не подключается» не диагностировать (лог 19.09)
    log: {
      level: server.protocol === 'AmneziaWG' ? 'debug' : 'warn',
      timestamp: true
    },
    dns: {
      servers: [
        // DoH вместо UDP: в цепочке ядро → сервер UDP-трафик может
        // не проходить, а DoH — это обычный TCP/TLS, работает всегда.
        // Для WG/AWG берём DNS из конфига (поле DNS = …), как wg-quick.
        {
          type: 'https',
          tag: 'remote',
          server: dnsServerAddressFor(server, settings),
          detour: 'proxy'
        },
        { type: 'local', tag: 'local' }
      ],
      // Домен VPN-сервера разрешаем локально (не через туннель!) —
      // иначе получается цикл «сервер через туннель, туннель через сервер»
      ...(sDomain
        ? { rules: [{ domain: [sDomain], domain_suffix: [`.${sDomain}`], server: 'local' }] }
        : {}),
      final: 'remote',
      strategy: settings.ipv6 ? 'prefer_ipv4' : 'ipv4_only'
    },
    inbounds,
    outbounds,
    route: {
      rules: routeRules(settings, appRules, withTun, sDomain),
      final: domains.length > 0 ? 'direct' : 'proxy',
      auto_detect_interface: withTun,
      default_domain_resolver: { server: 'local' }
    },
    experimental: {
      clash_api: {
        external_controller: `127.0.0.1:${ports.clash}`
      }
    }
  }
  if (endpoints.length > 0) {
    config.endpoints = endpoints
  }
  return config
}

/**
 * Минимальный конфиг для замера реального пинга (врем. инстанс ядра):
 * один mixed-инбаунд + outbound протокола. Без TUN, clash-api и статистики.
 * serverIp — «пришпиленный» IP (при живом TUN врем. ядро не должно
 * зависеть от DNS через этот же туннель).
 */
export function buildSingboxLatencyConfig(
  server: ServerProfile,
  httpPort: number,
  serverIp?: string | null
): Json {
  const outbounds: Json[] = []
  const endpoints: Json[] = []
  if (server.protocol === 'WireGuard' || server.protocol === 'AmneziaWG') {
    endpoints.push(protocolOutbound(server, serverIp))
  } else {
    outbounds.push(protocolOutbound(server, serverIp))
  }
  outbounds.push({ type: 'direct', tag: 'direct' })
  return {
    log: { level: 'error' },
    dns: { servers: [{ type: 'local', tag: 'local' }], final: 'local' },
    inbounds: [{ type: 'mixed', tag: 'test-in', listen: '127.0.0.1', listen_port: httpPort }],
    outbounds,
    ...(endpoints.length > 0 ? { endpoints } : {}),
    route: { final: 'proxy', default_domain_resolver: { server: 'local' } }
  }
}

/**
 * Мульти-серверный speedtest-конфиг — 1:1 v2rayN
 * GenerateClientSpeedtestConfig: на каждый сервер свой mixed-инбаунд
 * + свой outbound/endpoint, route-правила связывают их по тегам.
 * Один процесс sing-box тестирует ВСЕ sing-box-серверы параллельно.
 */
export interface SingboxSpeedtestEntry {
  server: ServerProfile
  port: number
  serverIp?: string | null
}

export function buildSingboxSpeedtestConfig(entries: SingboxSpeedtestEntry[]): Json {
  const inbounds: Json[] = []
  const outbounds: Json[] = [{ type: 'direct', tag: 'direct' }]
  const endpoints: Json[] = []
  const rules: Json[] = []
  for (const { server, port, serverIp } of entries) {
    const inTag = `in${port}`
    const outTag = `proxy${port}`
    inbounds.push({ type: 'mixed', tag: inTag, listen: '127.0.0.1', listen_port: port })
    if (server.protocol === 'WireGuard' || server.protocol === 'AmneziaWG') {
      endpoints.push(protocolOutbound(server, serverIp, outTag))
    } else {
      outbounds.push(protocolOutbound(server, serverIp, outTag))
    }
    rules.push({ inbound: [inTag], outbound: outTag })
  }
  return {
    log: { level: 'error' },
    dns: { servers: [{ type: 'local', tag: 'local' }], final: 'local' },
    inbounds,
    outbounds,
    ...(endpoints.length > 0 ? { endpoints } : {}),
    route: {
      rules,
      final: 'direct',
      default_domain_resolver: { server: 'local' }
    }
  }
}

/**
 * Человекочитаемое описание применённой обфускации AmneziaWG —
 * в журнал приложения (без секретов: только публичные параметры).
 * Если хандшейк не проходит — по этой строке сразу видно, какие
 * параметры реально дошли до ядра.
 */
export function describeAmnezia(server: ServerProfile): string | null {
  if (server.protocol !== 'AmneziaWG') return null
  const a = server.sb?.amnezia
  if (!a) return 'amnezia: no obfuscation params (plain WireGuard)'
  const chainLen = (s?: string): number => (s ? (s.match(/</g)?.length ?? 0) : 0)
  const parts: string[] = []
  if (a.jc) parts.push(`junk Jc=${a.jc} [${a.jmin ?? '?'}..${a.jmax ?? '?'}]`)
  if (a.s1 || a.s2 || a.s3 || a.s4) {
    parts.push(`pad S=[${a.s1 ?? '-'}|${a.s2 ?? '-'}|${a.s3 ?? '-'}|${a.s4 ?? '-'}]`)
  }
  if (a.h1 || a.h2 || a.h3 || a.h4) {
    parts.push(`hdr H=[${a.h1 ?? '-'}|${a.h2 ?? '-'}|${a.h3 ?? '-'}|${a.h4 ?? '-'}]`)
  }
  const ic = [a.i1, a.i2, a.i3, a.i4, a.i5].map(chainLen)
  if (ic.some((n) => n > 0)) {
    parts.push(`I-chains=[${ic.map((n, i) => (n > 0 ? `I${i + 1}:${n}` : '-')).join(' ')}]`)
  }
  if (a.headerProtectionKey) parts.push('HPK=yes')
  if (a.contentPaddingAddition) parts.push(`cpa=${a.contentPaddingAddition}`)
  if (a.randomTrailers) parts.push('random-trailers')
  if (a.disableCookies) parts.push('no-cookies')
  if (a.rekeyTimeout) parts.push(`rekey=${a.rekeyTimeout}s`)
  return `amnezia: ${parts.length > 0 ? parts.join(', ') : 'no obfuscation params'}`
}
