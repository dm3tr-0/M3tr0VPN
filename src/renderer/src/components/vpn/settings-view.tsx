// ============================================================
// M3tr0VPN — экран «Настройки»
// Подключение, режим работы (Системный прокси | TUN-адаптер
// с проверкой прав администратора), ядро, DNS, язык, конфиг,
// папка логов, «О приложении».
// ============================================================

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Cpu,
  FileJson,
  FolderOpen,
  Globe,
  Languages,
  Link2,
  Lock,
  Network,
  Settings2,
  ShieldCheck,
  Zap
} from 'lucide-react'
import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import type { CoreKind, DnsProvider, Language, Protocol, TransportMode } from '@shared/types'
import { OVERRIDABLE_PROTOCOLS, SINGBOX_PROTOCOLS, coreForProtocol } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { ConfigDialog } from './config-dialog'
import { Button } from '@renderer/components/ui/button'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
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

export function SettingsView(): React.JSX.Element {
  const { t, lang, setLang } = useI18n()
  const { snap, updateSettings } = useAppState()
  const [configOpen, setConfigOpen] = useState(false)
  const [tunConfirmOpen, setTunConfirmOpen] = useState(false)

  if (!snap) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  const settings = snap.settings

  const patch = (p: Parameters<typeof updateSettings>[0], successToast?: string): void => {
    void updateSettings(p).then((res) => {
      if (res.ok && successToast) toast.success(successToast)
    })
  }

  const changeLang = (l: Language): void => {
    if (l === lang) return
    setLang(l)
  }

  /** Выбор режима работы: TUN без прав — через диалог с relaunchElevated */
  const chooseMode = (mode: TransportMode): void => {
    if (mode === settings.transportMode) return
    if (mode === 'tun' && !snap.isElevated) {
      setTunConfirmOpen(true)
      return
    }
    patch({ transportMode: mode }, t.settings.saved)
  }

  const confirmTun = (): void => {
    setTunConfirmOpen(false)
    // Сохраняем режим, затем перезапускаемся с правами администратора
    void updateSettings({ transportMode: 'tun' }).then(() => {
      void window.m3tr0.relaunchElevated().then((res) => {
        if (!res.ok) toast.error(res.error ?? t.common.error)
      })
    })
  }

  const openLogsFolder = (): void => {
    void window.m3tr0.openLogsFolder().then((res) => {
      if (!res.ok) toast.error(res.error ?? t.common.error)
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* ---------- Подключение ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <SectionTitle icon={<Link2 className="h-4 w-4" aria-hidden />}>{t.settings.connection}</SectionTitle>
        <div className="mt-1 divide-y divide-border/40">
          <SettingRow title={t.settings.autoConnect} hint={t.settings.autoConnectHint}>
            <Switch
              checked={settings.autoConnect}
              onCheckedChange={(v) => patch({ autoConnect: v })}
              aria-label={t.settings.autoConnect}
            />
          </SettingRow>
          <SettingRow title={t.settings.autostart} hint={t.settings.autostartHint}>
            <Switch
              checked={settings.launchAtStartup}
              onCheckedChange={(v) => patch({ launchAtStartup: v })}
              aria-label={t.settings.autostart}
            />
          </SettingRow>
          <SettingRow title={t.settings.autoUpdateSubs} hint={t.settings.autoUpdateSubsHint}>
            <Switch
              checked={settings.autoUpdateSubs}
              onCheckedChange={(v) => patch({ autoUpdateSubs: v })}
              aria-label={t.settings.autoUpdateSubs}
            />
          </SettingRow>
        </div>
      </section>

      {/* ---------- Режим работы ---------- */}
      <section className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle icon={<Zap className="h-4 w-4" aria-hidden />}>{t.settings.modeTitle}</SectionTitle>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider',
              snap.isElevated
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border bg-muted/50 text-muted-foreground'
            )}
          >
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {t.settings.rightsLabel}: {snap.isElevated ? t.settings.rightsAdmin : t.settings.rightsUser}
          </span>
        </div>

        <div
          className="mt-3 space-y-2"
          role="radiogroup"
          aria-label={t.settings.modeTitle}
        >
          {/* Системный прокси */}
          <ModeCard
            active={settings.transportMode === 'proxy'}
            onSelect={() => chooseMode('proxy')}
            icon={<Network className="h-5 w-5" aria-hidden />}
            name={t.settings.proxyName}
            badge={t.settings.proxyBadge}
            badgeClass="border-primary/40 bg-primary/10 text-primary"
            hint={t.settings.proxyHint}
          />
          {/* TUN-адаптер */}
          <ModeCard
            active={settings.transportMode === 'tun'}
            onSelect={() => chooseMode('tun')}
            icon={<Cpu className="h-5 w-5" aria-hidden />}
            name={t.settings.tunName}
            badge={t.settings.tunBadge}
            badgeClass="border-amber-400/30 bg-amber-400/10 text-amber-300"
            hint={t.settings.tunHint}
          />
        </div>
      </section>

      {/* ---------- Ядро и протоколы ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <SectionTitle icon={<Settings2 className="h-4 w-4" aria-hidden />}>{t.settings.core}</SectionTitle>
        <div className="mt-1 divide-y divide-border/40">
          <SettingRow title={t.settings.coreVersion} hint={t.settings.coreHint}>
            <span className="rounded border border-border bg-muted/50 px-2 py-1 font-mono text-xs text-primary">
              Xray-core {snap.coreVersion}
            </span>
          </SettingRow>
          {/* Ядро для протокола — как Core type settings в v2rayN */}
          <div className="py-3.5">
            <SettingRow title={t.settings.corePerProtocol} hint={t.settings.corePerProtocolHint}>
              <span />
            </SettingRow>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {OVERRIDABLE_PROTOCOLS.map((proto) => (
                <div
                  key={proto}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                >
                  <span className="min-w-0 truncate font-mono text-xs font-semibold">{proto}</span>
                  <Select
                    value={coreForProtocol(proto, settings.coreOverrides)}
                    onValueChange={(v) =>
                      patch(
                        {
                          coreOverrides: {
                            ...(settings.coreOverrides ?? {}),
                            [proto]: v as CoreKind
                          }
                        },
                        t.settings.coreChanged
                      )
                    }
                  >
                    <SelectTrigger
                      className="ml-auto h-8 w-32 shrink-0 font-mono text-xs"
                      aria-label={`${t.settings.corePerProtocol}: ${proto}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="xray" className="font-mono text-xs">
                        {t.settings.coreXray}
                      </SelectItem>
                      <SelectItem value="singbox" className="font-mono text-xs">
                        {t.settings.coreSingbox}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {SINGBOX_PROTOCOLS.map((proto: Protocol) => (
                <div
                  key={proto}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-border/40 bg-background/20 px-3 py-2 opacity-80"
                  title={t.settings.coreLockedHint}
                >
                  <span className="min-w-0 truncate font-mono text-xs font-semibold">{proto}</span>
                  <span
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                    title={t.settings.coreLockedHint}
                  >
                    <Lock className="h-3 w-3" aria-hidden />
                    {t.settings.coreSingbox}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <SettingRow title={t.settings.mux} hint={t.settings.muxHint}>
            <Switch
              checked={settings.mux}
              onCheckedChange={(v) => patch({ mux: v })}
              aria-label={t.settings.mux}
            />
          </SettingRow>
          <SettingRow title={t.settings.ipv6} hint={t.settings.ipv6Hint}>
            <Switch
              checked={settings.ipv6}
              onCheckedChange={(v) => patch({ ipv6: v })}
              aria-label={t.settings.ipv6}
            />
          </SettingRow>
          <SettingRow title={t.settings.dns} hint={t.settings.dnsHint}>
            <Select value={settings.dns} onValueChange={(v) => patch({ dns: v as DnsProvider })}>
              <SelectTrigger className="w-44 font-mono text-xs" aria-label={t.settings.dns}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="font-mono text-xs">
                  {t.settings.dnsAuto}
                </SelectItem>
                <SelectItem value="cloudflare" className="font-mono text-xs">
                  {t.settings.dnsCloudflare}
                </SelectItem>
                <SelectItem value="google" className="font-mono text-xs">
                  {t.settings.dnsGoogle}
                </SelectItem>
                <SelectItem value="quad9" className="font-mono text-xs">
                  {t.settings.dnsQuad9}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      </section>

      {/* ---------- Интерфейс ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <SectionTitle icon={<Languages className="h-4 w-4" aria-hidden />}>{t.settings.interface}</SectionTitle>
        <SettingRow title={t.settings.language} hint={t.settings.languageHint} className="mt-1">
          <div
            className="flex overflow-hidden rounded-md border border-border font-mono text-[11px]"
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
                  'min-h-[32px] px-3 uppercase transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none',
                  lang === l
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </SettingRow>
      </section>

      {/* ---------- Конфигурация и логи ---------- */}
      <section className="rounded-xl border border-border/70 bg-card/50 p-4 sm:p-5">
        <SectionTitle icon={<FileJson className="h-4 w-4" aria-hidden />}>{t.settings.openConfig}</SectionTitle>
        <div className="mt-1 divide-y divide-border/40">
          <SettingRow title={t.settings.openConfig} hint={t.settings.openConfigHint}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfigOpen(true)}
              className="font-mono text-xs"
            >
              <FileJson className="h-4 w-4" aria-hidden />
              config.json
            </Button>
          </SettingRow>
          <SettingRow title={t.settings.logsFolder} hint={t.settings.logsFolderHint}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openLogsFolder}
              className="font-mono text-xs"
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              {t.settings.logsFolderBtn}
            </Button>
          </SettingRow>
        </div>
      </section>

      {/* ---------- О приложении ---------- */}
      <p className="flex items-center justify-center gap-1.5 pb-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
        <Globe className="h-3 w-3" aria-hidden />
        M3tr0VPN {snap.appVersion} · {t.settings.basedOn}
      </p>

      <ConfigDialog open={configOpen} onOpenChange={setConfigOpen} />

      {/* подтверждение перезапуска с правами администратора */}
      <AlertDialog open={tunConfirmOpen} onOpenChange={setTunConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono">{t.settings.tunConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.settings.tunConfirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmTun()
              }}
              className="bg-primary font-mono text-xs text-primary-foreground hover:bg-primary/90"
            >
              {t.settings.tunConfirmBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ---------- карточка режима работы (radio) ---------- */

function ModeCard({
  active,
  onSelect,
  icon,
  name,
  badge,
  badgeClass,
  hint
}: {
  active: boolean
  onSelect: () => void
  icon: React.ReactNode
  name: string
  badge: string
  badgeClass: string
  hint: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-all',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active
          ? 'border-primary/50 bg-primary/[0.07] shadow-[0_0_22px_oklch(0.77_0.185_158/10%)]'
          : 'border-border/60 bg-background/50 hover:border-primary/30'
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-primary/15 text-primary' : 'bg-muted/60 text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {name}
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
              badgeClass
            )}
          >
            {badge}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
      {/* радио-индикатор */}
      <span
        aria-hidden
        className={cn(
          'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          active ? 'border-primary' : 'border-muted-foreground/40'
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
    </button>
  )
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
      <span className="text-primary">{icon}</span>
      {children}
    </h3>
  )
}

function SettingRow({
  title,
  hint,
  children,
  className
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5', className)}>
      {/* basis-40 + min-w-[140px]: в узком окне контрол уходит на вторую
          строку (выравнивается вправо через ml-auto), а не сжимает текст */}
      <div className="min-w-[140px] flex-1 basis-40">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="ml-auto shrink-0">{children}</div>
    </div>
  )
}
