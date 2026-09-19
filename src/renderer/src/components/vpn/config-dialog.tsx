// ============================================================
// M3tr0VPN — диалог «Конфигурация ядра»
// Десктоп: реальные config.json из main (showConfig): один для
// активного ядра или два (Xray + sing-box TUN) — с табами.
// Экспорт в файл (exportConfig).
// ============================================================

import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, Download, FileJson, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@renderer/lib/i18n-context'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import type { CoreConfigEntry } from '@shared/ipc-api'

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)/g

function highlightJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of json.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) nodes.push(json.slice(last, idx))
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        nodes.push(
          <span key={key++} className="text-primary">
            {m[1]}
          </span>,
          <span key={key++} className="text-muted-foreground">
            {m[2]}
          </span>
        )
      } else {
        nodes.push(
          <span key={key++} className="text-cyan-300">
            {m[1]}
          </span>
        )
      }
    } else if (m[3] !== undefined) {
      nodes.push(
        <span key={key++} className="text-amber-300">
          {m[3]}
        </span>
      )
    } else {
      nodes.push(
        <span key={key++} className="text-red-400">
          {m[4]}
        </span>
      )
    }
    last = idx + m[0].length
  }
  if (last < json.length) nodes.push(json.slice(last))
  return nodes
}

interface ConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConfigDialog({ open, onOpenChange }: ConfigDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [configs, setConfigs] = useState<CoreConfigEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Загружаем конфиг при каждом открытии — настройки могли измениться
  useEffect(() => {
    if (!open) return
    setConfigs(null)
    setError(null)
    setLoading(true)
    void window.m3tr0
      .showConfig()
      .then((res) => {
        if (res.ok && res.data?.configs) setConfigs(res.data.configs)
        else setError(res.error ?? 'unknown error')
      })
      .finally(() => setLoading(false))
  }, [open])

  const active = configs?.[0] ?? null
  const configText = configs ? JSON.stringify(configs[0].config, null, 2) : null

  const handleCopy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // ignore
    }
  }

  const handleExport = async (): Promise<void> => {
    const res = await window.m3tr0.exportConfig()
    if (res.ok) {
      toast.success(t.config.exported, { description: res.data })
    } else if (res.error && res.error !== 'cancelled') {
      toast.error(res.error)
    }
  }

  const inboundsCount = Array.isArray(active?.config.inbounds)
    ? (active.config.inbounds as unknown[]).length
    : 0
  const outboundsCount = Array.isArray(active?.config.outbounds)
    ? (active.config.outbounds as unknown[]).length
    : 0
  const rules =
    ((active?.config as { routing?: { rules?: unknown[] } })?.routing?.rules) ??
    ((active?.config as { route?: { rules?: unknown[] } })?.route?.rules)

  const noServer = error?.toLowerCase().includes('server')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono">
            <FileJson className="h-4 w-4 text-primary" aria-hidden />
            {t.config.title}
          </DialogTitle>
          <DialogDescription>{t.config.subtitle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded border border-border bg-background/60 px-2 py-1 font-mono">
            {t.config.inbounds}: {inboundsCount || '—'}
          </span>
          <span className="rounded border border-border bg-background/60 px-2 py-1 font-mono">
            {t.config.outbounds}: {outboundsCount || '—'}
          </span>
          <span className="rounded border border-border bg-background/60 px-2 py-1 font-mono">
            {t.config.routing}: {Array.isArray(rules) ? rules.length : '—'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-background/70">
          {error ? (
            <div className="flex h-[40vh] items-center justify-center p-4">
              <p className="font-mono text-xs text-destructive">
                {noServer ? t.config.noServer : `${t.common.error}: ${error}`}
              </p>
            </div>
          ) : configs ? (
            configs.length === 1 ? (
              <ScrollArea className="h-[46vh]">
                <pre className="p-4 font-mono text-[11px] leading-relaxed">
                  <code>{highlightJson(JSON.stringify(configs[0].config, null, 2))}</code>
                </pre>
              </ScrollArea>
            ) : (
              <Tabs defaultValue={configs[0].name}>
                <div className="border-b border-border/60 px-3 pt-2">
                  <TabsList className="h-8 bg-muted/50">
                    {configs.map((c) => (
                      <TabsTrigger key={c.name} value={c.name} className="font-mono text-[10px]">
                        {c.name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {configs.map((c) => (
                  <TabsContent key={c.name} value={c.name}>
                    <ScrollArea className="h-[42vh]">
                      <pre className="p-4 font-mono text-[11px] leading-relaxed">
                        <code>{highlightJson(JSON.stringify(c.config, null, 2))}</code>
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                ))}
              </Tabs>
            )
          ) : (
            <div className="flex h-[46vh] items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              xray-config --build…
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 max-w-sm text-[11px] leading-snug text-muted-foreground">{t.config.note}</p>
          {/* при переносе кнопки уходят на вторую строку и выравниваются
              вправо (ml-auto), а не сжимаются */}
          <div className="ml-auto flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={!configText}
              className="font-mono"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t.config.download}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleCopy(configText ?? '')}
              disabled={!configText}
              className="font-mono"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? t.common.copied : t.config.copy}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
