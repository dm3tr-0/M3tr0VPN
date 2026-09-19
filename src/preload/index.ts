// ============================================================
// M3tr0VPN — preload (contextBridge → window.m3tr0)
// ============================================================

import { contextBridge, ipcRenderer } from 'electron'
import type { M3tr0Api } from '@shared/ipc-api'

const api: M3tr0Api = {
  platform: process.platform,

  getState: () => ipcRenderer.invoke('m3tr0:get-state'),
  connect: () => ipcRenderer.invoke('m3tr0:connect'),
  disconnect: () => ipcRenderer.invoke('m3tr0:disconnect'),

  addServerUri: (uri) => ipcRenderer.invoke('m3tr0:add-server-uri', uri),
  addServerManual: (input) => ipcRenderer.invoke('m3tr0:add-server-manual', input),
  updateServer: (id, patch) => ipcRenderer.invoke('m3tr0:update-server', { id, patch }),
  deleteServer: (id) => ipcRenderer.invoke('m3tr0:delete-server', id),
  selectServer: (id) => ipcRenderer.invoke('m3tr0:select-server', id),
  testLatency: () => ipcRenderer.invoke('m3tr0:test-latency'),
  testLatencyReal: () => ipcRenderer.invoke('m3tr0:test-latency-real'),

  addSubscription: (name, url) => ipcRenderer.invoke('m3tr0:add-subscription', { name, url }),
  refreshSubscription: (id) => ipcRenderer.invoke('m3tr0:refresh-subscription', id),
  deleteSubscription: (id) => ipcRenderer.invoke('m3tr0:delete-subscription', id),

  addApp: (app) => ipcRenderer.invoke('m3tr0:add-app', app),
  updateApp: (id, patch) => ipcRenderer.invoke('m3tr0:update-app', { id, patch }),
  deleteApp: (id) => ipcRenderer.invoke('m3tr0:delete-app', id),

  updateSettings: (patch) => ipcRenderer.invoke('m3tr0:update-settings', patch),

  showConfig: () => ipcRenderer.invoke('m3tr0:show-config'),
  exportConfig: () => ipcRenderer.invoke('m3tr0:export-config'),

  getLogs: () => ipcRenderer.invoke('m3tr0:get-logs'),
  clearLogs: () => ipcRenderer.invoke('m3tr0:clear-logs'),
  openLogsFolder: () => ipcRenderer.invoke('m3tr0:open-logs-folder'),
  openExternal: (url) => ipcRenderer.invoke('m3tr0:open-external', url),
  scanQrClipboard: () => ipcRenderer.invoke('m3tr0:scan-qr-clipboard'),

  relaunchElevated: () => ipcRenderer.invoke('m3tr0:relaunch-elevated'),
  quitApp: () => ipcRenderer.invoke('m3tr0:quit-app'),

  windowMinimize: () => ipcRenderer.send('m3tr0:window-minimize'),
  windowMaximize: () => ipcRenderer.send('m3tr0:window-maximize'),
  windowClose: () => ipcRenderer.send('m3tr0:window-close'),
  isMaximized: () => ipcRenderer.invoke('m3tr0:window-is-maximized'),

  onStateChange: (cb) => {
    const listener = (_e: unknown, snapshot: Parameters<typeof cb>[0]): void => cb(snapshot)
    ipcRenderer.on('m3tr0:state-changed', listener)
    return () => ipcRenderer.removeListener('m3tr0:state-changed', listener)
  },
  onLog: (cb) => {
    const listener = (_e: unknown, entry: Parameters<typeof cb>[0]): void => cb(entry)
    ipcRenderer.on('m3tr0:log', listener)
    return () => ipcRenderer.removeListener('m3tr0:log', listener)
  },
  onStats: (cb) => {
    const listener = (_e: unknown, tick: Parameters<typeof cb>[0]): void => cb(tick)
    ipcRenderer.on('m3tr0:stats', listener)
    return () => ipcRenderer.removeListener('m3tr0:stats', listener)
  },
  onMaximizedChange: (cb) => {
    const listener = (_e: unknown, value: boolean): void => cb(value)
    ipcRenderer.on('m3tr0:maximized-changed', listener)
    return () => ipcRenderer.removeListener('m3tr0:maximized-changed', listener)
  },
  onElevationRequested: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('m3tr0:elevation-requested', listener)
    return () => ipcRenderer.removeListener('m3tr0:elevation-requested', listener)
  }
}

contextBridge.exposeInMainWorld('m3tr0', api)
