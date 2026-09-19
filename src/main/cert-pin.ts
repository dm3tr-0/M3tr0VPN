// ============================================================
// M3tr0VPN — TOFU-пин сертификата сервера.
//
// Xray-core 26.x УДАЛИЛ allowInsecure: «The feature "allowInsecure"
// has been removed and migrated to "pinnedPeerCertSha256"».
// Ссылки с insecure=1 (self-signed, 3x-ui) на Xray просто не прошли
// бы TLS-верификацию. Поэтому для TLS-по-TCP протоколов
// (vless/vmess/trojan/ss) мы сами снимаем отпечаток сертификата
// сервера (tls.connect, rejectUnauthorized: false — как браузер
// при первом посещении) и «пришпиливаем» его в конфиг Xray:
// pinnedPeerCertSha256 = hex(SHA256(DER-сертификата)).
//
// Hysteria2 работает по QUIC/UDP — отпечаток по TCP не снять,
// для неё без pinSHA256 применяется probe-фолбэк на sing-box
// (см. vpn.ts: умный коннект).
//
// Пин кэшируется на 10 минут: обновляемый сертификат (Let's
// Encrypt, 90 дней) подхватится между подключениями.
// ============================================================

import tls from 'tls'
import crypto from 'crypto'

const CACHE_TTL_MS = 10 * 60 * 1000
const CONNECT_TIMEOUT_MS = 5000

const cache = new Map<string, { pin: string; ts: number }>()

/** Является ли строка IP-литералом (для SNI не годится) */
function isIp(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')
}

/**
 * SHA256-отпечаток сертификата сервера в hex (64 символа) — формат,
// который ожидает Xray pinnedPeerCertSha256. null — не удалось снять.
 */
export async function fetchCertSha256Pin(
  host: string,
  port: number,
  serverName?: string,
  timeoutMs = CONNECT_TIMEOUT_MS
): Promise<string | null> {
  const key = `${host}:${port}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.pin

  const sni = serverName && !isIp(serverName) ? serverName : !isIp(host) ? host : undefined
  return new Promise((resolve) => {
    let settled = false
    const finish = (pin: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sock.destroy()
      } catch {
        /* уже закрыт */
      }
      if (pin) cache.set(key, { pin, ts: Date.now() })
      resolve(pin)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const sock = tls.connect(
      {
        host,
        port,
        ...(sni ? { servername: sni } : {}),
        rejectUnauthorized: false,
        ALPNProtocols: ['http/1.1']
      },
      () => {
        try {
          const cert = sock.getPeerCertificate()
          if (!cert || !cert.raw) return finish(null)
          const hex = cryptoSha256Hex(cert.raw)
          finish(hex)
        } catch {
          finish(null)
        }
      }
    )
    sock.once('error', () => finish(null))
    sock.once('close', () => finish(null))
  })
}

function cryptoSha256Hex(der: Buffer): string {
  return crypto.createHash('sha256').update(der).digest('hex')
}

/**
 * Нормализация пина из ссылки (pinSHA256/pcs) к hex.
 * Официальный формат hy2 — base64url; Xray хочет чистый hex.
 */
export function normalizePinToHex(pin: string): string | null {
  const trimmed = pin.trim().replace(/:/g, '')
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase()
  try {
    const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
    const buf = Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64')
    if (buf.length === 32) return buf.toString('hex')
  } catch {
    /* не base64 */
  }
  return null
}

/** Очистить кэш пинов (например, после refresh подписки) */
export function clearCertPinCache(): void {
  cache.clear()
}
