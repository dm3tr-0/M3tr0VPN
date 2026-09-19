// ============================================================
// M3tr0VPN — иконка в трее
// ============================================================

import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import type { ConnectionStatus, Language } from '@shared/types'

const STRINGS = {
  ru: {
    connected: 'M3tr0VPN — Подключено',
    disconnected: 'M3tr0VPN — Отключено',
    error: 'M3tr0VPN — Ошибка',
    connect: 'Подключиться',
    disconnect: 'Отключиться',
    show: 'Показать M3tr0VPN',
    quit: 'Выход'
  },
  en: {
    connected: 'M3tr0VPN — Connected',
    disconnected: 'M3tr0VPN — Disconnected',
    error: 'M3tr0VPN — Error',
    connect: 'Connect',
    disconnect: 'Disconnect',
    show: 'Show M3tr0VPN',
    quit: 'Quit'
  }
} as const

function trayIconPath(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icons', 'tray-32.png')]
    : [
        path.join(app.getAppPath(), 'build', 'icons', 'tray-32.png'),
        path.join(app.getAppPath(), 'build', 'icon.png')
      ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

export interface M3tr0Tray {
  rebuild(status: ConnectionStatus, lang: Language): void
}

export function createTray(handlers: {
  onToggle: (connect: boolean) => void
  onShow: () => void
  onQuit: () => void
}): M3tr0Tray {
  const iconPath = trayIconPath()
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  const tray = new Tray(image)
  tray.setToolTip('M3tr0VPN')

  const rebuild = (status: ConnectionStatus, lang: Language): void => {
    const t = STRINGS[lang] ?? STRINGS.ru
    const connected = status.state === 'connected'
    tray.setToolTip(connected ? t.connected : status.state === 'error' ? t.error : t.disconnected)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: connected ? t.connected : t.disconnected, enabled: false },
        { type: 'separator' },
        connected
          ? { label: t.disconnect, click: () => handlers.onToggle(false) }
          : { label: t.connect, click: () => handlers.onToggle(true) },
        { label: t.show, click: handlers.onShow },
        { type: 'separator' },
        { label: t.quit, click: handlers.onQuit }
      ])
    )
  }

  return { rebuild }
}
