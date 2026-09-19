// ============================================================
// M3tr0VPN — окно приложения (НАСТОЯЩЕЕ Electron-окно)
// Титлбар — drag-регион с реальными кнопками окна, сайдбар,
// вьюхи. Никакой симуляции рабочего стола/трея — сворачивание
// и трей обрабатывает main-процесс.
// ============================================================

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Copy,
  Gauge,
  Minus,
  Settings2,
  SplitSquareHorizontal,
  Square,
  Wifi,
  WifiOff,
  X
} from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import type { Language } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { SettingsView } from './settings-view'
import { SplitView } from './split-view'
import { StatusView } from './status-view'
import { Logo } from './logo'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

type ViewKey = 'status' | 'tunneling' | 'settings'

export function AppWindow(): React.JSX.Element {
  const { t, lang, setLang } = useI18n()
  const { snap, state, selectedServer } = useAppState()
  const [view, setView] = useState<ViewKey>('status')
  const [maximized, setMaximized] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)

  // Реальное состояние окна
  useEffect(() => {
    void window.m3tr0.isMaximized().then(setMaximized)
    return window.m3tr0.onMaximizedChange(setMaximized)
  }, [])

  const changeLang = (l: Language): void => {
    if (l === lang) return
    setLang(l)
  }

  const handleClose = (): void => {
    // Подключены (или подключаемся) — даём выбор: трей или полный выход
    if (state === 'connected' || state === 'connecting') setExitOpen(true)
    else window.m3tr0.windowClose()
  }

  const nav: { key: ViewKey; label: string; icon: typeof Gauge }[] = [
    { key: 'status', label: t.nav.status, icon: Gauge },
    { key: 'tunneling', label: t.nav.tunneling, icon: SplitSquareHorizontal },
    { key: 'settings', label: t.nav.settings, icon: Settings2 }
  ]

  const connected = state === 'connected'
  const connecting = state === 'connecting'

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* ---------- титлбар (drag-регион) ---------- */}
      <div
        className="flex h-11 shrink-0 select-none items-center gap-2.5 border-b border-border/70 bg-background/60 pl-3 pr-1.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        onDoubleClick={() => window.m3tr0.windowMaximize()}
      >
        <Logo className="h-5 w-5 shrink-0" />
        <p className="min-w-0 truncate font-mono text-xs font-semibold">
          M3tr0<span className="text-primary">VPN</span>
          <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">
            — {selectedServer ? selectedServer.name : t.status.noServer}
          </span>
        </p>

        {/* интерактивная зона справа — не мешает перетаскиванию */}
        <div
          className="ml-auto flex shrink-0 items-center gap-2.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors',
              connected
                ? 'border-primary/40 bg-primary/10 text-primary'
                : connecting
                  ? 'animate-pulse border-primary/30 bg-primary/5 text-primary/70'
                  : state === 'error'
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-border bg-muted/50 text-muted-foreground'
            )}
            role="status"
          >
            {connected ? <Wifi className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
            <span className="hidden sm:inline">
              {connected
                ? t.status.protected
                : connecting
                  ? t.status.connecting
                  : state === 'error'
                    ? t.status.errorState
                    : t.status.unprotected}
            </span>
          </span>

          {/* RU | EN */}
          <div
            className="flex overflow-hidden rounded-md border border-border font-mono text-[10px]"
            role="group"
            aria-label={t.settings.language}
          >
            {(['ru', 'en'] as Language[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => changeLang(l)}
                aria-pressed={lang === l}
                className={cn(
                  'min-h-[26px] px-2 uppercase transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                  lang === l
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {/* кнопки окна */}
          <div className="flex items-stretch">
            <TitleBarButton label={t.window.minimize} onClick={() => window.m3tr0.windowMinimize()}>
              <Minus className="h-4 w-4" aria-hidden />
            </TitleBarButton>
            <TitleBarButton
              label={maximized ? t.window.restoreDown : t.window.maximize}
              onClick={() => window.m3tr0.windowMaximize()}
            >
              {maximized ? (
                <Copy className="h-3 w-3 -scale-x-100" aria-hidden />
              ) : (
                <Square className="h-3 w-3" aria-hidden />
              )}
            </TitleBarButton>
            <TitleBarButton label={t.window.close} onClick={handleClose} danger>
              <X className="h-4 w-4" aria-hidden />
            </TitleBarButton>
          </div>
        </div>
      </div>

      {/* ---------- тело окна ---------- */}
      <div className="flex min-h-0 flex-1">
        {/* сайдбар (десктоп) */}
        <nav
          aria-label={t.nav.status}
          className="hidden w-52 shrink-0 flex-col border-r border-border/70 bg-background/40 p-3 md:flex"
        >
          <div className="mb-4 px-2 pt-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">~/m3tr0</p>
          </div>
          <ul className="flex-1 space-y-1">
            {nav.map((item) => {
              const Icon = item.icon
              const active = view === item.key
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => setView(item.key)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                    {item.label}
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>

          {/* индикатор ядра */}
          <div className="rounded-lg border border-border/60 bg-background/60 p-3">
            <p className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  connected ? 'animate-pulse bg-primary' : 'bg-muted-foreground/50'
                )}
                aria-hidden
              />
              {snap?.coreVersion ?? '…'} · {snap?.singboxVersion ?? '…'}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
              {connected ? t.status.coreRunning : t.status.coreStopped}
            </p>
          </div>
        </nav>

        {/* контент */}
        <div className="relative min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 md:pb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="min-h-full"
            >
              {view === 'status' && <StatusView />}
              {view === 'tunneling' && <SplitView />}
              {view === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ---------- нижняя навигация (узкое окно) ---------- */}
      <nav
        aria-label={t.nav.status}
        className="flex shrink-0 border-t border-border/70 bg-background/95 backdrop-blur-sm md:hidden"
      >
        {nav.map((item) => {
          const Icon = item.icon
          const active = view === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-1 transition-colors',
                'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="font-mono text-[10px]">{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* ---------- подтверждение закрытия ---------- */}
      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono">{t.window.exitTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.window.exitText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                setExitOpen(false)
                window.m3tr0.windowClose()
              }}
              className="bg-secondary font-mono text-xs text-secondary-foreground hover:bg-secondary/80"
            >
              {t.window.trayBtn}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                setExitOpen(false)
                void window.m3tr0.quitApp()
              }}
              className="bg-destructive font-mono text-xs text-white hover:bg-destructive/90"
            >
              {t.window.quitBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TitleBarButton({
  label,
  onClick,
  danger,
  children
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors',
        'focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
        danger ? 'hover:bg-red-500/90 hover:text-white' : 'hover:bg-muted/70 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
