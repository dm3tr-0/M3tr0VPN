// ============================================================
// M3tr0VPN — экран «Туннелирование»
// По умолчанию весь трафик идёт через VPN. Два списка:
// «Выбранное» (сайты через VPN, updateSettings) и
// «Исключения по приложениям» (addApp/updateApp/deleteApp).
// ============================================================

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AppWindow as AppWindowIcon,
  Check,
  Globe2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import { isValidDomain, normalizeDomain } from '@shared/routing'
import type { AppRule } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { APP_CATALOG, AppIcon } from './app-icons'
import { RouteChecker } from './route-checker'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Switch } from '@renderer/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'

export function SplitView(): React.JSX.Element {
  const { t } = useI18n()
  const { snap, updateSettings } = useAppState()

  const [siteInput, setSiteInput] = useState('')
  const [savingDomains, setSavingDomains] = useState(false)
  const [appDialogOpen, setAppDialogOpen] = useState(false)

  const domains = snap?.settings.selectedDomains ?? []
  const apps = snap?.appRules
  const loading = !snap

  const addDomain = (): void => {
    const d = normalizeDomain(siteInput)
    if (!d || !isValidDomain(d)) {
      toast.error(t.tunneling.domainInvalid)
      return
    }
    if (domains.includes(d)) {
      toast(t.tunneling.domainExists)
      return
    }
    setSavingDomains(true)
    void updateSettings({ selectedDomains: [...domains, d] }).finally(() => setSavingDomains(false))
    toast.success(t.tunneling.domainAdded, { description: d })
    setSiteInput('')
  }

  const removeDomain = (d: string): void => {
    void updateSettings({ selectedDomains: domains.filter((x) => x !== d) })
  }

  return (
    <div className="space-y-5">
      {/* баннер: как работает по умолчанию */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="font-semibold">{t.tunneling.bannerTitle}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t.tunneling.bannerHint}</p>
        </div>
      </div>

      {/* ---------- Выбранное ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <header className="flex flex-wrap items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Globe2 className="h-4.5 w-4.5" aria-hidden />
          </span>
          <h3 className="text-base font-semibold">{t.tunneling.selectedTitle}</h3>
          <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
            {t.tunneling.selectedBadge}
          </span>
        </header>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{t.tunneling.selectedHint}</p>

        {/* список доменов */}
        {loading ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-40" />
          </div>
        ) : domains.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border/80 bg-background/40 px-4 py-3 text-center font-mono text-xs text-muted-foreground">
            {t.tunneling.selectedEmpty}
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label={t.tunneling.selectedTitle}>
            {domains.map((d) => (
              <li
                key={d}
                className="group flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 py-1.5 pr-1.5 pl-2.5"
              >
                <Globe2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 truncate font-mono text-xs text-foreground">{d}</span>
                <button
                  type="button"
                  onClick={() => removeDomain(d)}
                  aria-label={`${t.common.remove}: ${d}`}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* добавление домена */}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addDomain()
          }}
        >
          <Input
            value={siteInput}
            onChange={(e) => setSiteInput(e.target.value)}
            placeholder={t.tunneling.sitePlaceholder}
            aria-label={t.tunneling.addSite}
            className="font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!siteInput.trim() || savingDomains}
            className="shrink-0 font-mono text-xs"
          >
            {savingDomains ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            <span className="hidden sm:inline">{t.tunneling.addSite}</span>
            <span className="sr-only sm:hidden">{t.tunneling.addSite}</span>
          </Button>
        </form>
      </section>

      {/* ---------- Исключения по приложениям ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <header className="flex flex-wrap items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
            <AppWindowIcon className="h-4.5 w-4.5" aria-hidden />
          </span>
          <h3 className="text-base font-semibold">{t.tunneling.appsTitle}</h3>
          <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            {t.tunneling.appsBadge}
          </span>
        </header>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{t.tunneling.appsHint}</p>

        {loading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !apps || apps.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border/80 bg-background/40 px-4 py-3 text-center font-mono text-xs text-muted-foreground">
            {t.tunneling.appsEmpty}
          </p>
        ) : (
          <ul className="mt-4 space-y-2" aria-label={t.tunneling.appsTitle}>
            {apps.map((app) => (
              <AppRuleRow key={app.id} app={app} />
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAppDialogOpen(true)}
          className="mt-4 font-mono text-xs"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t.tunneling.addApp}
        </Button>
      </section>

      {/* ---------- Проверка маршрута ---------- */}
      <RouteChecker />

      {/* диалог добавления приложения */}
      <AddAppDialog open={appDialogOpen} onOpenChange={setAppDialogOpen} apps={apps ?? []} />
    </div>
  )
}

/* ---------- строка приложения-исключения ---------- */

function AppRuleRow({ app }: { app: AppRule }): React.JSX.Element {
  const { t } = useI18n()

  const toggle = (checked: boolean): void => {
    void window.m3tr0.updateApp(app.id, { enabled: checked }).then((res) => {
      if (!res.ok) toast.error(res.error ?? t.common.error)
    })
  }

  const remove = (): void => {
    void window.m3tr0.deleteApp(app.id).then((res) => {
      if (!res.ok) toast.error(res.error ?? t.common.error)
    })
  }

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 transition-opacity',
        !app.enabled && 'opacity-55'
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <AppIcon icon={app.icon} className="h-4.5 w-4.5" />
      </span>
      <span className="min-w-[140px] flex-1 basis-40">
        <span className="block truncate text-sm font-medium">{app.appName}</span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">{app.appId}</span>
      </span>
      <Switch
        checked={app.enabled}
        onCheckedChange={toggle}
        aria-label={`${t.tunneling.appsTitle}: ${app.appName}`}
      />
      <button
        type="button"
        onClick={remove}
        aria-label={`${t.common.delete}: ${app.appName}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  )
}

/* ---------- диалог добавления приложения ---------- */

function AddAppDialog({
  open,
  onOpenChange,
  apps
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  apps: AppRule[]
}): React.JSX.Element {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState({ appId: '', appName: '' })

  const existing = useMemo(() => new Set(apps.map((a) => a.appId.toLowerCase())), [apps])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return APP_CATALOG
    return APP_CATALOG.filter(
      (a) => a.appName.toLowerCase().includes(q) || a.appId.toLowerCase().includes(q)
    )
  }, [query])

  const handleAdd = (appId: string, appName: string, icon?: string): void => {
    if (existing.has(appId.toLowerCase())) {
      toast(t.tunneling.appExists)
      return
    }
    setAdding(true)
    void window.m3tr0
      .addApp({ appId, appName, icon: icon ?? 'app-window' })
      .then((res) => {
        if (res.ok) {
          toast.success(t.tunneling.appAdded, { description: appName })
          setManual({ appId: '', appName: '' })
        } else {
          toast.error(res.error ?? t.common.error)
        }
      })
      .finally(() => setAdding(false))
  }

  const close = (): void => {
    onOpenChange(false)
    setQuery('')
    setManual({ appId: '', appName: '' })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">{t.tunneling.addApp}</DialogTitle>
          <DialogDescription>{t.tunneling.appsHint}</DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.tunneling.catalogSearch}
          aria-label={t.common.search}
          className="font-mono text-xs"
        />

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-background/40">
          <ScrollArea className="h-64 sm:h-72">
            <div className="grid grid-cols-2 gap-1.5 p-2">
              {filtered.map((app) => {
                const added = existing.has(app.appId.toLowerCase())
                return (
                  <button
                    key={app.appId}
                    type="button"
                    disabled={added || adding}
                    onClick={() => handleAdd(app.appId, app.appName, app.icon)}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors',
                      'hover:border-primary/30 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      added &&
                        'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent'
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <AppIcon icon={app.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{app.appName}</span>
                      <span className="block truncate font-mono text-[9px] text-muted-foreground">
                        {app.appId}
                      </span>
                    </span>
                    {added && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />}
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <p className="col-span-2 py-6 text-center font-mono text-xs text-muted-foreground">
                  {t.common.empty}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* свой процесс */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {t.tunneling.manualApp}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Label htmlFor="manual-appid" className="sr-only">
                {t.tunneling.processName}
              </Label>
              <Input
                id="manual-appid"
                value={manual.appId}
                onChange={(e) => setManual((m) => ({ ...m, appId: e.target.value }))}
                placeholder={t.tunneling.processPlaceholder}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Label htmlFor="manual-appname" className="sr-only">
                {t.tunneling.appName}
              </Label>
              <Input
                id="manual-appname"
                value={manual.appName}
                onChange={(e) => setManual((m) => ({ ...m, appName: e.target.value }))}
                placeholder={t.tunneling.appName}
                className="text-xs"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!manual.appId.trim() || !manual.appName.trim() || adding}
              onClick={() => handleAdd(manual.appId.trim(), manual.appName.trim(), 'app-window')}
              className="shrink-0 font-mono text-xs"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              {t.common.add}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
