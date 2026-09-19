// ============================================================
// M3tr0VPN — подписки: загрузка, обновление, метаданные.
//  - имя можно не задавать: возьмём profile-title (3x-ui, base64),
//    затем filename из content-disposition, затем hostname;
//  - subscription-userinfo → трафик и срок подписки;
//  - используется и IPC-обработчиками, и автообновлением при старте.
// ============================================================

import { randomUUID } from 'crypto'
import type { Store } from './store'
import type { ServerProfile, Subscription, SubscriptionUserInfo } from '@shared/types'
import { parseSubscriptionBody } from './uri'

/**
 * Заголовки HTTP приходят как latin1 (undici), поэтому UTF-8 строки
 * (эмодзи-флаги 3x-ui и кириллица) превращаются в «абракадабру».
 * Если в строке есть байты >0x7F — перекодируем latin1 → utf8.
 */
function fixHeaderEncoding(value: string): string {
  if (!/[\x80-\xFF]/.test(value)) return value
  try {
    const fixed = Buffer.from(value, 'latin1').toString('utf-8')
    // если после конвертации остались U+FFFD — оригинал уже был UTF-8
    if (!/\uFFFD/.test(fixed)) return fixed
  } catch {
    /* оставляем как есть */
  }
  return value
}

/** Убираем управляющие символы (кроме пробельных), не ломая эмодзи-флаги */
function sanitizeName(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * profile-title по спецификации подписок:
 *   «base64:<base64url-UTF8>» (так шлёт 3x-ui) либо plain-text UTF-8.
 * Раньше префикс «base64:» не отрезался — декодер превращал символы
 * «base64» в мусорные байты перед именем («m…» в логах).
 */
export function decodeProfileTitle(header: string | null): string | null {
  if (!header) return null
  const raw = fixHeaderEncoding(header).trim()
  if (!raw) return null
  try {
    if (/^base64:/i.test(raw)) {
      const payload = raw.slice(raw.indexOf(':') + 1)
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
      const decoded = Buffer.from(padded, 'base64').toString('utf-8').trim()
      const clean = sanitizeName(decoded)
      // мусор после декодирования (битый base64) не показываем
      return clean && !/\uFFFD/.test(clean) ? clean : null
    }
    const clean = sanitizeName(raw)
    return clean || null
  } catch {
    return null
  }
}

/** Безопасные схемы внешних ссылок (3x-ui шлёт и mailto:, и tg:) */
const EXTERNAL_URL_RE = /^(https?|mailto|tg|slack|discord|skype):/i

/** URL из заголовков 3x-ui (profile-web-page-url / support-url) */
export function headerUrl(header: string | null): string | null {
  if (!header) return null
  const fixed = fixHeaderEncoding(header).trim().replace(/[\u0000-\u001F\u007F]/g, '')
  if (!EXTERNAL_URL_RE.test(fixed) || fixed.length > 512) return null
  return fixed
}

/** content-disposition: attachment; filename="My sub" */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const fixed = fixHeaderEncoding(header)
  const m = fixed.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i)
  if (!m) return null
  try {
    return sanitizeName(decodeURIComponent(m[1].trim())) || null
  } catch {
    return sanitizeName(m[1].trim()) || null
  }
}

/** subscription-userinfo: upload=1; download=2; total=3; expire=1699999999 */
export function parseUserInfo(header: string | null): SubscriptionUserInfo | undefined {
  if (!header) return undefined
  const out: SubscriptionUserInfo = { upload: 0, download: 0 }
  let matched = false
  for (const part of header.split(';')) {
    const m = part.trim().match(/^([a-z_]+)=(\d+)$/i)
    if (!m) continue
    matched = true
    const value = Number(m[2])
    switch (m[1].toLowerCase()) {
      case 'upload':
        out.upload = value
        break
      case 'download':
        out.download = value
        break
      case 'total':
        out.total = value
        break
      case 'expire':
        out.expire = value
        break
      default:
        break
    }
  }
  return matched ? out : undefined
}

interface FetchResult {
  profiles: ServerProfile[]
  autoName: string | null
  userInfo: SubscriptionUserInfo | undefined
  websiteUrl: string | null
  supportUrl: string | null
}

async function fetchSubscription(url: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'M3tr0VPN/1.2 v2rayN/7.0' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow'
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()

  const autoName =
    decodeProfileTitle(res.headers.get('profile-title')) ??
    filenameFromDisposition(res.headers.get('content-disposition')) ??
    null
  const userInfo = parseUserInfo(res.headers.get('subscription-userinfo'))
  // 3x-ui: ссылки «Сайт» и «Поддержка» из настроек панели подписки
  const websiteUrl = headerUrl(res.headers.get('profile-web-page-url'))
  const supportUrl = headerUrl(res.headers.get('support-url'))
  const { profiles } = parseSubscriptionBody(body, 'pending')
  return { profiles, autoName, userInfo, websiteUrl, supportUrl }
}

export interface RefreshOutcome {
  ok: boolean
  error?: string
  subscription?: Subscription
  skippedSchemes?: string[]
}

/** Создать подписку (имя может быть пустым → возьмём с сервера) */
export async function addSubscription(
  store: Store,
  name: string,
  url: string
): Promise<RefreshOutcome> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid url' }
  const subId = randomUUID()
  const { profiles, autoName, userInfo, websiteUrl, supportUrl } = await fetchSubscription(url)
  if (profiles.length === 0) return { ok: false, error: 'no servers found' }
  for (const p of profiles) p.subscriptionId = subId

  const host = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  const sub: Subscription = {
    id: subId,
    name: (name || '').trim() || autoName || host,
    url,
    serverCount: profiles.length,
    updatedAt: new Date().toISOString(),
    userInfo,
    autoName: !(name || '').trim() && !!autoName,
    websiteUrl,
    supportUrl
  }
  store.upsertSubscription(sub)
  store.replaceSubscriptionServers(subId, profiles)
  return { ok: true, subscription: sub }
}

/** Обновить подписку (данные, автоимя, трафик) */
export async function refreshSubscription(store: Store, id: string): Promise<RefreshOutcome> {
  const sub = store.subscriptions.find((s) => s.id === id)
  if (!sub) return { ok: false, error: 'not found' }
  const { profiles, autoName, userInfo, websiteUrl, supportUrl } = await fetchSubscription(sub.url)
  for (const p of profiles) p.subscriptionId = id
  store.replaceSubscriptionServers(id, profiles)
  // миграция: имя, испорченное старым декодером (U+FFFD), заменяем
  const storedNameBroken = sub.name.includes('\uFFFD')
  const host = (() => {
    try {
      return new URL(sub.url).hostname
    } catch {
      return sub.url
    }
  })()
  const nextName = storedNameBroken
    ? autoName ?? host
    : sub.autoName && autoName
      ? autoName
      : sub.name
  const updated: Subscription = {
    ...sub,
    // имя с сервера обновляем только если пользователь не задавал своё
    name: nextName,
    autoName: storedNameBroken ? true : sub.autoName,
    serverCount: profiles.length,
    updatedAt: new Date().toISOString(),
    userInfo: userInfo ?? sub.userInfo,
    // ссылки «Сайт»/«Поддержка» строго следуют за панелью 3x-ui:
    // убрали в панели — кнопки исчезли и здесь
    websiteUrl,
    supportUrl
  }
  store.upsertSubscription(updated)
  return { ok: true, subscription: updated }
}

/** Автообновление всех подписок при запуске (тихое, ошибки — в журнал) */
export async function refreshAllSubscriptions(
  store: Store,
  log: (message: string) => void
): Promise<void> {
  for (const sub of store.subscriptions) {
    try {
      const res = await refreshSubscription(store, sub.id)
      if (res.ok) {
        log(`subscription updated: ${res.subscription?.name ?? sub.name}`)
      } else {
        log(`subscription update failed: ${sub.name}: ${res.error}`)
      }
    } catch (err) {
      log(`subscription update failed: ${sub.name}: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }
}
