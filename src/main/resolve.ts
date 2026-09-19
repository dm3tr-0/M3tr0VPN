// ============================================================
// M3tr0VPN — прямое DNS-разрешение адресов серверов.
//
// ЗАЧЕМ: в режиме TUN весь трафик системы завёрнут в sing-box,
// а sing-box гоняет его в Xray (socks). Если Xray сам должен
// разрешить домен VPN-сервера — его системный DNS-запрос тоже
// попадает в TUN → DoH → снова в Xray → «уроборос», всё висит
// («dns: exchange failed … dial tcp 127.0.0.1:1080: i/o timeout»).
//
// КАК (как делает v2rayN/sing-box для своего outbound):
//  1) адрес сервера разрешаем ДО старта ядер (прямой системный
//     DNS, TUN ещё не поднят) и «пришпиливаем» IP в конфиг Xray;
//  2) все IP серверов подписки исключаем из маршрутов TUN
//     (sing-box tun.route_exclude_address) — соединение Xray
//     с сервером уходит через физический интерфейс напрямую.
//
// Кэш 5 минут: замер пинга при живом TUN берёт адреса отсюда,
// а не через (возможно мёртвый) туннель.
// ============================================================

import { promises as dns } from 'dns'
import type { ServerProfile } from '@shared/types'

const CACHE_TTL_MS = 5 * 60 * 1000
const RESOLVE_TIMEOUT_MS = 4000

interface CacheEntry {
  ips: string[]
  t: number
}

const cache = new Map<string, CacheEntry>()

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/

/** Это уже IP-литерал (v4 или v6), а не домен? */
export function isIpLiteral(address: string): boolean {
  return IPV4_RE.test(address) || address.includes(':')
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

/** Все IPv4-адреса домена (для IP-литерала — он сам). Без throw. */
export async function resolveHostIps(host: string): Promise<string[]> {
  if (!host || isIpLiteral(host)) return host ? [host] : []
  const hit = cache.get(host)
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.ips

  let ips: string[] = []
  try {
    ips = await withTimeout(dns.resolve4(host), RESOLVE_TIMEOUT_MS)
  } catch {
    /* IPv4 нет — попробуем IPv6 (сервер может быть только v6) */
    try {
      ips = await withTimeout(dns.resolve6(host), RESOLVE_TIMEOUT_MS)
    } catch {
      ips = []
    }
  }
  cache.set(host, { ips, t: Date.now() })
  return ips
}

/** Первый адрес домена (для «пришпиливания» в конфиг Xray) */
export async function resolveServerIp(address: string): Promise<string | null> {
  const ips = await resolveHostIps(address)
  return ips.length > 0 ? ips[0] : null
}

/**
 * IP всех серверов (подписки + ручные) для исключения из TUN:
 *  - соединение активного ядра с ВЫБРАННЫМ сервером уходит мимо TUN;
 *  - временные ядра замера пинга тоже ходят напрямую — результат
 *    честный даже при активном (или сломанном) туннеле.
 */
export async function resolveAllServerIps(servers: ServerProfile[]): Promise<string[]> {
  const hosts = [...new Set(servers.map((s) => s.address).filter((a) => !isIpLiteral(a)))]
  if (hosts.length === 0) return []
  const results = await Promise.allSettled(hosts.map((h) => resolveHostIps(h)))
  const ips = new Set<string>()
  for (const r of results) {
    if (r.status === 'fulfilled') for (const ip of r.value) ips.add(ip)
  }
  return [...ips]
}
