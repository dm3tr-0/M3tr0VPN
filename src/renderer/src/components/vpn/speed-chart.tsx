// ============================================================
// M3tr0VPN — живой график скорости (SVG, без библиотек)
// История приходит в байтах/сек; живые значения — в Мбит/с.
// ============================================================

import { useId, useMemo } from 'react'
import { useI18n } from '@renderer/lib/i18n-context'
import { bytesToMbps, formatSpeed } from '@renderer/lib/format'
import { cn } from '@renderer/lib/utils'

interface SpeedChartProps {
  /** история скоростей, байт/сек */
  history: { down: number; up: number }[]
  live: boolean
  /** текущая скорость, байт/сек */
  down: number
  up: number
  maxPoints?: number
}

export function SpeedChart({ history, live, down, up, maxPoints = 60 }: SpeedChartProps): React.JSX.Element {
  const gradientId = useId()
  const { t } = useI18n()

  const { downPath, upPath, areaPath } = useMemo(() => {
    const pts = history.slice(-maxPoints)
    const W = 100
    const H = 100
    const max = Math.max(10, ...pts.map((p) => p.down), ...pts.map((p) => p.up))
    const stepX = pts.length > 1 ? W / (pts.length - 1) : W

    const toPath = (key: 'down' | 'up'): string =>
      pts
        .map((p, i) => {
          const x = i * stepX
          const y = H - (p[key] / max) * (H - 8) - 4
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
        })
        .join(' ')

    const down = toPath('down')
    const up = toPath('up')
    const area = pts.length > 1 ? `${down} L${W},${H} L0,${H} Z` : ''

    return { downPath: down, upPath: up, areaPath: area }
  }, [history, maxPoints])

  const empty = history.length < 2

  return (
    <div className="rounded-xl border border-border/70 bg-background/40">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3">
        <span className="font-mono text-[11px] uppercase leading-tight tracking-widest text-muted-foreground">
          {t.status.realtime}
        </span>
        <span className="flex items-center gap-3 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-primary">
            ↓ {formatSpeed(bytesToMbps(down))} {t.common.mbps}
          </span>
          <span className="flex items-center gap-1 text-chart-2">
            ↑ {formatSpeed(bytesToMbps(up))} {t.common.mbps}
          </span>
          <span className={cnLive(live)} aria-hidden />
        </span>
      </div>

      <div className="h-28 px-2 pb-2">
        {empty ? (
          <div className="relative flex h-full items-center justify-center">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-full w-full"
              aria-hidden
            >
              <line
                x1="0"
                y1="96"
                x2="100"
                y2="96"
                stroke="currentColor"
                strokeWidth="0.4"
                className="text-border"
                strokeDasharray="2 2"
              />
            </svg>
            <span className="absolute font-mono text-[11px] text-muted-foreground/70">—</span>
          </div>
        ) : (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={t.status.realtime}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* сетка */}
            {[25, 50, 75].map((y) => (
              <line
                key={y}
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke="currentColor"
                strokeWidth="0.3"
                className="text-border"
                strokeDasharray="1.5 2"
              />
            ))}
            {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
            <path
              d={downPath}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={upPath}
              fill="none"
              stroke="var(--chart-2)"
              strokeWidth="1.1"
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
    </div>
  )
}

function cnLive(live: boolean): string {
  return [
    'inline-block h-1.5 w-1.5 rounded-full transition-colors',
    live ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'
  ].join(' ')
}
