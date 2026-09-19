// ============================================================
// M3tr0VPN — парсер конфигурационных URI.
// Порт логики v2rayN / 3x-ui:
//  - vless / vmess / trojan / ss (SIP002 + legacy);
//  - hysteria2 (hy2://, hysteria2://), hysteria (v1);
//  - tuic; wireguard (wg://, wireguard://); AmneziaWG (vpn:// base64 conf).
// Страна определяется по эмодзи-флагу в имени (приоритет),
// затем по названию страны/города. TLD адреса больше НЕ используется
// (домен панели .ru у польского сервера давал «все RU»).
// ============================================================

import { randomUUID } from 'crypto'
import type { Protocol, ServerProfile, SingboxServerFields, StreamSettings } from '@shared/types'

function b64decode(s: string): string {
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function defaultStream(): StreamSettings {
  return { network: 'tcp', security: 'none' }
}

// ------------------------------------------------------------
// Определение страны по имени сервера
// ------------------------------------------------------------

const FLAG_EMOJI_RE = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g

/** «🇵🇱» → 'PL' */
function emojiToCountry(flag: string): string {
  const a = flag.codePointAt(0) ?? 0
  const b = flag.codePointAt(2) ?? 0
  return String.fromCharCode(0x41 + (a - 0x1f1e6), 0x41 + (b - 0x1f1e6))
}

/** Названия стран EN/RU и города → ISO-код */
const COUNTRY_TOKENS: Array<[string, string]> = [
  ['NL', 'NL'], ['НИДЕРЛАНД', 'NL'], ['AMSTERDAM', 'NL'], ['НИДЕРЛАНДЫ', 'NL'],
  ['DE', 'DE'], ['ГЕРМАН', 'DE'], ['GERMANY', 'DE'], ['DEUTSCHLAND', 'DE'], ['FRANKFURT', 'DE'], ['ФРАНКФУРТ', 'DE'], ['FALKENSTEIN', 'DE'], ['NUREMBERG', 'DE'], ['NURNBERG', 'DE'],
  ['FI', 'FI'], ['ФИНЛЯНД', 'FI'], ['FINLAND', 'FI'], ['HELSINKI', 'FI'], ['ХЕЛЬСИНКИ', 'FI'],
  ['SE', 'SE'], ['ШВЕЦИ', 'SE'], ['SWEDEN', 'SE'], ['STOCKHOLM', 'SE'], ['СТОКГОЛЬМ', 'SE'],
  ['PL', 'PL'], ['ПОЛЬШ', 'PL'], ['POLAND', 'PL'], ['POLSKA', 'PL'], ['WARSAW', 'PL'], ['ВАРШАВ', 'PL'], ['GDANSK', 'PL'], ['KRAKOW', 'PL'], ['КРАКОВ', 'PL'],
  ['GB', 'GB'], ['UK', 'GB'], ['АНГЛ', 'GB'], ['BRITAIN', 'GB'], ['LONDON', 'GB'], ['ЛОНДОН', 'GB'],
  ['US', 'US'], ['USA', 'US'], ['США', 'US'], ['AMERICA', 'US'], ['NEW YORK', 'US'], ['НЬЮ-ЙОРК', 'US'], ['LOS ANGELES', 'US'], ['MIAMI', 'US'], ['DALLAS', 'US'], ['CHICAGO', 'US'], ['SEATTLE', 'US'], ['ASHBURN', 'US'],
  ['FR', 'FR'], ['ФРАНЦ', 'FR'], ['FRANCE', 'FR'], ['PARIS', 'FR'], ['ПАРИЖ', 'FR'], ['STRASBOURG', 'FR'], ['MARSEILLE', 'FR'],
  ['CZ', 'CZ'], ['ЧЕХ', 'CZ'], ['CZECH', 'CZ'], ['PRAHA', 'CZ'], ['PRAGUE', 'CZ'], ['ПРАГА', 'CZ'],
  ['AT', 'AT'], ['АВСТР', 'AT'], ['AUSTRIA', 'AT'], ['VIENNA', 'AT'], ['ВЕНА', 'AT'],
  ['CH', 'CH'], ['ШВЕЙЦАР', 'CH'], ['SWITZERLAND', 'CH'], ['ZURICH', 'CH'], ['ЦЮРИХ', 'CH'],
  ['ES', 'ES'], ['ИСПАН', 'ES'], ['SPAIN', 'ES'], ['MADRID', 'ES'], ['BARCELONA', 'ES'], ['БАРСЕЛОНА', 'ES'],
  ['PT', 'PT'], ['ПОРТУГАЛ', 'PT'], ['PORTUGAL', 'PT'], ['LISBON', 'PT'], ['PORTO', 'PT'],
  ['IT', 'IT'], ['ИТАЛ', 'IT'], ['ITALY', 'IT'], ['MILAN', 'IT'], ['МИЛАН', 'IT'], ['ROME', 'IT'], ['РИМ', 'IT'],
  ['RO', 'RO'], ['РУМЫН', 'RO'], ['ROMANIA', 'RO'], ['BUCHAREST', 'RO'], ['БУХАРЕСТ', 'RO'],
  ['BG', 'BG'], ['БОЛГАР', 'BG'], ['BULGARIA', 'BG'], ['SOFIA', 'BG'], ['СОФИЯ', 'BG'],
  ['HU', 'HU'], ['ВЕНГР', 'HU'], ['HUNGARY', 'HU'], ['BUDAPEST', 'HU'], ['БУДАПЕШТ', 'HU'],
  ['LV', 'LV'], ['ЛАТВ', 'LV'], ['LATVIA', 'LV'], ['RIGA', 'LV'], ['РИГА', 'LV'],
  ['LT', 'LT'], ['ЛИТВ', 'LT'], ['LITHUANIA', 'LT'], ['VILNIUS', 'LT'], ['ВИЛЬНЮС', 'LT'],
  ['EE', 'EE'], ['ЭСТОН', 'EE'], ['ESTONIA', 'EE'], ['TALLINN', 'EE'], ['ТАЛЛИН', 'EE'],
  ['TR', 'TR'], ['ТУРЦ', 'TR'], ['TURKEY', 'TR'], ['TURKIYE', 'TR'], ['ISTANBUL', 'TR'], ['СТАМБУЛ', 'TR'],
  ['KZ', 'KZ'], ['КАЗАХСТАН', 'KZ'], ['KAZAKHSTAN', 'KZ'], ['ALMATY', 'KZ'], ['АЛМАТЫ', 'KZ'], ['ASTANA', 'KZ'], ['АСТАНА', 'KZ'],
  ['UA', 'UA'], ['УКРАИН', 'UA'], ['UKRAINE', 'UA'], ['KIEV', 'UA'], ['КИЕВ', 'UA'], ['KYIV', 'UA'],
  ['AM', 'AM'], ['АРМЕН', 'AM'], ['ARMENIA', 'AM'], ['YEREVAN', 'AM'], ['ЕРЕВАН', 'AM'],
  ['GE', 'GE'], ['ГРУЗ', 'GE'], ['GEORGIA', 'GE'], ['TBILISI', 'GE'], ['ТБИЛИСИ', 'GE'],
  ['MD', 'MD'], ['МОЛДАВ', 'MD'], ['MOLDOVA', 'MD'], ['CHISINAU', 'MD'], ['КИШИНЁВ', 'MD'], ['КИШИНЕВ', 'MD'],
  ['AZ', 'AZ'], ['АЗЕРБАЙДЖАН', 'AZ'], ['BAKU', 'AZ'], ['БАКУ', 'AZ'],
  ['RS', 'RS'], ['СЕРБ', 'RS'], ['SERBIA', 'RS'], ['BELGRADE', 'RS'], ['БЕЛГРАД', 'RS'],
  ['HK', 'HK'], ['ГОНКОНГ', 'HK'], ['HONG KONG', 'HK'], ['HONGKONG', 'HK'],
  ['JP', 'JP'], ['ЯПОНИ', 'JP'], ['JAPAN', 'JP'], ['TOKYO', 'JP'], ['ТОКИО', 'JP'], ['OSAKA', 'JP'],
  ['SG', 'SG'], ['СИНГАПУР', 'SG'], ['SINGAPORE', 'SG'],
  ['KR', 'KR'], ['КОРЕ', 'KR'], ['KOREA', 'KR'], ['SEOUL', 'KR'], ['СЕУЛ', 'KR'],
  ['IN', 'IN'], ['ИНДИ', 'IN'], ['INDIA', 'IN'], ['MUMBAI', 'IN'], ['DELHI', 'IN'],
  ['AE', 'AE'], ['ОАЭ', 'AE'], ['DUBAI', 'AE'], ['ДУБАЙ', 'AE'], ['EMIRATES', 'AE'],
  ['CA', 'CA'], ['КАНАД', 'CA'], ['CANADA', 'CA'], ['TORONTO', 'CA'], ['MONTREAL', 'CA'], ['VANCOUVER', 'CA'],
  ['BR', 'BR'], ['БРАЗИЛ', 'BR'], ['BRAZIL', 'BR'], ['SAO PAULO', 'BR'],
  ['MX', 'MX'], ['МЕКСИК', 'MX'], ['MEXICO', 'MX'],
  ['AU', 'AU'], ['АВСТРАЛ', 'AU'], ['AUSTRALIA', 'AU'], ['SYDNEY', 'AU'], ['СИДНЕЙ', 'AU'],
  ['NZ', 'NZ'], ['НОВАЯ ЗЕЛАНДИ', 'NZ'],
  ['ZA', 'ZA'], ['ЮАР', 'ZA'], ['AFRICA', 'ZA'],
  ['IL', 'IL'], ['ИЗРАИЛ', 'IL'], ['ISRAEL', 'IL'], ['TEL AVIV', 'IL'],
  ['IR', 'IR'], ['ИРАН', 'IR'], ['IRAN', 'IR'], ['TEHRAN', 'IR'],
  ['CN', 'CN'], ['КИТА', 'CN'], ['CHINA', 'CN'], ['SHANGHAI', 'CN'], ['BEIJING', 'CN'],
  ['VN', 'VN'], ['ВЬЕТНАМ', 'VN'], ['VIETNAM', 'VN'], ['HANOI', 'VN'],
  ['TH', 'TH'], ['ТАИЛАНД', 'TH'], ['THAILAND', 'TH'], ['BANGKOK', 'TH'], ['БАНГКОК', 'TH'],
  ['ID', 'ID'], ['ИНДОНЕЗИ', 'ID'], ['JAKARTA', 'ID'],
  ['MY', 'MY'], ['МАЛАЙЗИ', 'MY'], ['MALAYSIA', 'MY'], ['KUALA LUMPUR', 'MY'],
  ['PH', 'PH'], ['ФИЛИППИН', 'PH'],
  ['AR', 'AR'], ['АРГЕНТИН', 'AR'], ['ARGENTINA', 'AR'],
  ['CL', 'CL'], ['ЧИЛ', 'CL'], ['CHILE', 'CL'], ['SANTIAGO', 'CL'],
  ['CO', 'CO'], ['КОЛУМБ', 'CO'],
  ['PE', 'PE'], ['ПЕРУ', 'PE'],
  ['EG', 'EG'], ['ЕГИПЕТ', 'EG'], ['EGYPT', 'EG'],
  ['SA', 'SA'], ['SAUDI', 'SA'],
  ['QA', 'QA'], ['КАТАР', 'QA'], ['QATAR', 'QA'],
  ['KW', 'KW'], ['КУВЕЙТ', 'KW'], ['KUWAIT', 'KW'],
  ['UZ', 'UZ'], ['УЗБЕКИСТАН', 'UZ'], ['TASHKENT', 'UZ'], ['ТАШКЕНТ', 'UZ'],
  ['KG', 'KG'], ['КИРГИЗ', 'KG'], ['KYRGYZSTAN', 'KG'], ['BISHKEK', 'KG'],
  ['BY', 'BY'], ['БЕЛАРУС', 'BY'], ['BELARUS', 'BY'], ['MINSK', 'BY'], ['МИНСК', 'BY'],
  ['RU', 'RU'], ['РОССИ', 'RU'], ['RUSSIA', 'RU'], ['MOSCOW', 'RU'], ['МОСКВ', 'RU'], ['PETERSBURG', 'RU'], ['ПИТЕР', 'RU'], ['СПБ', 'RU'], ['НОВОСИБИРСК', 'RU'], ['ЕКАТЕРИНБУРГ', 'RU'], ['KAZAN', 'RU'], ['КАЗАН', 'RU']
]

/**
 * Страна по эвристикам: 1) эмодзи-флаг в имени; 2) токен страны/города.
 * TLD адреса сознательно не используется. «VPN» = не определена.
 */
export function detectCountry(name: string): string {
  const flags = name.match(FLAG_EMOJI_RE)
  if (flags && flags.length > 0) {
    const code = emojiToCountry(flags[0])
    if (/^[A-Z]{2}$/.test(code)) return code
  }
  const upper = name.toUpperCase()
  for (const [needle, code] of COUNTRY_TOKENS) {
    // отдельные токены из 2 букв ищем как слово, чтобы не ловить
    // «DE» внутри «NODE» и т.п.
    if (needle.length === 2) {
      if (new RegExp(`(^|[^A-Z0-9])${needle}([^A-Z0-9]|$)`).test(upper)) return code
    } else if (upper.includes(needle)) {
      return code
    }
  }
  return 'VPN'
}

function makeProfile(partial: {
  name: string
  protocol: Protocol
  address: string
  port: number
  uuid: string
  method?: string
  flow?: string
  stream: StreamSettings
  sb?: SingboxServerFields
  subscriptionId?: string | null
}): ServerProfile {
  const name = partial.name || `${partial.address}:${partial.port}`
  return {
    id: randomUUID(),
    name,
    protocol: partial.protocol,
    address: partial.address,
    port: partial.port,
    country: detectCountry(name),
    uuid: partial.uuid,
    method: partial.method,
    flow: partial.flow,
    stream: partial.stream,
    sb: partial.sb,
    latencyMs: null,
    latencyError: null,
    load: 0,
    subscriptionId: partial.subscriptionId ?? null,
    subscriptionName: null,
    createdAt: new Date().toISOString()
  }
}

/** Строим streamSettings из query-параметров ссылки */
function streamFromParams(q: URLSearchParams): StreamSettings {
  const network = (q.get('type') || q.get('network') || 'tcp').toLowerCase()
  const security = (q.get('security') || 'none').toLowerCase()
  const sni = q.get('sni') || q.get('peer') || q.get('host') || ''
  const fp = q.get('fp') || 'chrome'
  const alpn = q.get('alpn') ? q.get('alpn')!.split(',').filter(Boolean) : undefined

  const stream: StreamSettings = {
    network: (['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'splithttp'].includes(network)
      ? network === 'splithttp'
        ? 'xhttp'
        : network
      : 'tcp') as StreamSettings['network'],
    security: (['none', 'tls', 'reality'].includes(security)
      ? security
      : 'none') as StreamSettings['security']
  }

  if (stream.security === 'tls') {
    stream.tls = {
      serverName: sni,
      alpn,
      fingerprint: fp,
      // Xray 26.x не имеет allowInsecure: для self-signed включается
      // TOFU-пин сертификата (cert-pin.ts); pinSHA256 из ссылки — если есть
      insecure: boolParam(q, 'insecure', 'allowInsecure', 'allow_insecure'),
      pinnedPeerCertSha256: q.get('pinSHA256') || q.get('pcs') || undefined
    }
  } else if (stream.security === 'reality') {
    stream.reality = {
      serverName: sni || 'www.microsoft.com',
      fingerprint: fp,
      publicKey: q.get('pbk') || '',
      shortId: q.get('sid') || '',
      spiderX: q.get('spx') || '/'
    }
  }

  if (stream.network === 'ws') {
    stream.ws = { path: q.get('path') || '/', host: q.get('host') || sni || '' }
  } else if (stream.network === 'grpc') {
    stream.grpc = { serviceName: q.get('serviceName') || '', authority: q.get('authority') || '' }
  } else if (stream.network === 'httpupgrade') {
    stream.httpupgrade = { path: q.get('path') || '/', host: q.get('host') || sni || '' }
  } else if (stream.network === 'xhttp') {
    stream.xhttp = {
      path: q.get('path') || '/',
      host: q.get('host') || sni || '',
      mode: q.get('extra') ? parseModeExtra(q.get('extra')!) : q.get('mode') || undefined
    }
  }

  return stream
}

/** extra из ссылок вида {"mode":"stream"} или mode=stream */
function parseModeExtra(extra: string): string | undefined {
  try {
    const parsed = JSON.parse(extra) as { mode?: string }
    return parsed.mode
  } catch {
    return undefined
  }
}

function boolParam(q: URLSearchParams, ...names: string[]): boolean {
  for (const n of names) {
    const v = q.get(n)
    if (v === '1' || v === 'true' || v === 'yes') return true
  }
  return false
}

function intParam(q: URLSearchParams, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = parseInt(q.get(n) ?? '', 10)
    if (Number.isFinite(v) && v > 0) return v
  }
  return undefined
}

export type ParsedShareLink =
  | { ok: true; profile: ServerProfile }
  | { ok: false; error: string }

// ------------------------------------------------------------
// sing-box протоколы
// ------------------------------------------------------------

function parseHysteria2(raw: string, scheme: 'hy2' | 'hysteria2'): ParsedShareLink {
  const u = new URL(raw)
  const password = decodeURIComponent(u.username) || ''
  const address = u.hostname
  const port = parseInt(u.port || '443', 10)
  if (!address || !port) return { ok: false, error: 'invalid hysteria2 uri' }
  const q = u.searchParams
  const sb: SingboxServerFields = {
    password,
    sni: q.get('sni') || q.get('peer') || undefined,
    insecure: boolParam(q, 'insecure', 'allow_insecure', 'allowInsecure'),
    alpn: q.get('alpn') ? q.get('alpn')!.split(',').filter(Boolean) : undefined,
    obfsType: q.get('obfs') === 'salamander' || q.get('obfs') === 'gecko' ? (q.get('obfs') as 'salamander' | 'gecko') : undefined,
    obfsPassword: q.get('obfs-password') || q.get('obfs-param') || undefined,
    serverPorts: normalizePortRange(q.get('mport') || q.get('ports')),
    hopInterval: q.get('hop_interval') ? `${q.get('hop_interval')}s` : undefined,
    pinSHA256: q.get('pinSHA256') || q.get('pcs') || undefined,
    upMbps: intParam(q, 'upmbps'),
    downMbps: intParam(q, 'downmbps')
  }
  const name = decodeURIComponent(u.hash.slice(1)) || ''
  return {
    ok: true,
    profile: makeProfile({
      name,
      protocol: 'Hysteria2',
      address,
      port,
      uuid: password,
      stream: defaultStream(),
      sb
    })
  }
  void scheme
}

/** «1000-2000»/«1000:2000» → sing-box формат «1000:2000» */
function normalizePortRange(value: string | null): string | undefined {
  if (!value) return undefined
  const m = value.match(/^(\d+)[-:](\d+)$/)
  if (!m) return undefined
  return `${m[1]}:${m[2]}`
}

function parseHysteria1(raw: string): ParsedShareLink {
  const u = new URL(raw)
  const address = u.hostname
  const port = parseInt(u.port || '443', 10)
  if (!address || !port) return { ok: false, error: 'invalid hysteria uri' }
  const q = u.searchParams
  const auth = q.get('auth') || decodeURIComponent(u.username) || ''
  const sb: SingboxServerFields = {
    password: auth,
    sni: q.get('peer') || q.get('sni') || undefined,
    insecure: boolParam(q, 'insecure', 'allow_insecure', 'allowInsecure'),
    alpn: q.get('alpn') ? q.get('alpn')!.split(',').filter(Boolean) : undefined,
    obfsType: q.get('obfs') === 'salamander' ? 'salamander' : undefined,
    obfsPassword: q.get('obfs-param') || undefined,
    upMbps: intParam(q, 'upmbps', 'up'),
    downMbps: intParam(q, 'downmbps', 'down')
  }
  const name = decodeURIComponent(u.hash.slice(1)) || ''
  return {
    ok: true,
    profile: makeProfile({ name, protocol: 'Hysteria', address, port, uuid: auth, stream: defaultStream(), sb })
  }
}

function parseTuic(raw: string): ParsedShareLink {
  const u = new URL(raw)
  const uuid = decodeURIComponent(u.username) || ''
  const tuicPassword = decodeURIComponent(u.password) || ''
  const address = u.hostname
  const port = parseInt(u.port || '443', 10)
  if (!uuid || !address || !port) return { ok: false, error: 'invalid tuic uri' }
  const q = u.searchParams
  const sb: SingboxServerFields = {
    tuicPassword,
    sni: q.get('sni') || undefined,
    insecure: boolParam(q, 'insecure', 'allow_insecure', 'allowInsecure'),
    alpn: q.get('alpn') ? q.get('alpn')!.split(',').filter(Boolean) : ['h3'],
    congestionControl: q.get('congestion_control') || 'bbr',
    udpRelayMode: q.get('udp_relay_mode') || 'native'
  }
  const name = decodeURIComponent(u.hash.slice(1)) || ''
  return {
    ok: true,
    profile: makeProfile({ name, protocol: 'TUIC', address, port, uuid, stream: defaultStream(), sb })
  }
}

/** wireguard://<privKey>@host:port?publickey=&address=&mtu=&dns=&presharedkey=&keepalive=#name */
function parseWireguard(raw: string): ParsedShareLink {
  const u = new URL(raw)
  const privateKey = decodeURIComponent(u.username) || ''
  const address = u.hostname
  const port = parseInt(u.port || '51820', 10)
  if (!privateKey || !address || !port) return { ok: false, error: 'invalid wireguard uri' }
  const q = u.searchParams
  const sb: SingboxServerFields = {
    wgPrivateKey: privateKey,
    wgPeerPublicKey: q.get('publickey') || q.get('peer_public_key') || undefined,
    wgPreSharedKey: q.get('presharedkey') || q.get('pre_shared_key') || undefined,
    wgAddresses: q.get('address')
      ? q.get('address')!.split(',').map((a) => a.trim()).filter(Boolean)
      : undefined,
    wgMtu: intParam(q, 'mtu'),
    wgDns: q.get('dns') ? q.get('dns')!.split(',').map((d) => d.trim()).filter(Boolean) : undefined,
    wgKeepalive: intParam(q, 'keepalive', 'persistent_keepalive')
  }
  const name = decodeURIComponent(u.hash.slice(1)) || ''
  return {
    ok: true,
    profile: makeProfile({ name, protocol: 'WireGuard', address, port, uuid: privateKey, stream: defaultStream(), sb })
  }
}

/** vpn://<base64url ini-конфига AmneziaWG> — формат AmneziaVPN/3x-ui */
function parseAmneziaVpn(raw: string): ParsedShareLink {
  const body = raw.slice('vpn://'.length).split('?')[0].split('#')[0]
  let text: string
  try {
    text = b64decode(body)
  } catch {
    return { ok: false, error: 'invalid vpn:// base64' }
  }
  if (!text.includes('[Interface]') || !text.includes('[Peer]')) {
    return { ok: false, error: 'invalid amnezia config' }
  }

  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m) fields.set(m[1].toLowerCase(), m[2])
  }

  const endpoint = fields.get('endpoint') ?? ''
  const lastColon = endpoint.lastIndexOf(':')
  const address = lastColon === -1 ? endpoint : endpoint.slice(0, lastColon).replace(/^\[|\]$/g, '')
  const port = lastColon === -1 ? 51820 : parseInt(endpoint.slice(lastColon + 1), 10)
  const privateKey = fields.get('privatekey') ?? ''
  if (!address || !privateKey) return { ok: false, error: 'invalid amnezia endpoint/privatekey' }

  const allowed = (fields.get('address') ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)

  /** Заголовок H — диапазон («88» или «88-157»): сырой строкой */
  const h = (n: number): string | undefined => fields.get(`h${n}`) || undefined
  /** Тайминг/паддинг — тоже диапазон, сырой строкой */
  const range = (...names: string[]): string | undefined => {
    for (const name of names) {
      const v = fields.get(name)
      if (v) return v
    }
    return undefined
  }

  // DNS из конфига wg-quick (DNS = 1.1.1.1) — подставляется в
  // DNS-модуль sing-box при живом WG (как wg-quick/Amnezia)
  const dnsList = (fields.get('dns') ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)

  const sb: SingboxServerFields = {
    wgPrivateKey: privateKey,
    wgPeerPublicKey: fields.get('publickey') || undefined,
    wgPreSharedKey: fields.get('presharedkey') || undefined,
    wgAddresses: allowed.length > 0 ? allowed : undefined,
    wgMtu: parseInt(fields.get('mtu') ?? '', 10) || undefined,
    wgKeepalive: parseInt(fields.get('persistentkeepalive') ?? '', 10) || undefined,
    wgDns: dnsList.length > 0 ? dnsList : undefined,
    amnezia: {
      jc: parseInt(fields.get('jc') ?? '', 10) || undefined,
      jmin: parseInt(fields.get('jmin') ?? '', 10) || undefined,
      jmax: parseInt(fields.get('jmax') ?? '', 10) || undefined,
      s1: parseInt(fields.get('s1') ?? '', 10) || undefined,
      s2: parseInt(fields.get('s2') ?? '', 10) || undefined,
      s3: parseInt(fields.get('s3') ?? '', 10) || undefined,
      s4: parseInt(fields.get('s4') ?? '', 10) || undefined,
      // AWG 1.0: заголовки — диапазоны, проходят в UAPI как есть
      h1: h(1),
      h2: h(2),
      h3: h(3),
      h4: h(4),
      // AWG 2.0: цепочки обфускации спец-хендшейков — СТРОКАМИ
      // (например «<b 0xc70000000108…>»)
      i1: fields.get('i1') || undefined,
      i2: fields.get('i2') || undefined,
      i3: fields.get('i3') || undefined,
      i4: fields.get('i4') || undefined,
      i5: fields.get('i5') || undefined,
      // AWG 2.1+ / sing-box-extended: защита заголовков и тайминги.
      // Заданы на сервере → клиент ОБЯЗАН передать (база64 HPK).
      headerProtectionKey:
        fields.get('header_protection_key') || fields.get('headerprotectionkey') || undefined,
      contentPaddingAddition: range('content_padding_addition', 'contentpaddingaddition'),
      rekeyAfterTime: range('rekey_after_time', 'rekeyaftertime'),
      rekeyTimeout: range('rekey_timeout', 'rekeytimeout'),
      rejectAfterTime: range('reject_after_time', 'rejectaftertime'),
      keepaliveTimeout: range('keepalive_timeout', 'keepalivetimeout'),
      maxHandshakeAttempts: range('max_handshake_attempts', 'maxhandshakeattempts'),
      randomTrailers:
        (fields.get('random_trailers') ?? fields.get('randomtrailers') ?? '').toLowerCase() ===
        'true',
      disableCookies:
        (fields.get('disable_cookies') ?? fields.get('disablecookies') ?? '').toLowerCase() ===
        'true'
    }
  }

  // имя: комментарий перед [Peer] либо remark
  const remark = text.match(/^#\s*(.+)$/m)?.[1]?.trim() ?? ''
  const name = remark || `AmneziaWG ${address}`

  return {
    ok: true,
    profile: makeProfile({ name, protocol: 'AmneziaWG', address, port, uuid: privateKey, stream: defaultStream(), sb })
  }
}

// ------------------------------------------------------------
// Главный парсер
// ------------------------------------------------------------

export function parseShareLink(uri: string): ParsedShareLink {
  const raw = uri.trim()
  if (!raw) return { ok: false, error: 'empty' }

  try {
    if (raw.startsWith('vless://')) {
      const u = new URL(raw)
      const uuid = decodeURIComponent(u.username)
      const address = u.hostname
      const port = parseInt(u.port || '443', 10)
      if (!uuid || !address || !port) return { ok: false, error: 'invalid vless uri' }
      const q = u.searchParams
      const flow = q.get('flow') || undefined
      const stream = streamFromParams(q)
      const name = decodeURIComponent(u.hash.slice(1)) || ''
      return { ok: true, profile: makeProfile({ name, protocol: 'VLESS', address, port, uuid, flow, stream }) }
    }

    if (raw.startsWith('vmess://')) {
      let json: Record<string, unknown>
      try {
        json = JSON.parse(b64decode(raw.slice('vmess://'.length)))
      } catch {
        return { ok: false, error: 'invalid vmess base64' }
      }
      const address = String(json.add ?? '')
      const port = parseInt(String(json.port ?? '0'), 10)
      const uuid = String(json.id ?? '')
      if (!address || !port || !uuid) return { ok: false, error: 'invalid vmess payload' }
      const network = String(json.net ?? 'tcp').toLowerCase()
      const security = String(json.tls ?? '').toLowerCase() === 'tls' ? 'tls' : 'none'
      const sni = String(json.sni ?? '') || String(json.host ?? '')
      const stream: StreamSettings = {
        network: (['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp', 'splithttp'].includes(network)
          ? network === 'splithttp'
            ? 'xhttp'
            : network
          : 'tcp') as StreamSettings['network'],
        security: security as StreamSettings['security']
      }
      if (stream.security === 'tls') {
        stream.tls = { serverName: sni, fingerprint: String(json.fp ?? '') || 'chrome' }
      }
      if (stream.network === 'ws') {
        stream.ws = { path: String(json.path ?? '/'), host: String(json.host ?? '') }
      } else if (stream.network === 'grpc') {
        stream.grpc = { serviceName: String(json.path ?? '').replace(/^\//, '') }
      } else if (stream.network === 'httpupgrade') {
        stream.httpupgrade = { path: String(json.path ?? '/'), host: String(json.host ?? '') }
      } else if (stream.network === 'xhttp') {
        stream.xhttp = { path: String(json.path ?? '/'), host: String(json.host ?? '') }
      }
      const name = String(json.ps ?? '')
      return { ok: true, profile: makeProfile({ name, protocol: 'VMess', address, port, uuid, stream }) }
    }

    if (raw.startsWith('trojan://')) {
      const u = new URL(raw)
      const password = decodeURIComponent(u.username)
      const address = u.hostname
      const port = parseInt(u.port || '443', 10)
      if (!password || !address || !port) return { ok: false, error: 'invalid trojan uri' }
      const q = u.searchParams
      const stream = streamFromParams(q)
      if (stream.security === 'none') {
        stream.security = 'tls'
        stream.tls = { serverName: q.get('sni') || address, fingerprint: 'chrome' }
      }
      const name = decodeURIComponent(u.hash.slice(1)) || ''
      return { ok: true, profile: makeProfile({ name, protocol: 'Trojan', address, port, uuid: password, stream }) }
    }

    if (raw.startsWith('ss://')) {
      const body = raw.slice('ss://'.length)
      const hashPart = body.includes('#') ? body.slice(body.indexOf('#') + 1) : ''
      const name = decodeURIComponent(hashPart)
      let main = body
      if (body.includes('#')) main = body.slice(0, body.indexOf('#'))

      // SIP002: ss://base64(method:password)@host:port
      const atIdx = main.lastIndexOf('@')
      if (atIdx !== -1) {
        const userInfo = main.slice(0, atIdx)
        const hostPart = main.slice(atIdx + 1)
        let method = ''
        let password = ''
        try {
          const decoded = b64decode(userInfo)
          const colon = decoded.indexOf(':')
          method = decoded.slice(0, colon)
          password = decoded.slice(colon + 1)
        } catch {
          const colon = userInfo.indexOf(':')
          method = userInfo.slice(0, colon)
          password = userInfo.slice(colon + 1)
        }
        const hostMatch = hostPart.match(/^\[([^\]]+)\]|^(.+)$/m)
        const host = hostMatch ? (hostMatch[1] ?? hostMatch[2]) : ''
        const port = parseInt(hostPart.split(':').pop() ?? '0', 10)
        if (method && password && host && port) {
          return {
            ok: true,
            profile: makeProfile({
              name,
              protocol: 'Shadowsocks',
              address: host,
              port,
              uuid: password,
              method,
              stream: defaultStream()
            })
          }
        }
      }

      // Легаси: ss://base64(method:password@host:port)
      try {
        const decoded = b64decode(main)
        const atIdx2 = decoded.lastIndexOf('@')
        const userInfo = decoded.slice(0, atIdx2)
        const hostPart = decoded.slice(atIdx2 + 1)
        const colon = userInfo.indexOf(':')
        const method = userInfo.slice(0, colon)
        const password = userInfo.slice(colon + 1)
        const lastColon = hostPart.lastIndexOf(':')
        const host = hostPart.slice(0, lastColon).replace(/^\[|\]$/g, '')
        const port = parseInt(hostPart.slice(lastColon + 1), 10)
        if (method && password && host && port) {
          return {
            ok: true,
            profile: makeProfile({
              name,
              protocol: 'Shadowsocks',
              address: host,
              port,
              uuid: password,
              method,
              stream: defaultStream()
            })
          }
        }
      } catch {
        /* fallthrough */
      }
      return { ok: false, error: 'invalid ss uri' }
    }

    // ---------- sing-box протоколы ----------

    if (raw.startsWith('hy2://') || raw.startsWith('hysteria2://')) {
      return parseHysteria2(raw, raw.startsWith('hy2://') ? 'hy2' : 'hysteria2')
    }
    if (raw.startsWith('hysteria://')) {
      return parseHysteria1(raw)
    }
    if (raw.startsWith('tuic://')) {
      return parseTuic(raw)
    }
    if (raw.startsWith('wireguard://') || raw.startsWith('wg://')) {
      return parseWireguard(raw)
    }
    if (raw.startsWith('vpn://')) {
      return parseAmneziaVpn(raw)
    }

    return { ok: false, error: 'unsupported scheme' }
  } catch {
    return { ok: false, error: 'parse error' }
  }
}

/**
 * Разбор тела подписки: plain-text список ссылок или base64 от него.
 * Возвращает профили и список ошибок (в т.ч. какие схемы пропущены).
 */
export function parseSubscriptionBody(
  body: string,
  subscriptionId: string
): { profiles: ServerProfile[]; errors: string[]; skippedSchemes: string[] } {
  let text = body.trim()
  // Пробуем base64
  if (!/^[a-z]+:\/\//i.test(text)) {
    try {
      text = b64decode(text)
    } catch {
      /* это plain text */
    }
  }
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const profiles: ServerProfile[] = []
  const errors: string[] = []
  const skipped = new Map<string, number>()
  for (const line of lines) {
    const res = parseShareLink(line)
    if (res.ok) {
      res.profile.subscriptionId = subscriptionId
      profiles.push(res.profile)
    } else {
      errors.push(res.error)
      const scheme = line.split('://')[0]
      if (scheme && scheme.length < 20) {
        skipped.set(scheme, (skipped.get(scheme) ?? 0) + 1)
      }
    }
  }
  return { profiles, errors, skippedSchemes: [...skipped.keys()] }
}
