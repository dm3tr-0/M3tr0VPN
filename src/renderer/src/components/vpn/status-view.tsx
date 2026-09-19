// ============================================================
// M3tr0VPN — экран «Статус»
// Одна карточка подключения: большая кнопка, статистика,
// скорость и журнал ядра. Справа — список подписок и серверов.
// Все данные — из снапшота IPC (реальные скорости ядра).
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Eraser,
  FileJson,
  Globe2,
  Loader2,
  ShieldAlert,
  ShieldCheck
} from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import {
  bytesToMbps,
  stripFlagEmojis,
  formatBytes,
  formatSessionDuration,
  formatSpeed
} from '@renderer/lib/format'
import type { LogEntry } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { ConfigDialog } from './config-dialog'
import { ConnectionsPanel } from './connections-panel'
import { CountryBadge } from './badges'
import { PowerButton } from './power-button'
import { SpeedChart } from './speed-chart'

export function StatusView(): React.JSX.Element {
  const { t, lang } = useI18n()
  const { snap, state, logs, history, connectPhase, now, selectedServer, connect, disconnect, clearLogs } =
    useAppState()

  const connected = state === 'connected'
  const connecting = state === 'connecting'
  const errored = state === 'error'

  const status = snap?.status
  const transportMode = status?.transport ?? snap?.settings.transportMode ?? 'proxy'
  const transportLabel = transportMode === 'tun' ? t.status.transportTun : t.status.transportProxy

  const phases = [t.status.phaseCheck, t.status.phaseHandshake, t.status.phaseTunnel]

  const sessionMs = connected && status?.since ? now - status.since : 0

  const handleToggle = (): void => {
    if (!selectedServer) return
    if (connected) void disconnect()
    else if (!connecting) void connect()
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
      {/* ---------- карточка подключения ---------- */}
      {/* @container — тайлы статистики считают ширину по карточке,
          а не по окну: в узком двухколоночном режиме (lg при
          не-максимальном окне) уходят в 2×2, а не обрезаются */}
      <div className="@container flex min-w-0 flex-col gap-5 rounded-xl border border-border/70 bg-card/50 p-5 sm:p-6">
        {/* кнопка + статус */}
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
          <PowerButton
            status={state}
            disabled={!selectedServer}
            onToggle={handleToggle}
            label={connected ? t.status.disconnectBtn : t.status.connectBtn}
          />

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="flex items-center justify-center gap-2.5 sm:justify-start">
              {connected ? (
                <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              ) : (
                <ShieldAlert
                  className={cn(
                    'h-5 w-5 shrink-0',
                    connecting || errored ? 'animate-pulse text-primary/70' : 'text-muted-foreground'
                  )}
                  aria-hidden
                />
              )}
              <AnimatePresence mode="wait">
                <motion.span
                  key={state}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className={cn(
                    'font-mono text-sm font-semibold uppercase tracking-[0.18em]',
                    connected
                      ? 'text-glow text-primary'
                      : connecting
                        ? 'text-primary/80'
                        : errored
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                  )}
                >
                  {connected
                    ? t.status.protected
                    : connecting
                      ? t.status.connecting
                      : errored
                        ? t.status.errorState
                        : t.status.unprotected}
                </motion.span>
              </AnimatePresence>
            </div>

            {/* через какой сервер */}
            <p className="mt-1.5 flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
              {selectedServer && <CountryBadge country={selectedServer.country} className="h-4 w-6 rounded-[3px]" />}
              <span className="truncate">
                {selectedServer ? (
                  <>
                    {t.status.via}{' '}
                    <span className="text-foreground">{stripFlagEmojis(selectedServer.name) || selectedServer.name}</span>
                    {' · '}
                    <span className="text-primary/90">{selectedServer.protocol}</span>
                    {' · '}
                    {transportLabel}
                  </>
                ) : (
                  t.status.noServer
                )}
              </span>
            </p>

            {/* ошибка ядра */}
            {errored && status?.error && (
              <p className="mt-1 truncate font-mono text-xs text-destructive/90" role="alert">
                {status.error}
              </p>
            )}

            {/* фазы подключения */}
            <div className="mt-2.5 min-h-[44px]">
              {connecting && (
                <ol className="space-y-1.5 text-left" aria-live="polite">
                  {phases.map((p, i) => (
                    <li
                      key={p}
                      className={cn(
                        'flex items-center gap-2 font-mono text-xs transition-colors',
                        i < connectPhase
                          ? 'text-primary'
                          : i === connectPhase
                            ? 'text-foreground'
                            : 'text-muted-foreground/50'
                      )}
                    >
                      {i < connectPhase ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      ) : i === connectPhase ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-current" aria-hidden />
                      )}
                      {p}
                    </li>
                  ))}
                </ol>
              )}
              {connected && (
                <p className="font-mono text-xs text-primary/90">
                  {t.status.phaseReady} · {t.status.encrypted}
                </p>
              )}
              {!connected && !connecting && !errored && (
                <p className="font-mono text-xs text-muted-foreground">{t.status.notEncrypted}</p>
              )}
            </div>
          </div>
        </div>

        {/* статистика: 4 колонки только когда карточка реально широкая */}
        <div className="grid grid-cols-2 gap-3 @min-[560px]:grid-cols-4">
          <StatTile
            icon={<ArrowDown className="h-3.5 w-3.5" aria-hidden />}
            label={t.status.download}
            value={connected ? formatSpeed(bytesToMbps(status?.speedDown ?? 0)) : '0'}
            unit={t.common.mbps}
            active={connected}
          />
          <StatTile
            icon={<ArrowUp className="h-3.5 w-3.5" aria-hidden />}
            label={t.status.upload}
            value={connected ? formatSpeed(bytesToMbps(status?.speedUp ?? 0)) : '0'}
            unit={t.common.mbps}
            active={connected}
            accent
          />
          <StatTile
            icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
            label={t.status.session}
            value={connected ? formatSessionDuration(sessionMs) : '00:00'}
            mono
          />
          <StatTile
            icon={<Globe2 className="h-3.5 w-3.5" aria-hidden />}
            label={t.status.traffic}
            value={
              connected
                ? `${formatBytes(status?.totalDown ?? 0, lang)} / ${formatBytes(status?.totalUp ?? 0, lang)}`
                : '—'
            }
            small
          />
        </div>

        {/* скорость в реальном времени */}
        <SpeedChart
          history={history}
          live={connected}
          down={status?.speedDown ?? 0}
          up={status?.speedUp ?? 0}
        />

        {/* журнал ядра */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-background/60">
          {/* шапка журнала: при узкой карточке кнопки переносятся
              на вторую строку (справа), а не обрезаются */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border/60 px-4 py-2">
            <span className="min-w-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {t.status.log}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <span className="mr-1 hidden items-center gap-1.5 font-mono text-[10px] text-muted-foreground sm:flex">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connected ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'
                  )}
                  aria-hidden
                />
                {connected ? t.status.coreRunning : t.status.coreStopped} · xray {snap?.coreVersion ?? '…'}
              </span>
              <StatusViewConfigButton />
              <button
                type="button"
                onClick={() => void clearLogs()}
                aria-label={t.status.clearLog}
                title={t.status.clearLog}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Eraser className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          <CoreLog log={logs} emptyText={t.status.logEmpty} />
        </div>
      </div>

      {/* ---------- список подписок и серверов ---------- */}
      <ConnectionsPanel />
    </div>
  )
}

/** Журнал ядра с автопрокруткой вниз */
function CoreLog({ log, emptyText }: { log: LogEntry[]; emptyText: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])

  return (
    <div
      ref={ref}
      className="max-h-44 overflow-y-auto px-4 py-2.5 font-mono text-[11px] leading-relaxed"
      aria-live="polite"
    >
      {log.length === 0 ? (
        <p className="text-muted-foreground/70">$ {emptyText}</p>
      ) : (
        <div className="space-y-0.5">
          {log.map((e, i) => (
            <p key={`${e.t}-${i}`} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60">
                [{formatLogTime(e.t)}]
              </span>
              <span className="shrink-0 text-muted-foreground/50">[{e.source}]</span>
              <span
                className={cn(
                  'min-w-0 break-all',
                  e.level === 'error'
                    ? 'text-red-400'
                    : e.level === 'warn'
                      ? 'text-amber-400'
                      : 'text-foreground/80'
                )}
              >
                {e.message}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function formatLogTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Кнопка «показать конфиг Xray» в шапке журнала */
function StatusViewConfigButton(): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.config.title}
        title={t.config.title}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <FileJson className="h-3.5 w-3.5" aria-hidden />
      </button>
      <ConfigDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function StatTile({
  icon,
  label,
  value,
  unit,
  active,
  accent,
  mono,
  small
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  active?: boolean
  accent?: boolean
  mono?: boolean
  small?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/70 bg-background/50 p-3 transition-colors',
        active && 'border-primary/30'
      )}
    >
      <div className="flex items-start gap-1.5 text-muted-foreground">
        <span className={cn('mt-0.5 shrink-0', accent ? 'text-chart-2' : 'text-primary')}>{icon}</span>
        <span className="font-mono text-[10px] uppercase leading-tight tracking-wider break-words">{label}</span>
      </div>
      <p
        className={cn(
          'mt-1.5 font-semibold tabular-nums',
          small ? 'text-sm' : 'text-xl',
          mono && 'font-mono',
          active ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {value}
        {unit && active && (
          <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground">{unit}</span>
        )}
      </p>
    </div>
  )
}
