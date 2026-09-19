// ============================================================
// M3tr0VPN — контракт preload API (window.m3tr0)
// Тип используется и preload, и renderer.
// ============================================================

import type {
  AppRule,
  AppSettings,
  AppStateSnapshot,
  LogEntry,
  ServerProfile,
  SpeedTick,
  Subscription
} from './types'

export interface Result<T = undefined> {
  ok: boolean
  error?: string
  needsElevation?: boolean
  data?: T
}

export interface ManualServerInput {
  name: string
  protocol: ServerProfile['protocol']
  address: string
  port: number
  uuid: string
  method?: string
  flow?: string
  stream: ServerProfile['stream']
}

/** Конфиги ядер для диалога «Конфигурация Xray» (может быть 1–2) */
export interface CoreConfigEntry {
  name: string
  config: Record<string, unknown>
}

export interface M3tr0Api {
  getState(): Promise<AppStateSnapshot>
  connect(): Promise<Result>
  disconnect(): Promise<Result>

  addServerUri(uri: string): Promise<Result<ServerProfile>>
  addServerManual(input: ManualServerInput): Promise<Result<ServerProfile>>
  updateServer(id: string, patch: Partial<ServerProfile>): Promise<Result>
  deleteServer(id: string): Promise<Result>
  selectServer(id: string): Promise<Result>
  /** TCP-пинг — как в v2rayN по умолчанию (кнопка «Пинг») */
  testLatency(): Promise<Result<ServerProfile[]>>
  /** Сквозной тест — как «true delay» в v2rayN (врем. ядра + generate_204) */
  testLatencyReal(): Promise<Result<ServerProfile[]>>

  addSubscription(name: string, url: string): Promise<Result<Subscription>>
  refreshSubscription(id: string): Promise<Result<Subscription>>
  deleteSubscription(id: string): Promise<Result>

  addApp(app: { appId: string; appName: string; icon: string }): Promise<Result<AppRule>>
  updateApp(id: string, patch: { enabled?: boolean }): Promise<Result>
  deleteApp(id: string): Promise<Result>

  updateSettings(patch: Partial<AppSettings>): Promise<Result>

  showConfig(): Promise<Result<{ configs: CoreConfigEntry[] }>>
  exportConfig(): Promise<Result<string>>

  getLogs(): Promise<LogEntry[]>
  clearLogs(): Promise<Result>
  openLogsFolder(): Promise<Result>
  openExternal(url: string): Promise<Result>
  scanQrClipboard(): Promise<Result<string>>

  relaunchElevated(): Promise<Result>
  quitApp(): Promise<Result>

  windowMinimize(): void
  windowMaximize(): void
  windowClose(): void
  isMaximized(): Promise<boolean>

  onStateChange(cb: (snapshot: AppStateSnapshot) => void): () => void
  onLog(cb: (entry: LogEntry) => void): () => void
  onStats(cb: (tick: SpeedTick) => void): () => void
  onMaximizedChange(cb: (maximized: boolean) => void): () => void
  /** main просит показать диалог «Перезапустить от администратора?»
   * (например, автоподключение в TUN-режиме без прав) */
  onElevationRequested(cb: () => void): () => void

  readonly platform: string
}
