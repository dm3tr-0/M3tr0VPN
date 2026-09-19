// ============================================================
// M3tr0VPN — панель «Подключения»
// Все подписки со своими серверами + свои серверы.
// Клик по серверу выбирает его (main сам сделает reconnect
// с сохранением сессии). Пинг — реальный TCP-замер.
// ============================================================

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  Check,
  ChevronDown,
  Globe,
  Headset,
  Loader2,
  MoreVertical,
  Plus,
  Radar,
  RefreshCw,
  Server as ServerIcon,
  SignalZero,
  Trash2
} from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import {
  countryName,
  formatBytes,
  formatUpdatedAgo,
  latencyColor,
  plural,
  stripFlagEmojis
} from '@renderer/lib/format'
import type { ServerProfile, Subscription } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { AddServerDialog } from './add-server-dialog'
import { CountryBadge, LoadBar, ProtocolBadge } from './badges'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

interface ServerGroup {
  key: string
  name: string
  url?: string
  subscriptionId: string | null
  servers: ServerProfile[]
}

export function ConnectionsPanel(): React.JSX.Element {
  const { t, lang } = useI18n()
  const { snap, state } = useAppState()
  const [addOpen, setAddOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [refreshingSubId, setRefreshingSubId] = useState<string | null>(null)
  const [subToDelete, setSubToDelete] = useState<Subscription | null>(null)
  const [serverToDelete, setServerToDelete] = useState<ServerProfile | null>(null)

  const servers = snap?.servers
  const subscriptions = snap?.subscriptions
  const selectedId = snap?.settings.selectedServerId
  const loading = !snap

  const groups = useMemo<ServerGroup[]>(() => {
    if (!servers) return []
    const result: ServerGroup[] = []
    for (const sub of subscriptions ?? []) {
      const subServers = servers.filter((s) => s.subscriptionId === sub.id)
      result.push({
        key: sub.id,
        name: sub.name,
        url: sub.url,
        subscriptionId: sub.id,
        servers: subServers
      })
    }
    const own = servers.filter((s) => !s.subscriptionId)
    if (own.length > 0) {
      result.push({
        key: 'own',
        name: t.connections.ownGroup,
        subscriptionId: null,
        servers: own
      })
    }
    return result
  }, [servers, subscriptions, t.connections.ownGroup])

  const totalServers = servers?.length ?? 0

  const handleSelect = async (server: ServerProfile): Promise<void> => {
    if (!snap || server.id === selectedId) return
    const res = await window.m3tr0.selectServer(server.id)
    if (!res.ok) {
      toast.error(res.error ?? t.common.error)
      return
    }
    // main сам перезапустит ядро с сохранением сессии
    if (state === 'connected') {
      toast(t.status.serverChanged, { description: server.name })
    }
  }

  const handleTest = async (real: boolean): Promise<void> => {
    setTesting(true)
    try {
      const res = real ? await window.m3tr0.testLatencyReal() : await window.m3tr0.testLatency()
      if (res.ok) toast.success(t.connections.pingDone)
      else toast.error(res.error ?? t.common.error)
    } finally {
      setTesting(false)
    }
  }

  const handleRefreshSub = async (sub: Subscription): Promise<void> => {
    setRefreshingSubId(sub.id)
    try {
      const res = await window.m3tr0.refreshSubscription(sub.id)
      if (res.ok) toast.success(t.connections.refreshed, { description: res.data?.name ?? sub.name })
      else toast.error(res.error ?? t.common.error)
    } finally {
      setRefreshingSubId(null)
    }
  }

  const handleOpenLink = (url: string | null | undefined): void => {
    if (url) void window.m3tr0.openExternal(url)
  }

  const confirmDeleteSub = async (): Promise<void> => {
    if (!subToDelete) return
    const res = await window.m3tr0.deleteSubscription(subToDelete.id)
    if (res.ok) {
      toast.success(t.connections.subDeleted, { description: subToDelete.name })
      setSubToDelete(null)
    } else {
      toast.error(res.error ?? t.common.error)
    }
  }

  const confirmDeleteServer = async (): Promise<void> => {
    if (!serverToDelete) return
    const res = await window.m3tr0.deleteServer(serverToDelete.id)
    if (res.ok) {
      toast.success(t.connections.serverDeleted, { description: serverToDelete.name })
      setServerToDelete(null)
    } else {
      toast.error(res.error ?? t.common.error)
    }
  }

  return (
    <section
      aria-label={t.connections.title}
      className="flex max-h-full min-w-0 flex-col gap-4 rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5"
    >
      {/* шапка */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <ServerIcon className="h-3.5 w-3.5 text-primary" aria-hidden />
            {t.connections.title}
            {totalServers > 0 && (
              <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-foreground/80">
                {totalServers} {plural(totalServers, t.connections.serversForms, lang)}
              </span>
            )}
          </h2>
          <p className="mt-1 truncate text-xs text-muted-foreground/80">{t.connections.subtitle}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Основное действие — «Test real delay» из v2rayN: одно ядро
              со всеми серверами, 2 запроса на сервер, минимум — числа
              СОВПАДАЮТ с v2rayN. Быстрый TCP-пинг (RTT до порта) —
              в выпадающем меню. */}
          <div className="flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing || !servers || servers.length === 0}
              onClick={() => void handleTest(true)}
              className="rounded-r-none border-r-0 font-mono text-xs"
              aria-label={t.connections.testReal}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Radar className="h-4 w-4" aria-hidden />
              )}
              <span className="hidden sm:inline">
                {testing ? t.connections.testing : t.connections.testAll}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testing || !servers || servers.length === 0}
                  className="rounded-l-none px-2 font-mono text-xs"
                  aria-label={t.connections.testMode}
                >
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => void handleTest(true)}
                  className="font-mono text-xs"
                >
                  <Activity className="h-3.5 w-3.5" aria-hidden />
                  <span className="flex flex-col">
                    <span>{t.connections.testReal}</span>
                    <span className="text-[10px] text-muted-foreground">{t.connections.testRealHint}</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void handleTest(false)}
                  className="font-mono text-xs"
                >
                  <Radar className="h-3.5 w-3.5" aria-hidden />
                  <span className="flex flex-col">
                    <span>{t.connections.testTcp}</span>
                    <span className="text-[10px] text-muted-foreground">{t.connections.testTcpHint}</span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button type="button" size="sm" onClick={() => setAddOpen(true)} className="font-mono text-xs">
            <Plus className="h-4 w-4" aria-hidden />
            {t.connections.add}
          </Button>
        </div>
      </div>

      {/* список групп */}
      <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1 lg:max-h-[calc(100vh-320px)]">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border/60 p-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/80 p-8 text-center">
            <ServerIcon className="h-8 w-8 text-muted-foreground/50" aria-hidden />
            <p className="text-sm text-muted-foreground">{t.connections.empty}</p>
            <p className="font-mono text-xs text-muted-foreground/70">{t.connections.emptyHint}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAddOpen(true)}
              className="mt-1 font-mono text-xs"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.connections.add}
            </Button>
          </div>
        ) : (
          groups.map((group) => {
            const groupSub = group.subscriptionId
              ? subscriptions?.find((x) => x.id === group.subscriptionId) ?? null
              : null
            const refreshing = !!groupSub && refreshingSubId === groupSub.id
            const traffic = groupSub?.userInfo
            return (
            <div
              key={group.key}
              className="overflow-hidden rounded-lg border border-border/60 bg-background/40"
            >
              {/* заголовок группы: flex-wrap — при узком окне бейдж трафика,
                  счётчик и кнопки действий переносятся на следующие строки,
                  а не обрезаются (карточка группы overflow-hidden) */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/60 bg-background/60 px-3 py-2">
                <span className="min-w-[140px] flex-1 basis-40">
                  <span className="block truncate text-sm font-semibold">{group.name}</span>
                  {group.url && (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                      {group.url}
                      {groupSub && ` · ${t.connections.updatedAt} ${formatUpdatedAgo(groupSub.updatedAt, lang)}`}
                    </span>
                  )}
                </span>
                {traffic && (
                  <span
                    className="hidden shrink-0 rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 sm:inline-block"
                    title={t.connections.trafficTitle}
                  >
                    ↓{formatBytes(traffic.download + traffic.upload, lang)}
                    {traffic.total != null && traffic.total > 0
                      ? ` / ${formatBytes(traffic.total, lang)}`
                      : ''}
                    {traffic.expire && traffic.expire > 0
                      ? ` · ${t.connections.until} ${new Date(traffic.expire * 1000).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US')}`
                      : ''}
                  </span>
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {group.servers.length} {plural(group.servers.length, t.connections.serversForms, lang)}
                </span>
                {groupSub && (
                  <button
                    type="button"
                    aria-label={`${t.connections.website}: ${group.name}`}
                    title={t.connections.openWebsite}
                    onClick={() => handleOpenLink(groupSub?.websiteUrl)}
                    disabled={!groupSub.websiteUrl}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      groupSub.websiteUrl
                        ? 'text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground'
                        : 'cursor-not-allowed text-muted-foreground/25'
                    )}
                  >
                    <Globe className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {groupSub && (
                  <button
                    type="button"
                    aria-label={`${t.connections.support}: ${group.name}`}
                    title={t.connections.openSupport}
                    onClick={() => handleOpenLink(groupSub?.supportUrl)}
                    disabled={!groupSub.supportUrl}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      groupSub.supportUrl
                        ? 'text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground'
                        : 'cursor-not-allowed text-muted-foreground/25'
                    )}
                  >
                    <Headset className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {groupSub && (
                  <button
                    type="button"
                    aria-label={`${t.connections.refresh}: ${group.name}`}
                    title={t.connections.refresh}
                    onClick={() => void handleRefreshSub(groupSub)}
                    disabled={refreshing}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden />
                  </button>
                )}
                {group.subscriptionId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={group.name}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          if (groupSub) void handleRefreshSub(groupSub)
                        }}
                        className="font-mono text-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                        {t.connections.refresh}
                      </DropdownMenuItem>
                      {groupSub?.websiteUrl && (
                        <DropdownMenuItem
                          onClick={() => handleOpenLink(groupSub?.websiteUrl)}
                          className="font-mono text-xs"
                        >
                          <Globe className="h-3.5 w-3.5" aria-hidden />
                          {t.connections.website}
                        </DropdownMenuItem>
                      )}
                      {groupSub?.supportUrl && (
                        <DropdownMenuItem
                          onClick={() => handleOpenLink(groupSub?.supportUrl)}
                          className="font-mono text-xs"
                        >
                          <Headset className="h-3.5 w-3.5" aria-hidden />
                          {t.connections.support}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          setSubToDelete(subscriptions?.find((x) => x.id === group.subscriptionId) ?? null)
                        }
                        className="font-mono text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {t.common.delete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {/* серверы */}
              <ul role="radiogroup" aria-label={group.name} className="divide-y divide-border/40">
                {group.servers.length === 0 && (
                  <li className="px-3 py-3 font-mono text-xs text-muted-foreground/60">{t.common.empty}</li>
                )}
                {group.servers.map((server) => {
                  const selected = server.id === selectedId
                  return (
                    <li key={server.id}>
                      <div
                        role="radio"
                        aria-checked={selected}
                        tabIndex={0}
                        onClick={() => void handleSelect(server)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void handleSelect(server)
                          }
                        }}
                        className={cn(
                          'group relative flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
                          'focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                          selected ? 'bg-primary/[0.07]' : 'hover:bg-muted/40'
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'absolute inset-y-0 left-0 w-0.5 transition-colors',
                            selected ? 'bg-primary' : 'bg-transparent'
                          )}
                        />
                        <CountryBadge country={server.country} />

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium" title={server.name}>
                              {stripFlagEmojis(server.name) || server.name}
                            </span>
                            <ProtocolBadge protocol={server.protocol} />
                            {selected && (
                              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-primary">
                                <Check className="h-2.5 w-2.5" aria-hidden />
                                {t.connections.current}
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate font-mono text-[10px] text-muted-foreground">
                              {server.address}:{server.port} · {countryName(server.country, lang)}
                            </span>
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              className={cn(
                                'font-mono text-[10px] font-semibold',
                                latencyColor(server.latencyMs)
                              )}
                              title={server.latencyError ?? undefined}
                            >
                              {server.latencyMs != null ? (
                                `${server.latencyMs} ${t.common.ms}`
                              ) : server.latencyError ? (
                                <span className="inline-flex items-center gap-1">
                                  <SignalZero className="h-3 w-3" aria-hidden />
                                  {server.latencyError}
                                </span>
                              ) : (
                                t.connections.noPing
                              )}
                            </span>
                            <LoadBar load={server.load} />
                          </span>
                        </span>

                        <button
                          type="button"
                          aria-label={`${t.common.delete}: ${server.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setServerToDelete(server)
                          }}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-all hover:bg-muted/60 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
            )
          })
        )}
      </div>

      {/* диалоги */}
      <AddServerDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!subToDelete} onOpenChange={(o) => !o && setSubToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.connections.deleteSubTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.connections.deleteSubText.replace('{name}', subToDelete?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDeleteSub()
              }}
              className="bg-destructive font-mono text-xs text-white hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!serverToDelete} onOpenChange={(o) => !o && setServerToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.connections.deleteServerTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.connections.deleteServerText.replace('{name}', serverToDelete?.name ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDeleteServer()
              }}
              className="bg-destructive font-mono text-xs text-white hover:bg-destructive/90"
            >
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
