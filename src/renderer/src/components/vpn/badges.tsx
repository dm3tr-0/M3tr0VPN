// ============================================================
// M3tr0VPN — мелкие общие элементы: бейджи протокола и страны.
// Страна — SVG-флаг (country-flag-icons): в Windows НЕТ эмодзи-флагов
// (Segoe UI Emoji рендерит 🇵🇱 как две буквы «PL»), поэтому эмодзи
// заменены на настоящие графические флаги — как в v2rayN.
// ============================================================

import { Globe } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { isValidCountry } from '@renderer/lib/format'
// 272 SVG-компонента флагов 3:2 — бандлится целиком (~1 МБ, десктоп)
import * as Flags3x2 from 'country-flag-icons/react/3x2'

type FlagComponent = React.ComponentType<{ title?: string; className?: string }>
const flagComponents = Flags3x2 as unknown as Record<string, FlagComponent>

const protocolStyles: Record<string, string> = {
  VLESS: 'border-primary/40 bg-primary/10 text-primary',
  VMess: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  Trojan: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  Shadowsocks: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  Hysteria2: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300',
  Hysteria: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300',
  TUIC: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  WireGuard: 'border-red-400/30 bg-red-400/10 text-red-300',
  AmneziaWG: 'border-red-400/30 bg-red-400/10 text-red-300'
}

export function ProtocolBadge({
  protocol,
  className
}: {
  protocol: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
        protocolStyles[protocol] ?? 'border-border bg-muted text-muted-foreground',
        className
      )}
    >
      {protocol}
    </span>
  )
}

/**
 * Бейдж страны: настоящий SVG-флаг 3:2 (не эмодзи — их нет в Windows).
 * Неизвестная страна → глобус.
 */
export function CountryBadge({
  country,
  className
}: {
  country: string
  className?: string
}): React.JSX.Element {
  const cc = (country ?? '').toUpperCase()
  const valid = isValidCountry(cc)
  const FlagSvg = valid ? flagComponents[cc] : undefined
  return (
    <span
      className={cn(
        'inline-flex h-6 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-border/80 bg-muted/60',
        className
      )}
      aria-hidden
      title={valid ? cc : undefined}
    >
      {FlagSvg ? (
        <FlagSvg title={cc} className="h-full w-full" />
      ) : (
        <Globe className="h-3.5 w-3.5 text-muted-foreground/70" />
      )}
    </span>
  )
}

export function LoadBar({ load }: { load: number }): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, load))
  const color = pct < 50 ? 'bg-primary' : pct < 80 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <span
      className="block h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span
        className={cn('block h-full rounded-full transition-all', color)}
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}
