// ============================================================
// M3tr0VPN Desktop — общие типы (main + preload + renderer)
// Расширенная версия контракта веб-прототипа (src/lib/types.ts):
// добавлены реальные параметры транспорта (StreamSettings),
// режим работы ядра (proxy | tun) и статус соединения.
// ============================================================

export type Protocol =
  | 'VLESS'
  | 'VMess'
  | 'Trojan'
  | 'Shadowsocks'
  | 'Hysteria2'
  | 'Hysteria'
  | 'TUIC'
  | 'WireGuard'
  | 'AmneziaWG'

/**
 * Протоколы, которые умеет ТОЛЬКО sing-box (в Xray-core их нет):
 * Hysteria (v1) и TUIC (v2rayN тоже гоняет их на sing-box),
 * AmneziaWG (extended-сборка sing-box — единственное ядро с обфускацией WG).
 */
export const SINGBOX_PROTOCOLS: readonly Protocol[] = ['Hysteria', 'TUIC', 'AmneziaWG']

export function isSingboxProtocol(protocol: string): boolean {
  return (SINGBOX_PROTOCOLS as readonly string[]).includes(protocol)
}

/** Ядро, обслуживающее протокол */
export type CoreKind = 'xray' | 'singbox'

/**
 * Протоколы, для которых ядро можно переключить в настройках
 * (оба ядра их поддерживают). Дефолт — Xray для ВСЕХ, как в v2rayN
 * 7.24.9: Hysteria2 работает на Xray («hysteria» с version 2),
 * WireGuard — тоже (нативный wireguard-outbound).
 */
export const OVERRIDABLE_PROTOCOLS: readonly Protocol[] = [
  'VLESS',
  'VMess',
  'Trojan',
  'Shadowsocks',
  'Hysteria2',
  'WireGuard'
]

/** Схема «как в v2rayN» (GetCoreType): переопределение → дефолт Xray */
export function coreForProtocol(
  protocol: string,
  overrides?: Partial<Record<Protocol, CoreKind>> | null
): CoreKind {
  const p = protocol as Protocol
  if (isSingboxProtocol(p)) return 'singbox'
  const override = overrides?.[p]
  if (override === 'singbox' || override === 'xray') return override
  return 'xray'
}

/**
 * Финальное ядро для сервера с учётом транспорта: xhttp умеет
 * только Xray (sing-box не поддерживает — v2rayN тоже отказывается
 * генерировать такой конфиг и оставляет его на Xray).
 */
export function effectiveCore(
  server: { protocol: string; stream?: { network?: string } | null },
  overrides?: Partial<Record<Protocol, CoreKind>> | null
): CoreKind {
  const kind = coreForProtocol(server.protocol, overrides)
  if (kind === 'singbox' && (server as { stream?: { network?: string } }).stream?.network === 'xhttp') {
    return 'xray'
  }
  return kind
}

export type Language = 'ru' | 'en'

export type DnsProvider = 'auto' | 'cloudflare' | 'google' | 'quad9'

/** Режим работы ядра: системный прокси или TUN-адаптер */
export type TransportMode = 'proxy' | 'tun'

export type StreamNetwork = 'tcp' | 'ws' | 'grpc' | 'httpupgrade' | 'xhttp'
export type StreamSecurity = 'none' | 'tls' | 'reality'

export interface StreamSettings {
  network: StreamNetwork
  security: StreamSecurity
  tls?: {
    serverName: string
    alpn?: string[]
    fingerprint?: string
    /** ссылка разрешает self-signed (allowInsecure/insecure=1) — Xray 26.x
     *  allowInsecure не умеет: включается TOFU-пин сертификата (см. cert-pin.ts) */
    insecure?: boolean
    /** SHA256 отпечаток сертификата (hex или base64url из ссылки pinSHA256/pcs) */
    pinnedPeerCertSha256?: string
  }
  reality?: {
    serverName: string
    fingerprint: string
    publicKey: string
    shortId: string
    spiderX?: string
  }
  ws?: { path: string; host: string }
  grpc?: { serviceName: string; authority?: string }
  httpupgrade?: { path: string; host: string }
  xhttp?: { path: string; host: string; mode?: string }
}

/**
 * AmneziaWG-параметры (обфускация WireGuard).
 * Формат 1:1 как в UAPI wireguard-go-форка и как в конфиге AmneziaWG:
 * H-поля — ДИАПАЗОНЫ («88» или «88-157»), поэтому передаются СЫРЫМИ
 * СТРОКАМИ (sing-box badoption.Range принимает и число, и «min-max»).
 */
export interface SingboxAmnezia {
  jc?: number
  jmin?: number
  jmax?: number
  s1?: number
  s2?: number
  s3?: number
  s4?: number
  /**
   * Заголовки пакетов (замена типа сообщения WireGuard). МОГУТ быть
   * диапазонами «88-157» — поэтому СЫРАЯ СТРОКА из конфига.
   */
  h1?: string
  h2?: string
  h3?: string
  h4?: string
  /**
   * AWG 2.0: «магия» спец-хендшейков — цепочки обфускации вида
   * `<b 0xc7…>` (sing-box-extended принимает их как СТРОКИ).
   * Если сервер использует AWG 2.0 с нестандартными I1–I5, клиент
   * ОБЯЗАН использовать те же значения — иначе хандшейк молча
   * отбрасывается сервером.
   */
  i1?: string
  i2?: string
  i3?: string
  i4?: string
  i5?: string
  /**
   * AWG 2.1+ (расширение sing-box-extended): защита заголовков.
   * Если задана на сервере и не передана клиентом — сервер молча
   * отбрасывает хандшейк.
   */
  headerProtectionKey?: string
  /** Дополнительная паддинг-обфускация полезной нагрузки (диапазон) */
  contentPaddingAddition?: string
  /** Тайминги хандшейка (диапазоны, сек) */
  rekeyAfterTime?: string
  rekeyTimeout?: string
  rejectAfterTime?: string
  keepaliveTimeout?: string
  maxHandshakeAttempts?: string
  /** Случайные «хвосты» пакетов (анти-фingerprinting размеров) */
  randomTrailers?: boolean
  /** Отключить cookie-механику WireGuard (режим anti-DoS off) */
  disableCookies?: boolean
}

/**
 * Поля сервера для протоколов sing-box (Hysteria/Hysteria2/TUIC/WireGuard/AmneziaWG).
 * Для WireGuard address/port — это Endpoint сервера.
 */
export interface SingboxServerFields {
  /** пароль/аутентификация (hysteria2 password, hysteria auth_str) */
  password?: string
  /** SHA256-пин сертификата из ссылки (pinSHA256/pcs); hex или base64url */
  pinSHA256?: string
  /** TUIC: uuid хранится в ServerProfile.uuid, пароль — здесь */
  tuicPassword?: string
  sni?: string
  insecure?: boolean
  alpn?: string[]
  obfsType?: 'salamander' | 'gecko'
  obfsPassword?: string
  /** порт-хоппинг, напр. "1000:2000" */
  serverPorts?: string
  hopInterval?: string
  upMbps?: number
  downMbps?: number
  congestionControl?: string
  udpRelayMode?: string
  /** WireGuard / AmneziaWG */
  wgPrivateKey?: string
  wgPeerPublicKey?: string
  wgPreSharedKey?: string
  /** адреса клиента внутри туннеля (AllowedIPs клиента) */
  wgAddresses?: string[]
  wgMtu?: number
  wgDns?: string[]
  wgKeepalive?: number
  amnezia?: SingboxAmnezia
}

export interface ServerProfile {
  id: string
  name: string
  protocol: Protocol
  address: string
  port: number
  country: string
  /** vless/vmess: UUID; trojan/ss: пароль */
  uuid: string
  /** шифр Shadowsocks (aes-256-gcm по умолчанию) */
  method?: string
  /** vless flow (xtls-rprx-vision) */
  flow?: string
  stream: StreamSettings
  /** Параметры для протоколов sing-box (Hysteria/TUIC/WireGuard/…) */
  sb?: SingboxServerFields
  latencyMs: number | null
  /** Причина последнего неуспешного замера пинга (DNS/таймаут/отказ) */
  latencyError?: string | null
  /** Загрузка сервера, 0..100 (для ручных серверов — 0) */
  load: number
  subscriptionId: string | null
  subscriptionName?: string | null
  createdAt: string
}

export interface SubscriptionUserInfo {
  upload: number
  download: number
  total?: number
  /** Unix-секунды */
  expire?: number
}

export interface Subscription {
  id: string
  name: string
  url: string
  serverCount: number
  updatedAt: string
  /** Трафик подписки из заголовка subscription-userinfo */
  userInfo?: SubscriptionUserInfo
  /** Имя получено с сервера (обновляется при refresh), а не задано пользователем */
  autoName?: boolean
  /** Ссылка на сайт провайдера (заголовок profile-web-page-url в 3x-ui) */
  websiteUrl?: string | null
  /** Ссылка на поддержку (заголовок support-url в 3x-ui) */
  supportUrl?: string | null
}

/** Приложение-исключение: его процессы ходят напрямую, минуя VPN */
export interface AppRule {
  id: string
  /** Имя процесса (chrome.exe, qbittorrent.exe, …) */
  appId: string
  appName: string
  /** Имя иконки lucide-react */
  icon: string
  /** Выключено — приложение снова идёт через VPN (не удаляясь из списка) */
  enabled: boolean
}

export interface AppSettings {
  language: Language
  autoConnect: boolean
  launchAtStartup: boolean
  ipv6: boolean
  mux: boolean
  dns: DnsProvider
  selectedServerId: string | null
  /**
   * «Выбранное» — сайты, которые идут через VPN.
   * Пустой список = весь трафик через VPN (поведение по умолчанию).
   * Непустой = только эти домены (включая поддомены) через VPN.
   */
  selectedDomains: string[]
  /** Режим работы: системный прокси | TUN-адаптер */
  transportMode: TransportMode
  /** Автообновление подписок при запуске приложения */
  autoUpdateSubs: boolean
  /**
   * Ядро для каждого протокола (как «Core type settings» в v2rayN).
   * Заполняется только для OVERRIDABLE_PROTOCOLS; отсутствие записи = xray.
   */
  coreOverrides?: Partial<Record<Protocol, CoreKind>>
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionStatus {
  state: ConnectionState
  serverId: string | null
  serverLabel: string
  protocol: string
  transport: TransportMode | null
  since: number | null
  error: string | null
  /** Байт/сек через ядро */
  speedDown: number
  speedUp: number
  /** Всего за сессию, байт */
  totalDown: number
  totalUp: number
}

export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'core' | 'app'

export interface LogEntry {
  t: number
  level: LogLevel
  source: LogSource
  message: string
}

/** Снимок всего состояния, который renderer получает по IPC */
export interface AppStateSnapshot {
  servers: ServerProfile[]
  subscriptions: Subscription[]
  appRules: AppRule[]
  settings: AppSettings
  status: ConnectionStatus
  logs: LogEntry[]
  coreVersion: string
  singboxVersion: string
  appVersion: string
  platform: string
  isElevated: boolean
  transportAvailable: { tun: boolean }
}

/** Почему домен идёт через VPN или напрямую (движок проверки маршрута) */
export type RouteReason = 'all-vpn' | 'in-selected' | 'not-in-selected'

export interface RouteCheckResult {
  throughVpn: boolean
  reasonKey: RouteReason
  matchedPattern?: string
}

export interface SpeedTick {
  down: number
  up: number
  totalDown: number
  totalUp: number
}
