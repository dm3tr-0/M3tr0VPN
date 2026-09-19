// ============================================================
// M3tr0VPN — форматтеры чисел и времени (порт из веб-прототипа)
// Скорости ядра приходят в байтах/сек — конвертируем в Мбит/с.
// ============================================================

/** байт/сек → Мбит/с */
export function bytesToMbps(bytesPerSec: number): number {
  return (bytesPerSec * 8) / 1_000_000
}

export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return '0.0'
  if (mbps >= 100) return Math.round(mbps).toString()
  return mbps.toFixed(1)
}

export function formatBytes(bytes: number, lang: 'ru' | 'en' = 'ru'): string {
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] : ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes <= 0) return '0 ' + units[0]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const v = bytes / Math.pow(1024, i)
  return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + units[i]
}

export function formatSessionDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * Цвет пинга. Основной замер — «real delay» как в v2rayN (минимум из
 * 2 запросов через туннель): до 200 мс — отлично, до 600 — терпимо
 * (дальние серверы), дальше — плохо.
 */
export function latencyColor(ms: number | null | undefined): string {
  if (ms == null) return 'text-muted-foreground'
  if (ms < 200) return 'text-primary'
  if (ms < 600) return 'text-yellow-500'
  return 'text-red-400'
}

/** Русская/английская плюрализация: plural(3, ["сервер","сервера","серверов"], "ru") */
export function plural(n: number, forms: [string, string, string], lang: 'ru' | 'en'): string {
  if (lang === 'en') return n === 1 ? forms[0] : forms[2]
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1]
  return forms[2]
}

/** Валидные ISO-коды стран (для флагов) */
export const ISO_COUNTRIES = new Set([
  'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
])

/** Является ли код страны валидным (для показа флага) */
export function isValidCountry(code: string | null | undefined): boolean {
  return !!code && ISO_COUNTRIES.has(code.toUpperCase())
}

/** 'PL' → '🇵🇱' (эмодзи-флаг) */
export function flagEmoji(code: string | null | undefined): string {
  if (!isValidCountry(code)) return ''
  const cc = code!.toUpperCase()
  return String.fromCodePoint(
    0x1f1e6 + (cc.charCodeAt(0) - 65),
    0x1f1e6 + (cc.charCodeAt(1) - 65)
  )
}

/** Убираем эмодзи-флаги из имени (они и так в бейдже страны) */
export function stripFlagEmojis(name: string): string {
  // eslint-disable-next-line no-misleading-character-class
  return name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]\uFE0F?/g, '').trim()
}

/** «обновлена 5 мин назад» от ISO-времени */
export function formatUpdatedAgo(iso: string, lang: 'ru' | 'en'): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.max(0, Math.floor(diff / 60000))
  if (min < 1) return lang === 'ru' ? 'только что' : 'just now'
  if (min < 60) return lang === 'ru' ? `${min} мин назад` : `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return lang === 'ru' ? `${h} ч назад` : `${h} h ago`
  const d = Math.floor(h / 24)
  return lang === 'ru' ? `${d} дн назад` : `${d} d ago`
}

export function countryName(code: string, lang: 'ru' | 'en'): string {
  const names: Record<string, { ru: string; en: string }> = {
    NL: { ru: 'Нидерланды', en: 'Netherlands' },
    DE: { ru: 'Германия', en: 'Germany' },
    FI: { ru: 'Финляндия', en: 'Finland' },
    SE: { ru: 'Швеция', en: 'Sweden' },
    US: { ru: 'США', en: 'USA' },
    FR: { ru: 'Франция', en: 'France' },
    GB: { ru: 'Великобритания', en: 'United Kingdom' },
    TR: { ru: 'Турция', en: 'Turkey' },
    KZ: { ru: 'Казахстан', en: 'Kazakhstan' },
    AM: { ru: 'Армения', en: 'Armenia' },
    SG: { ru: 'Сингапур', en: 'Singapore' },
    JP: { ru: 'Япония', en: 'Japan' },
    PL: { ru: 'Польша', en: 'Poland' },
    CZ: { ru: 'Чехия', en: 'Czechia' },
    AT: { ru: 'Австрия', en: 'Austria' },
    CH: { ru: 'Швейцария', en: 'Switzerland' },
    ES: { ru: 'Испания', en: 'Spain' },
    PT: { ru: 'Португалия', en: 'Portugal' },
    IT: { ru: 'Италия', en: 'Italy' },
    RO: { ru: 'Румыния', en: 'Romania' },
    BG: { ru: 'Болгария', en: 'Bulgaria' },
    HU: { ru: 'Венгрия', en: 'Hungary' },
    LV: { ru: 'Латвия', en: 'Latvia' },
    LT: { ru: 'Литва', en: 'Lithuania' },
    EE: { ru: 'Эстония', en: 'Estonia' },
    UA: { ru: 'Украина', en: 'Ukraine' },
    GE: { ru: 'Грузия', en: 'Georgia' },
    MD: { ru: 'Молдова', en: 'Moldova' },
    AZ: { ru: 'Азербайджан', en: 'Azerbaijan' },
    RS: { ru: 'Сербия', en: 'Serbia' },
    HK: { ru: 'Гонконг', en: 'Hong Kong' },
    KR: { ru: 'Южная Корея', en: 'South Korea' },
    IN: { ru: 'Индия', en: 'India' },
    AE: { ru: 'ОАЭ', en: 'UAE' },
    CA: { ru: 'Канада', en: 'Canada' },
    BR: { ru: 'Бразилия', en: 'Brazil' },
    MX: { ru: 'Мексика', en: 'Mexico' },
    AU: { ru: 'Австралия', en: 'Australia' },
    NZ: { ru: 'Новая Зеландия', en: 'New Zealand' },
    ZA: { ru: 'ЮАР', en: 'South Africa' },
    IL: { ru: 'Израиль', en: 'Israel' },
    IR: { ru: 'Иран', en: 'Iran' },
    CN: { ru: 'Китай', en: 'China' },
    VN: { ru: 'Вьетнам', en: 'Vietnam' },
    TH: { ru: 'Таиланд', en: 'Thailand' },
    ID: { ru: 'Индонезия', en: 'Indonesia' },
    MY: { ru: 'Малайзия', en: 'Malaysia' },
    PH: { ru: 'Филиппины', en: 'Philippines' },
    AR: { ru: 'Аргентина', en: 'Argentina' },
    CL: { ru: 'Чили', en: 'Chile' },
    UZ: { ru: 'Узбекистан', en: 'Uzbekistan' },
    KG: { ru: 'Киргизия', en: 'Kyrgyzstan' },
    BY: { ru: 'Беларусь', en: 'Belarus' },
    RU: { ru: 'Россия', en: 'Russia' }
  }
  if (!isValidCountry(code)) return lang === 'ru' ? 'не определена' : 'unknown'
  return names[code.toUpperCase()]?.[lang] ?? code.toUpperCase()
}
