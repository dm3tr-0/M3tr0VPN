// ============================================================
// Проверка генераторов конфигов на РЕАЛЬНЫХ ядрах (bun):
//  - Xray: proxy-режим и TUN-режим (нативный tun-инбаунд) —
//    валидация через `xray convert` (парсит конфиг полностью);
//  - sing-box: vless-override и hysteria2 — `sing-box check`.
// Запуск: bun scripts/test-tun-config.ts
// ============================================================

import { buildXrayConfig, DEFAULT_PORTS } from '../src/main/xray/config'
import { buildSingboxConfig } from '../src/main/singbox/config'
import type { AppSettings, ServerProfile } from '../src/shared/types'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(import.meta.dir, '..')
const XRAY = path.join(ROOT, 'core', 'linux', 'xray')
const SINGBOX = path.join(ROOT, 'core', 'linux', 'sing-box')
const TMP = path.join(ROOT, '.tmp-cfg')
fs.mkdirSync(TMP, { recursive: true })

const settings: AppSettings = {
  language: 'ru',
  autoConnect: false,
  launchAtStartup: false,
  ipv6: false,
  mux: true,
  dns: 'auto',
  selectedServerId: 'test',
  selectedDomains: [],
  transportMode: 'tun',
  coreOverrides: {}
}

const vlessReality: ServerProfile = {
  id: 's1',
  name: 'vless reality',
  protocol: 'VLESS',
  address: 'vpn.dm3tr0.ru',
  port: 8443,
  country: 'PL',
  uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  flow: 'xtls-rprx-vision',
  stream: {
    network: 'tcp',
    security: 'reality',
    reality: {
      serverName: 'www.microsoft.com',
      fingerprint: 'chrome',
      // валидный x25519-ключ (для `sing-box check` reality-конфига)
      publicKey: 'qsQTaI95UWQOgQrRSXrXNWwUSB2BPfbPQf4SlD7HFVE',
      shortId: '0123456789abcdef'
    }
  },
  latencyMs: null,
  load: 0,
  subscriptionId: null,
  createdAt: new Date().toISOString()
}

const vlessXhttp: ServerProfile = {
  ...vlessReality,
  id: 's2',
  name: 'vless xhttp',
  port: 50320,
  flow: '',
  stream: {
    network: 'xhttp',
    security: 'tls',
    tls: { serverName: 'vpn.dm3tr0.ru' },
    xhttp: { path: '/xhttp', host: 'vpn.dm3tr0.ru', mode: 'auto' }
  }
}

const hy2: ServerProfile = {
  id: 's3',
  name: 'hysteria',
  protocol: 'Hysteria2',
  address: 'vpn.dm3tr0.ru',
  port: 42568,
  country: 'PL',
  uuid: 'secretpassword',
  stream: { network: 'tcp', security: 'none' },
  sb: { sni: 'vpn.dm3tr0.ru' },
  latencyMs: null,
  load: 0,
  subscriptionId: null,
  createdAt: new Date().toISOString()
}

const excludeIps = ['144.31.112.3', '144.31.112.4', '144.31.112.5']

function writeJson(name: string, obj: unknown): string {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf-8')
  return p
}

let failed = 0

function checkXray(name: string, config: unknown): void {
  const p = writeJson(name, config)
  try {
    // convert pb полностью парсит и валидирует конфиг (включая tun)
    execFileSync(XRAY, ['convert', 'pb', '-o', `${p}.pb`, p], { stdio: 'pipe', timeout: 15000 })
    console.log(`  ✓ xray convert OK — ${name}`)
  } catch (err) {
    failed++
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    console.error(`  ✗ xray convert FAILED — ${name}`)
    console.error(String(e.stderr ?? e.stdout ?? e.message).slice(0, 2000))
  }
}

function checkSingbox(name: string, config: unknown): void {
  const p = writeJson(name, config)
  try {
    execFileSync(SINGBOX, ['check', '-c', p], { stdio: 'pipe', timeout: 15000 })
    console.log(`  ✓ sing-box check OK — ${name}`)
  } catch (err) {
    failed++
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    console.error(`  ✗ sing-box check FAILED — ${name}`)
    console.error(String(e.stderr ?? e.stdout ?? e.message).slice(0, 2000))
  }
}

console.log('=== Xray: proxy-режим ===')
checkXray(
  'xray-proxy.json',
  buildXrayConfig(settings, vlessReality, [], 'proxy', DEFAULT_PORTS)
)
checkXray(
  'xray-proxy-xhttp.json',
  buildXrayConfig(settings, vlessXhttp, [], 'proxy', DEFAULT_PORTS)
)

console.log('=== Xray: TUN-режим (нативный tun-инбаунд) ===')
const tunCfg = buildXrayConfig(
  { ...settings, transportMode: 'tun' },
  vlessReality,
  [],
  'tun',
  DEFAULT_PORTS,
  '144.31.112.3',
  excludeIps
)
checkXray('xray-tun.json', tunCfg)
const table = ((tunCfg.inbounds as Array<{ tag?: string; settings?: { autoSystemRoutingTable?: string[] } }>)
  .find((i) => i.tag === 'tun-in')?.settings?.autoSystemRoutingTable ?? []) as string[]
console.log(`  autoSystemRoutingTable (${table.length} cidr): ${table.join(' ')}`)

checkXray(
  'xray-tun-xhttp.json',
  buildXrayConfig({ ...settings, transportMode: 'tun' }, vlessXhttp, [], 'tun', DEFAULT_PORTS, '144.31.112.3', excludeIps)
)

console.log('=== sing-box: роли proxy / tun-direct и vless-override ===')
checkSingbox(
  'sb-hy2-tun.json',
  buildSingboxConfig({ server: hy2, settings: { ...settings, transportMode: 'tun' }, appRules: [], mode: 'tun', role: 'tun-direct', ports: DEFAULT_PORTS, excludeIps })
)
checkSingbox(
  'sb-hy2-proxy.json',
  buildSingboxConfig({ server: hy2, settings: { ...settings, transportMode: 'proxy' }, appRules: [], mode: 'proxy', role: 'proxy', ports: DEFAULT_PORTS })
)
checkSingbox(
  'sb-vless-override-tun.json',
  buildSingboxConfig({
    server: vlessReality,
    settings: { ...settings, transportMode: 'tun', coreOverrides: { VLESS: 'singbox' } },
    appRules: [],
    mode: 'tun',
    role: 'tun-direct',
    ports: DEFAULT_PORTS,
    excludeIps
  })
)

if (failed > 0) {
  console.error(`\n${failed} FAILED`)
  process.exit(1)
}
console.log('\nALL OK')
