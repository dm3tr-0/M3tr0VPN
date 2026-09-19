// ============================================================
// M3tr0VPN — диалог добавления сервера
// Три способа: ссылка (vless/vmess/trojan/ss + QR из буфера),
// подписка (main скачивает и парсит), вручную (с пресетами
// стримов). Парсер ссылок в main — авторитетный; локальный
// разбор используется только для превью.
// ============================================================

import { useMemo, useState } from 'react'
import { CheckCircle2, Link2, Plus, QrCode, Rss, ScanLine, TerminalSquare, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useI18n } from '@renderer/lib/i18n-context'
import type { Protocol, StreamSettings } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Textarea } from '@renderer/components/ui/textarea'

interface AddServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: 'uri' | 'sub' | 'manual'
}

const TLD_TO_COUNTRY: Record<string, string> = {
  nl: 'NL', de: 'DE', fi: 'FI', se: 'SE', us: 'US', fr: 'FR',
  gb: 'GB', uk: 'GB', tr: 'TR', kz: 'KZ', am: 'AM', sg: 'SG',
  jp: 'JP', ru: 'RU', ch: 'CH', at: 'AT', es: 'ES', it: 'IT',
  pl: 'PL', ca: 'CA'
}

interface ParsedServer {
  name: string
  protocol: Protocol
  address: string
  port: number
  country: string
  uuid: string
}

function b64decode(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4)
  return atob(padded)
}

/** Локальный разбор ссылок vless:// vmess:// trojan:// ss:// — только для превью */
function parseUri(raw: string): ParsedServer | null {
  const input = raw.trim()
  if (!input) return null

  const countryFromHost = (host: string): string => {
    const tld = host.split('.').pop()?.toLowerCase() ?? ''
    return TLD_TO_COUNTRY[tld] ?? 'EU'
  }

  try {
    if (input.startsWith('vless://') || input.startsWith('trojan://')) {
      const isVless = input.startsWith('vless://')
      const url = new URL(input)
      const address = url.hostname
      if (!address) return null
      const port = parseInt(url.port || '443', 10)
      const secret = decodeURIComponent(url.username || '')
      const name =
        decodeURIComponent(url.hash.replace(/^#/, '')) ||
        url.searchParams.get('name') ||
        url.searchParams.get('remark') ||
        (isVless ? 'VLESS ' : 'Trojan ') + address
      return {
        name,
        protocol: isVless ? 'VLESS' : 'Trojan',
        address,
        port,
        country: countryFromHost(address),
        uuid: secret
      }
    }

    if (input.startsWith('vmess://')) {
      const payload = input.slice('vmess://'.length)
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(b64decode(payload))
      } catch {
        json = JSON.parse(decodeURIComponent(escape(b64decode(payload))))
      }
      if (!json || typeof json.add !== 'string') return null
      const address = json.add
      return {
        name: String(json.ps ?? `VMess ${address}`),
        protocol: 'VMess',
        address,
        port: parseInt(String(json.port ?? '443'), 10),
        country: countryFromHost(address),
        uuid: String(json.id ?? '')
      }
    }

    if (input.startsWith('ss://')) {
      let body = input.slice('ss://'.length)
      let name = ''
      const hashIdx = body.indexOf('#')
      if (hashIdx >= 0) {
        name = decodeURIComponent(body.slice(hashIdx + 1))
        body = body.slice(0, hashIdx)
      }
      const atIdx = body.lastIndexOf('@')
      let hostPort = ''
      let secretPart = ''
      if (atIdx >= 0) {
        secretPart = body.slice(0, atIdx)
        hostPort = body.slice(atIdx + 1)
      } else {
        const decoded = b64decode(body)
        const at = decoded.lastIndexOf('@')
        secretPart = decoded.slice(0, at)
        hostPort = decoded.slice(at + 1)
      }
      const [host, port] = hostPort.split(':')
      if (!host || !port) return null
      return {
        name: name || `SS ${host}`,
        protocol: 'Shadowsocks',
        address: host,
        port: parseInt(port, 10),
        country: countryFromHost(host),
        uuid: secretPart.includes(':') ? secretPart.split(':')[1] : secretPart
      }
    }
  } catch {
    return null
  }
  return null
}

/* ---------- пресеты стримов для ручного ввода ---------- */

type PresetKey = 'reality' | 'tcp-tls' | 'ws-tls' | 'grpc-tls' | 'plain'

/** Протоколы, доступные для ручного ввода (остальные — через ссылку/подписку) */
type ManualProtocol = 'VLESS' | 'VMess' | 'Trojan' | 'Shadowsocks'

const PRESETS_BY_PROTOCOL: Record<ManualProtocol, PresetKey[]> = {
  VLESS: ['reality', 'tcp-tls', 'ws-tls', 'grpc-tls', 'plain'],
  VMess: ['tcp-tls', 'ws-tls', 'grpc-tls', 'plain'],
  Trojan: ['tcp-tls', 'ws-tls', 'grpc-tls', 'plain'],
  Shadowsocks: ['plain']
}

const DEFAULT_PRESET: Record<ManualProtocol, PresetKey> = {
  VLESS: 'reality',
  VMess: 'tcp-tls',
  Trojan: 'tcp-tls',
  Shadowsocks: 'plain'
}

const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  'tcp-tls': 'tcpTls',
  'ws-tls': 'wsTls',
  'grpc-tls': 'grpcTls',
  reality: 'reality',
  plain: 'plain'
}

interface StreamFields {
  serverName: string
  publicKey: string
  shortId: string
  path: string
  host: string
  serviceName: string
}

function buildStream(preset: PresetKey, protocol: ManualProtocol, f: StreamFields): StreamSettings {
  const tls = {
    serverName: f.serverName.trim(),
    alpn: ['h2', 'http/1.1'],
    fingerprint: 'chrome'
  }
  switch (preset) {
    case 'reality':
      return {
        network: 'tcp',
        security: 'reality',
        reality: {
          serverName: f.serverName.trim(),
          fingerprint: 'chrome',
          publicKey: f.publicKey.trim(),
          shortId: f.shortId.trim()
        }
      }
    case 'tcp-tls':
      return { network: 'tcp', security: 'tls', tls }
    case 'ws-tls':
      return { network: 'ws', security: 'tls', tls, ws: { path: f.path.trim() || '/', host: f.host.trim() } }
    case 'grpc-tls':
      return { network: 'grpc', security: 'tls', tls, grpc: { serviceName: f.serviceName.trim() } }
    default:
      return { network: 'tcp', security: 'none' }
  }
}

export function AddServerDialog({ open, onOpenChange, defaultTab = 'uri' }: AddServerDialogProps): React.JSX.Element {
  const { t } = useI18n()

  const [tab, setTab] = useState<'uri' | 'sub' | 'manual'>(defaultTab)
  const [uri, setUri] = useState('')
  const [parsed, setParsed] = useState<ParsedServer | null>(null)
  const [parseError, setParseError] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  const [manual, setManual] = useState({
    name: '',
    protocol: 'VLESS' as ManualProtocol,
    address: '',
    port: '443',
    uuid: ''
  })
  const [preset, setPreset] = useState<PresetKey>('reality')
  const [stream, setStream] = useState<StreamFields>({
    serverName: '',
    publicKey: '',
    shortId: '',
    path: '/',
    host: '',
    serviceName: ''
  })

  const [sub, setSub] = useState({ name: '', url: '' })

  const canAddManual = useMemo(
    () => Boolean(manual.name.trim() && manual.address.trim() && parseInt(manual.port, 10) > 0 && manual.uuid.trim()),
    [manual]
  )

  const reset = (): void => {
    setUri('')
    setParsed(null)
    setParseError(false)
    setManual({ name: '', protocol: 'VLESS', address: '', port: '443', uuid: '' })
    setPreset('reality')
    setStream({ serverName: '', publicKey: '', shortId: '', path: '/', host: '', serviceName: '' })
    setSub({ name: '', url: '' })
  }

  const close = (): void => {
    onOpenChange(false)
    reset()
  }

  const runLocalParse = (text: string): void => {
    const result = parseUri(text)
    setParsed(result)
    setParseError(!result)
  }

  const handleParse = (): void => {
    if (uri.trim()) runLocalParse(uri)
  }

  const handleQr = async (): Promise<void> => {
    setQrBusy(true)
    try {
      const res = await window.m3tr0.scanQrClipboard()
      if (res.ok && res.data) {
        setUri(res.data)
        runLocalParse(res.data)
        toast.success(t.add.qrPasted)
      } else if (res.error?.includes('no image')) {
        toast.error(t.add.qrEmpty)
      } else {
        toast.error(t.add.qrFail)
      }
    } finally {
      setQrBusy(false)
    }
  }

  const handleAddUri = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.m3tr0.addServerUri(uri.trim())
      if (res.ok) {
        toast.success(t.add.added, { description: res.data?.name })
        close()
      } else {
        toast.error(res.error ?? t.add.uriError)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAddSub = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.m3tr0.addSubscription(sub.name.trim(), sub.url.trim())
      if (res.ok) {
        toast.success(t.add.subAdded, {
          description: `${res.data?.serverCount ?? 0} · ${t.add.subAddedHint}`
        })
        close()
      } else {
        toast.error(res.error ?? t.common.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAddManual = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.m3tr0.addServerManual({
        name: manual.name.trim(),
        protocol: manual.protocol,
        address: manual.address.trim(),
        port: parseInt(manual.port, 10),
        uuid: manual.uuid.trim(),
        method: manual.protocol === 'Shadowsocks' ? 'aes-256-gcm' : undefined,
        flow: manual.protocol === 'VLESS' && preset === 'reality' ? 'xtls-rprx-vision' : undefined,
        stream: buildStream(preset, manual.protocol, stream)
      })
      if (res.ok) {
        toast.success(t.add.added, { description: res.data?.name })
        close()
      } else {
        toast.error(res.error ?? t.common.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const changeProtocol = (p: ManualProtocol): void => {
    setManual((m) => ({ ...m, protocol: p }))
    setPreset(DEFAULT_PRESET[p])
  }

  const presets = PRESETS_BY_PROTOCOL[manual.protocol]

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{t.add.title}</DialogTitle>
          <DialogDescription>{t.connections.subtitle}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="uri" className="gap-1.5 font-mono text-xs">
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {t.add.tabUri}
            </TabsTrigger>
            <TabsTrigger value="sub" className="gap-1.5 font-mono text-xs">
              <Rss className="h-3.5 w-3.5" aria-hidden />
              {t.add.tabSub}
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1.5 font-mono text-xs">
              <TerminalSquare className="h-3.5 w-3.5" aria-hidden />
              {t.add.tabManual}
            </TabsTrigger>
          </TabsList>

          {/* --- ссылка --- */}
          <TabsContent value="uri" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="uri-input">{t.add.uriLabel}</Label>
              <Textarea
                id="uri-input"
                value={uri}
                onChange={(e) => {
                  setUri(e.target.value)
                  setParseError(false)
                  setParsed(null)
                }}
                placeholder={t.add.uriPlaceholder}
                className="min-h-[88px] font-mono text-xs"
                spellCheck={false}
              />
              {parseError && <p className="text-xs text-destructive">{t.add.uriError}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleQr()}
                disabled={qrBusy || busy}
                className="font-mono"
              >
                {qrBusy ? (
                  <ScanLine className="h-4 w-4 animate-pulse" aria-hidden />
                ) : (
                  <QrCode className="h-4 w-4" aria-hidden />
                )}
                {qrBusy ? t.add.qrScanning : t.add.qrBtn}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleParse}
                disabled={!uri.trim()}
                className="font-mono"
              >
                <Wand2 className="h-4 w-4" aria-hidden />
                {t.add.uriParse}
              </Button>
            </div>

            {parsed && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="flex items-center gap-2 font-mono text-xs text-primary">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {t.add.uriParsed}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
                  <Field label={t.add.nameLabel} value={parsed.name} />
                  <Field label={t.add.protocolLabel} value={parsed.protocol} />
                  <Field label={t.add.addressLabel} value={parsed.address} />
                  <Field label={t.add.portLabel} value={String(parsed.port)} />
                  <Field label={t.add.countryLabel} value={parsed.country} />
                  <Field
                    label={t.add.uuidLabel}
                    value={parsed.uuid ? parsed.uuid.slice(0, 18) + '…' : '—'}
                  />
                </div>
              </div>
            )}

            {uri.trim() && (
              <Button
                type="button"
                onClick={() => void handleAddUri()}
                disabled={busy}
                className="w-full font-mono"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t.add.addBtn}
              </Button>
            )}
          </TabsContent>

          {/* --- подписка --- */}
          <TabsContent value="sub" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="sub-name">{t.add.subNameLabel}</Label>
              <Input
                id="sub-name"
                value={sub.name}
                onChange={(e) => setSub((s) => ({ ...s, name: e.target.value }))}
                placeholder={t.add.subNamePlaceholder}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">{t.add.subNameHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-url">{t.add.subUrlLabel}</Label>
              <Input
                id="sub-url"
                type="url"
                value={sub.url}
                onChange={(e) => setSub((s) => ({ ...s, url: e.target.value }))}
                placeholder={t.add.subUrlPlaceholder}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleAddSub()}
              disabled={busy || !sub.url.trim()}
              className="w-full font-mono"
            >
              <Rss className="h-4 w-4" aria-hidden />
              {t.add.addBtn}
            </Button>
          </TabsContent>

          {/* --- вручную --- */}
          <TabsContent value="manual" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="m-name">{t.add.nameLabel}</Label>
                <Input
                  id="m-name"
                  value={manual.name}
                  onChange={(e) => setManual((m) => ({ ...m, name: e.target.value }))}
                  placeholder="My VPS"
                />
              </div>
              <div className="space-y-2">
                <Label>{t.add.protocolLabel}</Label>
                <Select value={manual.protocol} onValueChange={(v) => changeProtocol(v as ManualProtocol)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['VLESS', 'VMess', 'Trojan', 'Shadowsocks'] as ManualProtocol[]).map((p) => (
                      <SelectItem key={p} value={p} className="font-mono text-xs">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-port">{t.add.portLabel}</Label>
                <Input
                  id="m-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={manual.port}
                  onChange={(e) => setManual((m) => ({ ...m, port: e.target.value }))}
                  className="font-mono"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="m-address">{t.add.addressLabel}</Label>
                <Input
                  id="m-address"
                  value={manual.address}
                  onChange={(e) => setManual((m) => ({ ...m, address: e.target.value }))}
                  placeholder="server.example.com"
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="m-uuid">{t.add.uuidLabel}</Label>
                <Input
                  id="m-uuid"
                  value={manual.uuid}
                  onChange={(e) => setManual((m) => ({ ...m, uuid: e.target.value }))}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>

              {/* пресет транспорта */}
              {manual.protocol !== 'Shadowsocks' && (
                <>
                  <div className="col-span-2 space-y-2">
                    <Label>{t.add.streamLabel}</Label>
                    <Select value={preset} onValueChange={(v) => setPreset(v as PresetKey)}>
                      <SelectTrigger className="w-full font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {presets.map((p) => (
                          <SelectItem key={p} value={p} className="font-mono text-xs">
                            {t.add.streamPreset[PRESET_LABEL_KEY[p]]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(preset === 'tcp-tls' || preset === 'ws-tls' || preset === 'grpc-tls' || preset === 'reality') && (
                    <div className="col-span-2">
                      <Input
                        aria-label={t.add.sniLabel}
                        value={stream.serverName}
                        onChange={(e) => setStream((s) => ({ ...s, serverName: e.target.value }))}
                        placeholder={t.add.sniLabel}
                        className="font-mono text-xs"
                        spellCheck={false}
                      />
                    </div>
                  )}
                  {preset === 'reality' && (
                    <>
                      <div className="col-span-2">
                        <Input
                          aria-label={t.add.publicKeyLabel}
                          value={stream.publicKey}
                          onChange={(e) => setStream((s) => ({ ...s, publicKey: e.target.value }))}
                          placeholder={t.add.publicKeyLabel}
                          className="font-mono text-xs"
                          spellCheck={false}
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          aria-label={t.add.shortIdLabel}
                          value={stream.shortId}
                          onChange={(e) => setStream((s) => ({ ...s, shortId: e.target.value }))}
                          placeholder={t.add.shortIdLabel}
                          className="font-mono text-xs"
                          spellCheck={false}
                        />
                      </div>
                    </>
                  )}
                  {preset === 'ws-tls' && (
                    <>
                      <div>
                        <Input
                          aria-label={t.add.pathLabel}
                          value={stream.path}
                          onChange={(e) => setStream((s) => ({ ...s, path: e.target.value }))}
                          placeholder={t.add.pathLabel}
                          className="font-mono text-xs"
                          spellCheck={false}
                        />
                      </div>
                      <div>
                        <Input
                          aria-label={t.add.hostLabel}
                          value={stream.host}
                          onChange={(e) => setStream((s) => ({ ...s, host: e.target.value }))}
                          placeholder={t.add.hostLabel}
                          className="font-mono text-xs"
                          spellCheck={false}
                        />
                      </div>
                    </>
                  )}
                  {preset === 'grpc-tls' && (
                    <div className="col-span-2">
                      <Input
                        aria-label={t.add.serviceNameLabel}
                        value={stream.serviceName}
                        onChange={(e) => setStream((s) => ({ ...s, serviceName: e.target.value }))}
                        placeholder={t.add.serviceNameLabel}
                        className="font-mono text-xs"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            <Button
              type="button"
              onClick={() => void handleAddManual()}
              disabled={busy || !canAddManual}
              className="w-full font-mono"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t.add.addBtn}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  value,
  className
}: {
  label: string
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="block truncate text-foreground">{value}</span>
    </div>
  )
}
