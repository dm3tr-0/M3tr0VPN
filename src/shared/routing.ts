// ============================================================
// M3tr0VPN — движок маршрутизации (порт из веб-прототипа)
// Чистые функции: используются UI (проверка маршрута) и
// генератором Xray-конфига.
//
// Правила продукта:
//  - selectedDomains пуст  -> ВЕСЬ трафик через VPN;
//  - selectedDomains непуст -> через VPN идут ТОЛЬКО домены
//    из списка (точное совпадение + любые поддомены),
//    остальное — напрямую.
// ============================================================

import type { RouteCheckResult } from './types'

/**
 * Нормализация домена: trim + lowercase, срезаем схему http(s)://,
 * путь, порт. Префикс «www.» НЕ убирается.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  d = d.replace(/:\d{1,5}$/, '')
  return d.trim()
}

/** Простая проверка корректности домена: метки + минимум одна точка. */
export function isValidDomain(d: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)
}

/** Совпадение домена с шаблоном: точное ИЛИ любой поддомен. */
export function domainMatches(domain: string, pattern: string): boolean {
  const d = domain.trim().toLowerCase()
  const p = pattern.trim().toLowerCase()
  if (!d || !p) return false
  return d === p || d.endsWith('.' + p)
}

/** Главный вычислитель: куда пойдёт домен при текущем списке «Выбранное». */
export function evaluateDomain(domain: string, selectedDomains: string[]): RouteCheckResult {
  const normalized = normalizeDomain(domain)

  if (selectedDomains.length === 0) {
    return { throughVpn: true, reasonKey: 'all-vpn' }
  }

  for (const rawPattern of selectedDomains) {
    const pattern = normalizeDomain(rawPattern)
    if (!pattern) continue
    if (domainMatches(normalized, pattern)) {
      return { throughVpn: true, reasonKey: 'in-selected', matchedPattern: pattern }
    }
  }

  return { throughVpn: false, reasonKey: 'not-in-selected' }
}
