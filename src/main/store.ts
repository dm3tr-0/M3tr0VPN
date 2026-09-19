// ============================================================
// M3tr0VPN — хранилище настроек (JSON в userData)
// Заменяет Prisma/SQLite из веб-прототипа: десктопу не нужна БД.
// ============================================================

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import type { AppRule, AppSettings, ServerProfile, Subscription } from '@shared/types'

/** Геометрия окна (запоминается между запусками — как v2rayN) */
export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface StoreData {
  version: 1
  settings: AppSettings
  servers: ServerProfile[]
  subscriptions: Subscription[]
  appRules: AppRule[]
  window?: WindowBounds
}

const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  autoConnect: false,
  launchAtStartup: false,
  ipv6: false,
  mux: true,
  dns: 'auto',
  selectedServerId: null,
  selectedDomains: [],
  transportMode: 'proxy',
  autoUpdateSubs: true,
  coreOverrides: {}
}

function defaultData(): StoreData {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    servers: [],
    subscriptions: [],
    appRules: []
  }
}

export class Store extends EventEmitter {
  private data: StoreData
  private file: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.file = path.join(app.getPath('userData'), 'store.json')
    this.data = this.load()
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<StoreData>
        return {
          version: 1,
          settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
          servers: Array.isArray(raw.servers) ? raw.servers : [],
          subscriptions: Array.isArray(raw.subscriptions) ? raw.subscriptions : [],
          appRules: Array.isArray(raw.appRules) ? raw.appRules : [],
          window: raw.window
        }
      }
    } catch (err) {
      console.error('[store] failed to read store.json:', err)
    }
    return defaultData()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 200)
  }

  flush(): void {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[store] failed to save store.json:', err)
    }
  }

  get settings(): AppSettings {
    return this.data.settings
  }

  get servers(): ServerProfile[] {
    return this.data.servers
  }

  get subscriptions(): Subscription[] {
    return this.data.subscriptions
  }

  get appRules(): AppRule[] {
    return this.data.appRules
  }

  /** Сохранённая геометрия окна (нет — null) */
  getWindow(): WindowBounds | null {
    const w = this.data.window
    return w && Number.isFinite(w.width) && Number.isFinite(w.height) ? w : null
  }

  setWindow(bounds: WindowBounds): void {
    this.data.window = bounds
    this.scheduleSave()
  }

  patchSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.scheduleSave()
    this.emit('changed')
    return this.data.settings
  }

  addServer(server: ServerProfile): void {
    this.data.servers.push(server)
    if (!this.data.settings.selectedServerId) {
      this.data.settings.selectedServerId = server.id
    }
    this.scheduleSave()
    this.emit('changed')
  }

  updateServer(id: string, patch: Partial<ServerProfile>): ServerProfile | null {
    const idx = this.data.servers.findIndex((s) => s.id === id)
    if (idx === -1) return null
    this.data.servers[idx] = { ...this.data.servers[idx], ...patch }
    this.scheduleSave()
    this.emit('changed')
    return this.data.servers[idx]
  }

  deleteServer(id: string): void {
    this.data.servers = this.data.servers.filter((s) => s.id !== id)
    if (this.data.settings.selectedServerId === id) {
      this.data.settings.selectedServerId = this.data.servers[0]?.id ?? null
    }
    this.scheduleSave()
    this.emit('changed')
  }

  /** Заменить все серверы подписки результатами обновления */
  replaceSubscriptionServers(subscriptionId: string, servers: ServerProfile[]): void {
    this.data.servers = this.data.servers.filter((s) => s.subscriptionId !== subscriptionId)
    this.data.servers.push(...servers)
    if (
      this.data.settings.selectedServerId &&
      !this.data.servers.some((s) => s.id === this.data.settings.selectedServerId)
    ) {
      this.data.settings.selectedServerId = this.data.servers[0]?.id ?? null
    }
    this.scheduleSave()
    this.emit('changed')
  }

  upsertSubscription(sub: Subscription): void {
    const idx = this.data.subscriptions.findIndex((s) => s.id === sub.id)
    if (idx === -1) this.data.subscriptions.push(sub)
    else this.data.subscriptions[idx] = sub
    this.scheduleSave()
    this.emit('changed')
  }

  deleteSubscription(id: string): void {
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.id !== id)
    this.data.servers = this.data.servers.filter((s) => s.subscriptionId !== id)
    if (
      this.data.settings.selectedServerId &&
      !this.data.servers.some((s) => s.id === this.data.settings.selectedServerId)
    ) {
      this.data.settings.selectedServerId = this.data.servers[0]?.id ?? null
    }
    this.scheduleSave()
    this.emit('changed')
  }

  addApp(rule: AppRule): void {
    this.data.appRules.push(rule)
    this.scheduleSave()
    this.emit('changed')
  }

  updateApp(id: string, patch: Partial<AppRule>): AppRule | null {
    const idx = this.data.appRules.findIndex((r) => r.id === id)
    if (idx === -1) return null
    this.data.appRules[idx] = { ...this.data.appRules[idx], ...patch }
    this.scheduleSave()
    this.emit('changed')
    return this.data.appRules[idx]
  }

  deleteApp(id: string): void {
    this.data.appRules = this.data.appRules.filter((r) => r.id !== id)
    this.scheduleSave()
    this.emit('changed')
  }

  selectedServer(): ServerProfile | null {
    return this.data.servers.find((s) => s.id === this.data.settings.selectedServerId) ?? null
  }
}
