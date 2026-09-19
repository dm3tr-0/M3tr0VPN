// ============================================================
// M3tr0VPN — пути к ядру Xray и служебным папкам
// ============================================================

import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/** Папка данных приложения (userData) */
export function dataDir(): string {
  return app.getPath('userData')
}

/** Папка конфигураций/логов ядра */
export function xrayWorkDir(): string {
  const dir = path.join(dataDir(), 'xray')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Папка журналов приложения */
export function logsDir(): string {
  const dir = path.join(dataDir(), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Каталог с бинарниками ядер (Xray, sing-box) и ассетами
 * (geoip.dat, geosite.dat, wintun.dll). В dev — desktop/core/<platform>,
 * в упакованном приложении — resources/core.
 */
export function coreDir(): string {
  const platformDir = process.platform === 'win32' ? 'windows' : 'linux'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'core')
  }
  // dev/preview: бандл лежит в out/main/index.mjs — корень проекта
  // двумя уровнями выше; прямой запуск `electron out/main/index.mjs`
  // даёт getAppPath() = out/, поэтому проверяем оба варианта.
  const fromBundle = path.resolve(__dirname, '..', '..')
  if (fs.existsSync(path.join(fromBundle, 'core'))) {
    return path.join(fromBundle, 'core', platformDir)
  }
  return path.join(app.getAppPath(), 'core', platformDir)
}

/** Полный путь к бинарнику xray */
export function coreBinary(): string {
  return path.join(coreDir(), process.platform === 'win32' ? 'xray.exe' : 'xray')
}

/** Файл конфигурации ядра */
export function coreConfigPath(): string {
  return path.join(xrayWorkDir(), 'config.json')
}

export function coreExists(): boolean {
  try {
    return fs.existsSync(coreBinary())
  } catch {
    return false
  }
}
