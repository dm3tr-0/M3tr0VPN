// ============================================================
// e2e-тест интеграции sing-box (bun).
// 1) Матрица конфигов: hy2/hy1/tuic/wg(+amnezia)/tun-chain/
//    tun-direct/proxy → `sing-box check`.
// 2) Парсер ссылок: hy2:// hysteria:// tuic:// wireguard:// vpn://
//    (3x-ui форматы) → поля профиля.
// 3) Живой тест: локальный hysteria2-СЕРВЕР (self-signed TLS) +
//    клиент sing-box → HTTP-запрос через туннель → 200.
// Запуск: bun scripts/test-singbox.ts
// ============================================================

import { buildSingboxConfig, buildSingboxLatencyConfig, buildSingboxSpeedtestConfig, type SingboxRole } from '../src/main/singbox/config'
import { parseShareLink, detectCountry } from '../src/main/uri'
import { decodeProfileTitle } from '../src/main/subscriptions'
import type { AppRule, AppSettings, ServerProfile, StreamSettings } from '../src/shared/types'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const SB = path.join(ROOT, 'core', 'linux', 'sing-box')
const TMP = path.join(ROOT, '.tmp-sb')
fs.mkdirSync(TMP, { recursive: true })

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

const settings: AppSettings = {
  language: 'ru',
  autoConnect: false,
  launchAtStartup: false,
  ipv6: false,
  mux: true,
  dns: 'auto',
  selectedServerId: 'test',
  selectedDomains: [],
  transportMode: 'proxy',
  autoUpdateSubs: true
}

const apps: AppRule[] = [
  { id: '1', appId: 'qbittorrent.exe', appName: 'qBittorrent', icon: 'download', enabled: true }
]

function mkServer(protocol: ServerProfile['protocol'], sb: ServerProfile['sb']): ServerProfile {
  return {
    id: 'test',
    name: `Test ${protocol}`,
    protocol,
    address: 'vpn.example.com',
    port: 443,
    country: 'NL',
    uuid: 'd342d11e-d424-4583-b36e-524ab1f0afa4',
    stream: { network: 'tcp', security: 'none' } as StreamSettings,
    sb,
    latencyMs: null,
    latencyError: null,
    load: 0,
    subscriptionId: null,
    createdAt: new Date().toISOString()
  }
}

const CORE_PORTS = { socks: 10808, http: 10809, api: 15490, clash: 19090 }

// ------------------------------------------------------------
console.log('\n[1] Матрица конфигов → sing-box check')
// ------------------------------------------------------------

const matrix: Array<{ name: string; role: SingboxRole; server: ServerProfile }> = [
  {
    name: 'hysteria2 (proxy)',
    role: 'proxy',
    server: mkServer('Hysteria2', {
      password: 'secret',
      sni: 'sni.example.com',
      insecure: true,
      alpn: ['h3'],
      obfsType: 'salamander',
      obfsPassword: 'obfspw',
      serverPorts: '1000:2000'
    })
  },
  {
    name: 'hysteria2 (tun-direct)',
    role: 'tun-direct',
    server: mkServer('Hysteria2', { password: 'secret', insecure: true, alpn: ['h3'] })
  },
  {
    name: 'hysteria1 (proxy)',
    role: 'proxy',
    server: mkServer('Hysteria', {
      password: 'authstr',
      upMbps: 100,
      downMbps: 100,
      insecure: false,
      alpn: ['h3']
    })
  },
  {
    name: 'tuic (proxy)',
    role: 'proxy',
    server: mkServer('TUIC', {
      tuicPassword: 'tuicpass',
      congestionControl: 'bbr',
      udpRelayMode: 'native',
      alpn: ['h3']
    })
  },
  {
    name: 'wireguard (tun-direct)',
    role: 'tun-direct',
    server: mkServer('WireGuard', {
      wgPrivateKey: 'eCtXs6ZuBuCcWBpXKrxSlh2ieVucAegIemOE3bQPk20=',
      wgPeerPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      wgAddresses: ['10.0.0.2/32'],
      wgMtu: 1420
    })
  },
  {
    name: 'amneziawg (tun-direct)',
    role: 'tun-direct',
    server: mkServer('AmneziaWG', {
      wgPrivateKey: 'eCtXs6ZuBuCcWBpXKrxSlh2ieVucAegIemOE3bQPk20=',
      wgPeerPublicKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      wgAddresses: ['10.0.0.2/32'],
      // H-поля — ДИАПАЗОНЫ (badoption.Range: «88» или «88-157»)
      amnezia: { jc: 4, jmin: 40, jmax: 70, s1: 105, s2: 141, s3: 111, s4: 93, h1: '88-157', h2: '66-188', h3: '31-213', h4: '47-204', i1: '<b 0x71165b2b0d1e>' }
    })
  },
  {
    name: 'vless-override (tun-direct)',
    role: 'tun-direct',
    server: mkServer('VLESS', undefined)
  }
]

for (const entry of matrix) {
  const config = buildSingboxConfig({
    server: entry.server,
    settings,
    appRules: apps,
    mode: entry.role === 'proxy' ? 'proxy' : 'tun',
    role: entry.role,
    ports: CORE_PORTS
  })
  const file = path.join(TMP, `check-${entry.name.replace(/[^\w-]/g, '_')}.json`)
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
  try {
    execSync(`"${SB}" check -c "${file}"`, { stdio: 'pipe' })
    check(entry.name, true)
  } catch (err) {
    check(entry.name, false, String((err as { stderr?: Buffer }).stderr ?? '').trim().slice(0, 200))
  }
}

// «Выбранное»: домены → proxy, остальное → direct
{
  const config = buildSingboxConfig({
    server: matrix[0].server,
    settings: { ...settings, selectedDomains: ['youtube.com', 'google.com'] },
    appRules: apps,
    mode: 'tun',
    role: 'tun-direct',
    ports: CORE_PORTS
  })
  const file = path.join(TMP, 'check-selected.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
  try {
    execSync(`"${SB}" check -c "${file}"`, { stdio: 'pipe' })
    const text = fs.readFileSync(file, 'utf-8')
    const finalIsDirect = /"final"\s*:\s*"direct"/.test(text)
    const hasDomainRule = text.includes('"domain_suffix"')
    check('selected-domains: final=direct + domain_suffix', finalIsDirect && hasDomainRule)
  } catch (err) {
    check('selected-domains', false, String((err as { stderr?: Buffer }).stderr ?? '').slice(0, 200))
  }
}

// DNS в TUN обязан быть DoH: UDP-DNS через цепочку socks→xray(xhttp)
// не работает («dns: exchange failed», лог 2026-09-18)
{
  const config = buildSingboxConfig({
    server: matrix[1].server,
    settings,
    appRules: apps,
    mode: 'tun',
    role: 'tun-direct',
    ports: CORE_PORTS
  })
  const dns = (config.dns as { servers: Array<{ type: string; tag: string }> }).servers
  const remote = dns.find((s) => s.tag === 'remote')
  check('dns: remote сервер = DoH (type https)', remote?.type === 'https')
  const tunDirect = buildSingboxConfig({
    server: matrix[6].server,
    settings,
    appRules: apps,
    mode: 'tun',
    role: 'tun-direct',
    ports: CORE_PORTS
  })
  const dns2 = (tunDirect.dns as { servers: Array<{ type: string; tag: string }> }).servers
  check('dns: tun-direct тоже DoH', dns2.find((s) => s.tag === 'remote')?.type === 'https')
  const tunIn = (tunDirect.inbounds as Array<Record<string, unknown>>).find((i) => i.type === 'tun')
  check('tun-direct: strict_route выключен (как v2rayN)', tunIn?.strict_route === false)
}

// Пиннинг IP endpoint'а WireGuard/AWG — анти-цикл DNS в TUN (лог 19.09)
{
  const config = buildSingboxConfig({
    server: matrix[5].server, // AmneziaWG
    settings,
    appRules: apps,
    mode: 'tun',
    role: 'tun-direct',
    ports: CORE_PORTS,
    excludeIps: ['144.31.112.3'],
    serverIp: '144.31.112.3'
  })
  const ep = (config.endpoints as Array<Record<string, unknown>>)[0]
  const peers = (ep?.peers as Array<Record<string, unknown>>)[0]
  check('awg: адрес endpoint пришпилен IP', peers?.address === '144.31.112.3')
  check('awg: detour direct на месте (фикс Windows bind)', ep?.detour === 'direct')
  check('awg: amnezia-параметры эмитятся', Boolean(ep?.amnezia))
  check('awg: H-диапазон в конфиге', (ep?.amnezia as Record<string, unknown>)?.h1 === '88-157')
  check('awg: AWG log level debug (диагностика хандшейка)', (config.log as Record<string, unknown>)?.level === 'debug')
  const tunIn = (config.inbounds as Array<Record<string, unknown>>).find((i) => i.type === 'tun')
  check('awg tun: server IP исключён из маршрутов', JSON.stringify(tunIn?.route_exclude_address).includes('144.31.112.3/32'))
}

// Мульти-серверный speedtest-конфиг (v2rayN GenerateClientSpeedtestConfig):
// все протоколы в ОДНОМ ядре, у каждого свой порт и route-правило
{
  const entries = [
    { server: matrix[0].server, port: 18501, serverIp: '203.0.113.1' },
    { server: matrix[2].server, port: 18502, serverIp: '203.0.113.2' },
    { server: matrix[3].server, port: 18503, serverIp: '203.0.113.3' },
    { server: matrix[4].server, port: 18504, serverIp: '203.0.113.4' },
    { server: matrix[5].server, port: 18505, serverIp: '203.0.113.5' }
  ]
  const config = buildSingboxSpeedtestConfig(entries)
  const file = path.join(TMP, 'speedtest-multi.json')
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
  try {
    execSync(`"${SB}" check -c "${file}"`, { stdio: 'pipe' })
    const text = fs.readFileSync(file, 'utf-8')
    const inCount = (text.match(/"type": "mixed"/g) ?? []).length
    const ruleCount = (text.match(/"inbound"/g) ?? []).length
    check('speedtest-multi: конфиг валиден, 5 инбаундов + 5 правил', inCount === 5 && ruleCount === 5)
    check('speedtest-multi: у каждого сервера свой тег', text.includes('"proxy18501"') && text.includes('"proxy18505"'))
    // WG/AWG уходят в endpoints с уникальными тегами
    const eps = JSON.parse(text).endpoints as Array<{ tag: string; peers: Array<{ address: string }> }>
    check('speedtest-multi: WG endpoint тег уникален', eps.some((e) => e.tag === 'proxy18504') && eps.some((e) => e.tag === 'proxy18505'))
  } catch (err) {
    check('speedtest-multi', false, String((err as { stderr?: Buffer }).stderr ?? '').trim().slice(0, 200))
  }
}

// Конфиги замера реального пинга (врем. ядра без TUN/clash-api)
{
  const latencyServers = [
    matrix[0].server, // Hysteria2
    matrix[2].server, // Hysteria
    matrix[3].server, // TUIC
    matrix[4].server, // WireGuard
    matrix[5].server // AmneziaWG
  ]
  for (const server of latencyServers) {
    const config = buildSingboxLatencyConfig(server, 18498)
    const file = path.join(TMP, `latency-${server.protocol}.json`)
    fs.writeFileSync(file, JSON.stringify(config, null, 2))
    try {
      execSync(`"${SB}" check -c "${file}"`, { stdio: 'pipe' })
      check(`latency-конфиг ${server.protocol}`, true)
    } catch (err) {
      check(`latency-конфиг ${server.protocol}`, false, String((err as { stderr?: Buffer }).stderr ?? '').trim().slice(0, 200))
    }
  }
}

// ------------------------------------------------------------
console.log('\n[2] Парсер ссылок (форматы 3x-ui / v2rayN)')
// ------------------------------------------------------------

{
  const res = parseShareLink(
    'hysteria2://secret@203.0.113.1:443?security=tls&sni=cdn.example.com&insecure=1&obfs=salamander&obfs-password=pw&mport=1000-2000#%F0%9F%87%B5%F0%9F%87%B1%20Warsaw%201'
  )
  check('hy2 parse', !!res.ok)
  if (res.ok) {
    const p = res.profile
    check('hy2 fields', p.protocol === 'Hysteria2' && p.address === '203.0.113.1' && p.port === 443)
    check('hy2 sb fields', p.sb?.password === 'secret' && p.sb?.sni === 'cdn.example.com' && p.sb?.insecure === true && p.sb?.obfsPassword === 'pw')
    check('hy2 mport → 1000:2000', p.sb?.serverPorts === '1000:2000')
    check('hy2 flag → PL', p.country === 'PL')
  }
}
{
  const res = parseShareLink('hy2://authpw@vpn.pl:8443?sni=x')
  check('hy2:// alias', !!res.ok && res.profile.protocol === 'Hysteria2')
}
{
  const res = parseShareLink(
    'hysteria://203.0.113.2:443?auth=authstr&peer=peer.example.com&insecure=1&upmbps=100&downmbps=200&alpn=h3&obfs=salamander&obfs-param=obpw#Helsinki'
  )
  check('hysteria1 parse', !!res.ok)
  if (res.ok) {
    const p = res.profile
    check('hy1 fields', p.protocol === 'Hysteria' && p.address === '203.0.113.2' && p.sb?.password === 'authstr')
    check('hy1 up/down', p.sb?.upMbps === 100 && p.sb?.downMbps === 200)
    check('hy1 city → FI', p.country === 'FI')
  }
}
{
  const res = parseShareLink(
    'tuic://61d6712b-2e2c-4ba8-91be-e9d9ba7b1a11:tuicpass@203.0.113.3:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=s.example.com#Tokyo%20TUIC'
  )
  check('tuic parse', !!res.ok)
  if (res.ok) {
    const p = res.profile
    check('tuic fields', p.protocol === 'TUIC' && p.uuid === '61d6712b-2e2c-4ba8-91be-e9d9ba7b1a11' && p.sb?.tuicPassword === 'tuicpass')
    check('tuic city → JP', p.country === 'JP')
  }
}
{
  const res = parseShareLink(
    'wireguard://eCtXs6ZuBuCcWBpXKrxSlh2ieVucAegIemOE3bQPk20%3D@203.0.113.4:51820?publickey=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef&address=10.0.0.2%2F32%2Cfd00%3A%3A2%2F128&mtu=1420&keepalive=25#WG%20Amsterdam'
  )
  check('wireguard parse', !!res.ok)
  if (res.ok) {
    const p = res.profile
    check('wg fields', p.protocol === 'WireGuard' && p.address === '203.0.113.4' && p.port === 51820)
    check('wg keys', p.sb?.wgPrivateKey === 'eCtXs6ZuBuCcWBpXKrxSlh2ieVucAegIemOE3bQPk20=' && p.sb?.wgPeerPublicKey === '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    check('wg addresses', JSON.stringify(p.sb?.wgAddresses) === JSON.stringify(['10.0.0.2/32', 'fd00::2/128']))
    check('wg mtu/keepalive', p.sb?.wgMtu === 1420 && p.sb?.wgKeepalive === 25)
    check('wg city → NL', p.country === 'NL')
  }
}
{
  // vpn:// — формат AmneziaVPN (3x-ui AmneziaWG): base64url ini-конфига.
  // Включает AWG 2.0 (I1-I5) и расширенные поля sing-box-extended
  // (HPK, тайминги) — всё должно дойти до конфига без потерь.
  const conf = [
    '[Interface]',
    'PrivateKey = eCtXs6ZuBuCcWBpXKrxSlh2ieVucAegIemOE3bQPk20=',
    'Address = 10.5.0.2/32',
    'DNS = 9.9.9.9',
    'MTU = 1280',
    'Jc = 4',
    'Jmin = 40',
    'Jmax = 70',
    'S1 = 105',
    'S2 = 141',
    'S3 = 111',
    'S4 = 93',
    'H1 = 88-157',
    'H2 = 66-188',
    'H3 = 31-213',
    'H4 = 47-204',
    'I1 = <b 0x71165b2b0d1e>',
    'I2 = <b 0xa4c31d05a1>',
    'HeaderProtectionKey = c2VjcmV0LWhway0zMi1ieXRlcy1iYXNlNjQh',
    'RekeyTimeout = 5-10',
    'RandomTrailers = true',
    '',
    '# Poland AWG',
    '[Peer]',
    'PublicKey = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'AllowedIPs = 0.0.0.0/0, ::/0',
    'Endpoint = 203.0.113.5:51820',
    'PersistentKeepalive = 25'
  ].join('\n')
  const b64 = Buffer.from(conf, 'utf-8').toString('base64url')
  const res = parseShareLink(`vpn://${b64}`)
  check('amnezia vpn:// parse', !!res.ok)
  if (res.ok) {
    const p = res.profile
    check('awg fields', p.protocol === 'AmneziaWG' && p.address === '203.0.113.5' && p.port === 51820)
    check('awg amnezia', p.sb?.amnezia?.jc === 4 && p.sb?.amnezia?.jmax === 70)
    check('awg H-диапазоны строками', p.sb?.amnezia?.h1 === '88-157' && p.sb?.amnezia?.h4 === '47-204')
    check('awg I-цепочки (AWG 2.0)', p.sb?.amnezia?.i1 === '<b 0x71165b2b0d1e>' && p.sb?.amnezia?.i2 === '<b 0xa4c31d05a1>')
    check('awg HPK/тайминги/trailers', p.sb?.amnezia?.headerProtectionKey === 'c2VjcmV0LWhway0zMi1ieXRlcy1iYXNlNjQh' && p.sb?.amnezia?.rekeyTimeout === '5-10' && p.sb?.amnezia?.randomTrailers === true)
    check('awg keepalive/dns/mtu', p.sb?.wgKeepalive === 25 && JSON.stringify(p.sb?.wgDns) === JSON.stringify(['9.9.9.9']) && p.sb?.wgMtu === 1280)
    check('awg remark → PL', p.country === 'PL')
    // СКОМПИЛРОВАННЫЙ конфиг: все поля реально дошли до sing-box
    const cfg = buildSingboxLatencyConfig(res.profile, 18499, '203.0.113.5')
    const file = path.join(TMP, 'awg-extended.json')
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2))
    try {
      execSync(`"${SB}" check -c "${file}"`, { stdio: 'pipe' })
      const text = fs.readFileSync(file, 'utf-8')
      check('awg extended: конфиг валиден (h-диапазоны + i1 + hpk)',
        text.includes('"h1": "88-157"') && text.includes('"i1": "<b 0x71165b2b0d1e>"') && text.includes('"header_protection_key"') && text.includes('"rekey_timeout": "5-10"'))
      // random_trailers/disable_cookies НЕ эмитятся: их нет в релизных
      // бинарниках (2.6.5/2.7.1) — иначе весь конфиг отвергается
      check('awg extended: неподдержанные поля не эмитятся', !text.includes('random_trailers') && !text.includes('disable_cookies'))
      check('awg extended: keepalive в peer', text.includes('"persistent_keepalive_interval": 25'))
      // DNS из поля DNS = … (как wg-quick) — в основном конфиге
      const main = buildSingboxConfig({
        server: res.profile,
        settings,
        appRules: apps,
        mode: 'proxy',
        role: 'proxy',
        ports: CORE_PORTS
      })
      const dnsText = JSON.stringify((main.dns as { servers: Array<{ server?: string }> }).servers)
      check('awg extended: dns из конфига wg', dnsText.includes('"9.9.9.9"'))
    } catch (err) {
      check('awg extended: конфиг валиден', false, String((err as { stderr?: Buffer }).stderr ?? '').trim().slice(0, 200))
    }
  }
}
{
  // xhttp vless — транспорт подтягивается, mux отключается
  const res = parseShareLink(
    'vless://d342d11e-d424-4583-b36e-524ab1f0afa4@203.0.113.6:443?encryption=none&security=tls&sni=cdn.example.com&fp=chrome&type=xhttp&path=%2Fxhttp&host=cdn.example.com&mode=auto#XHTTP%20node'
  )
  check('vless+xhttp parse', !!res.ok)
  if (res.ok) {
    check('xhttp stream', res.profile.stream.network === 'xhttp' && res.profile.stream.xhttp?.path === '/xhttp' && res.profile.stream.xhttp?.host === 'cdn.example.com')
  }
}

check('detectCountry: no flag/token → VPN', detectCountry('Server 1') === 'VPN')
check('detectCountry: 🇩🇪 → DE', detectCountry('🇩🇪 Frankfurt #2') === 'DE')
check('detectCountry: Россия → RU', detectCountry('Москва 3') === 'RU')

// ------------------------------------------------------------
console.log('\n[2b] Заголовок profile-title (формат 3x-ui, баг «абракадабра»)')
// ------------------------------------------------------------
{
  // именно так шлёт 3x-ui: base64:<base64url(UTF-8 c эмодзи-флагами)>
  const title = '🇵🇱 M3tr0 VPN'
  const header = `base64:${Buffer.from(title, 'utf-8').toString('base64url')}`
  check('base64:-префикс + флаги', decodeProfileTitle(header) === title)

  // старый баг: без отрезания префикса декодер выдавал «m…»-мусор
  check('мусор не проходит', decodeProfileTitle('base64:!!!') === null)

  // plain-text заголовок с UTF-8, прочитанный как latin1 (undici)
  const utf8Latin1 = Buffer.from('Ünïcode ünion', 'utf-8').toString('latin1')
  check('plain latin1→utf8', decodeProfileTitle(utf8Latin1) === 'Ünïcode ünion')

  check('пустой → null', decodeProfileTitle(null) === null && decodeProfileTitle('') === null)
  check('plain ascii', decodeProfileTitle('My sub') === 'My sub')
}

// ------------------------------------------------------------
console.log('\n[3] Живой e2e: локальный hysteria2-сервер + клиент')
// ------------------------------------------------------------

async function waitHttp(url: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return true
    } catch {
      /* not yet */
    }
    if (Date.now() - started > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function liveHysteria2Test(): Promise<void> {
  // 1) self-signed сертификат
  const certDir = path.join(TMP, 'hy2')
  fs.mkdirSync(certDir, { recursive: true })
  try {
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=hy2.local"`,
      { cwd: certDir, stdio: 'pipe' }
    )
  } catch {
    check('openssl available', false, '(пропускаем живой тест)')
    return
  }

  // 2) сервер sing-box (hysteria2 inbound на 127.0.0.1:18443)
  const serverConfig = {
    log: { level: 'warn' },
    inbounds: [
      {
        type: 'hysteria2',
        tag: 'hy2-in',
        listen: '127.0.0.1',
        listen_port: 18443,
        users: [{ name: 'm3tr0', password: 'testpass' }],
        tls: {
          enabled: true,
          certificate_path: path.join(certDir, 'cert.pem'),
          key_path: path.join(certDir, 'key.pem')
        }
      }
    ],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: { final: 'direct', default_domain_resolver: { server: 'local' } },
    dns: { servers: [{ type: 'local', tag: 'local' }] }
  }
  const serverFile = path.join(TMP, 'hy2-server.json')
  fs.writeFileSync(serverFile, JSON.stringify(serverConfig, null, 2))

  const server = spawn(SB, ['run', '-c', serverFile], { stdio: ['ignore', 'pipe', 'pipe'] })
  let serverLog = ''
  server.stdout?.on('data', (d) => (serverLog += d.toString()))
  server.stderr?.on('data', (d) => (serverLog += d.toString()))

  // 3) клиент через наш генератор
  const clientServer = mkServer('Hysteria2', {
    password: 'testpass',
    insecure: true,
    alpn: ['h3']
  })
  clientServer.address = '127.0.0.1'
  clientServer.port = 18443
  const clientConfig = buildSingboxConfig({
    server: clientServer,
    settings,
    appRules: [],
    mode: 'proxy',
    role: 'proxy',
    ports: { socks: 18080, http: 18081, api: 18490, clash: 19091 }
  })
  const clientFile = path.join(TMP, 'hy2-client.json')
  fs.writeFileSync(clientFile, JSON.stringify(clientConfig, null, 2))

  const client = spawn(SB, ['run', '-c', clientFile], { stdio: ['ignore', 'pipe', 'pipe'] })
  let clientLog = ''
  client.stdout?.on('data', (d) => (clientLog += d.toString()))
  client.stderr?.on('data', (d) => (clientLog += d.toString()))

  try {
    const clashReady = await waitHttp('http://127.0.0.1:19091/version', 8000)
    check('hy2 client: clash-api ready', clashReady, clientLog.slice(-200))

    if (clashReady) {
      // 4) HTTP-запрос через mixed-порт клиента (socks5h)
      const code = await new Promise<number>((resolve) => {
        const curl = spawn('curl', [
          '-s', '-o', '/dev/null', '-w', '%{http_code}',
          '--max-time', '15',
          '-x', 'socks5h://127.0.0.1:18081',
          'http://example.com'
        ])
        let out = ''
        curl.stdout?.on('data', (d) => (out += d.toString()))
        curl.on('close', () => resolve(parseInt(out.trim(), 10) || 0))
        curl.on('error', () => resolve(0))
      })
      check('hy2 e2e: HTTP через туннель = 200', code === 200, `(код ${code})`)

      // 5) статистика /connections растёт
      await new Promise((r) => setTimeout(r, 700))
      const res = await fetch('http://127.0.0.1:19091/connections', { signal: AbortSignal.timeout(2000) })
      const data = (await res.json()) as { downloadTotal?: number }
      check('hy2 e2e: downloadTotal > 0', (data.downloadTotal ?? 0) > 0)
    }
  } finally {
    client.kill('SIGKILL')
    server.kill('SIGKILL')
  }
}

await liveHysteria2Test()

// ------------------------------------------------------------
console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
