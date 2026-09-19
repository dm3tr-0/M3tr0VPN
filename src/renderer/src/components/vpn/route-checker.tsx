// ============================================================
// M3tr0VPN — проверка маршрута: куда пойдёт домен
// Десктоп: вычисление локально через @shared/routing
// (тот же движок, что генерирует правила Xray в main).
// ============================================================

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Globe2, SearchCheck, ShieldCheck } from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import { isValidDomain, normalizeDomain, evaluateDomain } from '@shared/routing'
import type { RouteCheckResult } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

const EXAMPLES = ['youtube.com', 'sber.ru', 'github.com']

export function RouteChecker(): React.JSX.Element {
  const { t } = useI18n()
  const { snap } = useAppState()
  const [domain, setDomain] = useState('')
  const [result, setResult] = useState<RouteCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = (raw: string): void => {
    const d = normalizeDomain(raw)
    if (!d || !isValidDomain(d)) {
      setError(t.tunneling.domainInvalid)
      setResult(null)
      return
    }
    setError(null)
    setResult(evaluateDomain(d, snap?.settings.selectedDomains ?? []))
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
      <header className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SearchCheck className="h-4.5 w-4.5" aria-hidden />
        </span>
        <div>
          <h3 className="text-base font-semibold">{t.tunneling.checkerTitle}</h3>
          <p className="text-xs text-muted-foreground">{t.tunneling.checkerHint}</p>
        </div>
      </header>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (domain.trim()) check(domain)
        }}
      >
        <Input
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value)
            setError(null)
          }}
          placeholder={t.tunneling.checkerPlaceholder}
          aria-label={t.tunneling.checkerTitle}
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!domain.trim()}
          className="shrink-0 font-mono text-xs"
        >
          <SearchCheck className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t.tunneling.check}</span>
          <span className="sr-only sm:hidden">{t.tunneling.check}</span>
        </Button>
      </form>

      {/* примеры */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setDomain(ex)
              check(ex)
            }}
            className="rounded border border-border bg-background/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {ex}
          </button>
        ))}
      </div>

      {/* ошибка */}
      {error && (
        <p className="mt-3 font-mono text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* результат */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'mt-4 flex items-start gap-3 rounded-lg border p-3.5',
            result.throughVpn ? 'border-primary/30 bg-primary/5' : 'border-amber-400/25 bg-amber-400/5'
          )}
          role="status"
        >
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              result.throughVpn ? 'bg-primary/15 text-primary' : 'bg-amber-400/15 text-amber-300'
            )}
          >
            {result.throughVpn ? (
              <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
            ) : (
              <ArrowRight className="h-4.5 w-4.5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                'font-mono text-sm font-semibold uppercase tracking-wider',
                result.throughVpn ? 'text-primary' : 'text-amber-300'
              )}
            >
              {result.throughVpn ? t.tunneling.verdictVpn : t.tunneling.verdictDirect}
            </p>
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {result.reasonKey === 'all-vpn'
                ? t.tunneling.reasonAllVpn
                : result.reasonKey === 'in-selected'
                  ? t.tunneling.reasonInSelected
                  : t.tunneling.reasonNotSelected}
            </p>
            {result.matchedPattern && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                <Globe2 className="h-3 w-3" aria-hidden />
                {t.tunneling.matchLabel}:{' '}
                <span className="text-primary">{result.matchedPattern}</span>
              </p>
            )}
          </div>
        </motion.div>
      )}
    </section>
  )
}
