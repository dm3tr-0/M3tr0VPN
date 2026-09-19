// ============================================================
// M3tr0VPN Desktop — main process
// Окно без рамки (кастомный титлбар в renderer), трей,
// жизненный цикл, автоподключение, CLI-флаги для тестов
// (--m3tr0-shoot=screenshot.png, --m3tr0-smoke).
// ============================================================

import { app, BrowserWindow, screen, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { Store } from './store'
import { VpnController } from './vpn'
import { xray, appLogFile } from './xray/manager'
import { singbox } from './singbox/manager'
import { sysProxy } from './sysproxy'
import { createTray, type M3tr0Tray } from './tray'
import { registerIpc } from './ipc'
import { coreExists, coreDir, logsDir } from './xray/paths'
import { killStaleCores, httpPortCandidates } from './ports'
import { refreshAllSubscriptions } from './subscriptions'
import { killLatencyCores } from './latency'

// CLI-флаги для headless-тестов (xvfb)
const shootArg = process.argv.find((a) => a.startsWith('--m3tr0-shoot='))
const smokeMode = process.argv.includes('--m3tr0-smoke')

let mainWindow: BrowserWindow | null = null
let store: Store | null = null
let vpn: VpnController | null = null
let tray: M3tr0Tray | null = null
let quitting = false

// Один экземпляр приложения
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function logToFile(message: string): void {
  try {
    fs.mkdirSync(logsDir(), { recursive: true })
    fs.appendFileSync(appLogFile(), `[${new Date().toISOString()}] ${message}\n`, 'utf-8')
  } catch {
    /* best effort */
  }
}

/** Виден ли центр окна хоть на одном мониторе (защита от «окно улетело») */
function boundsReachable(x: number | undefined, y: number | undefined): boolean {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return false
  }
  return screen.getAllDisplays().some(
    (d) =>
      x >= d.workArea.x &&
      x <= d.workArea.x + d.workArea.width &&
      y >= d.workArea.y &&
      y <= d.workArea.y + d.workArea.height
  )
}

function createWindow(): void {
  // Геометрия: помним размер/позицию/максимизацию (как v2rayN).
  // Дефолт — не больше рабочей области монитора (жалоба: «элементы
  // не видно, приходится растягивать окно вручную» — окно 1180×780
  // не влезало на экран с панелью задач и обрезалось).
  const saved = store?.getWindow()
  const wa = screen.getPrimaryDisplay().workArea
  const width = Math.max(760, Math.min(saved?.width ?? 1180, wa.width - 24))
  const height = Math.max(620, Math.min(saved?.height ?? 780, wa.height - 24))
  const at = boundsReachable(saved?.x, saved?.y) ? { x: saved?.x, y: saved?.y } : {}

  mainWindow = new BrowserWindow({
    width,
    height,
    ...at,
    minWidth: 760,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#070c0a',
    title: 'M3tr0VPN',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  if (saved?.maximized) mainWindow.maximize()

  // Запоминаем геометрию (дебаунс: resize/move сыпят событиями)
  let boundsTimer: NodeJS.Timeout | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const b = mainWindow.getBounds()
      store?.setWindow({ ...b, maximized: mainWindow.isMaximized() })
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
  mainWindow.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    // финальное сохранение — даже если дебаунс не успел
    if (mainWindow && !mainWindow.isDestroyed()) {
      const b = mainWindow.getBounds()
      store?.setWindow({ ...b, maximized: mainWindow.isMaximized() })
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) return
    mainWindow.show()
    void onWindowReady()
  })

  // Кастомная кнопка «закрыть» из renderer вызывает quitApp (с подтверждением).
  // Системное закрытие (Alt+F4) — сворачиваем в трей, если подключены.
  mainWindow.on('close', (e) => {
    if (!quitting && vpn && vpn.getStatus().state === 'connected') {
      e.preventDefault()
      mainWindow?.hide()
      tray?.rebuild(vpn.getStatus(), store?.settings.language ?? 'ru')
    }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('m3tr0:maximized-changed', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('m3tr0:maximized-changed', false))

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Внешние ссылки — в системный браузер
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (smokeMode) {
    const errors: string[] = []
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 3) errors.push(message)
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      errors.push(`did-fail-load ${code}: ${desc}`)
    })
    setTimeout(() => {
      console.log(`[smoke] console-errors=${errors.length}`)
      errors.slice(0, 20).forEach((e) => console.log('[smoke-error]', e))
      console.log('[smoke] DONE')
      quitting = true
      app.quit()
    }, 6000)
  }

  if (shootArg) {
    const target = shootArg.split('=').slice(1).join('=')
    setTimeout(async () => {
      try {
        if (mainWindow) {
          const image = await mainWindow.webContents.capturePage()
          fs.writeFileSync(target, image.toPNG())
          console.log(`[shoot] saved ${target}`)
        }
      } catch (err) {
        console.log('[shoot] failed:', err)
      }
      quitting = true
      app.quit()
    }, 4500)
  }

  // electron-vite: в dev грузим URL dev-сервера, иначе файл
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function iconPath(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'icons', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png')
  ]
  for (const p of candidates) if (fs.existsSync(p)) return p
  return undefined as unknown as string
}

async function onWindowReady(): Promise<void> {
  if (!store || !vpn) return
  // 1) Убираем «осиротевшие» ядра с прошлого запуска (могут держать порт
  //    10808 и ломать новый старт ошибкой «failed to listen TCP on …»)
  try {
    const killed = await killStaleCores(coreDir())
    if (killed.length > 0) {
      xray.pushLog('warn', 'app', `killed ${killed.length} stale core process(es) from previous run`)
    }
  } catch {
    /* best effort */
  }
  // 2) Починка системного прокси после падения
  await sysProxy.repairIfNeeded(httpPortCandidates())
  // 3) Автообновление подписок (тихое)
  if (store.settings.autoUpdateSubs && store.subscriptions.length > 0) {
    await refreshAllSubscriptions(store, (message) => xray.pushLog('info', 'app', message))
  }
  // 4) Автоподключение
  if (store.settings.autoConnect && store.selectedServer()) {
    const res = await vpn.connect()
    if (!res.ok && res.needsElevation) {
      // TUN-режим без прав администратора: сразу предлагаем
      // перезапуск с повышением (тот же диалог, что и по кнопке)
      xray.pushLog('warn', 'app', 'auto-connect needs administrator rights for tun mode')
      mainWindow?.webContents.send('m3tr0:elevation-requested')
    } else if (!res.ok) {
      xray.pushLog('error', 'app', `auto-connect failed: ${res.error ?? 'unknown'}`)
    }
  }
}

function quitApp(): void {
  quitting = true
  app.quit()
}

app.whenReady().then(() => {
  store = new Store()
  vpn = new VpnController(store)
  const storeRef = store
  const vpnRef = vpn

  // Журнал ядра/приложения -> файл (оба ядра)
  const logToFile2 = (entry: { level: string; source: string; message: string }): void => {
    logToFile(`[${entry.source}:${entry.level}] ${entry.message}`)
  }
  xray.on('log', logToFile2)
  singbox.on('log', logToFile2)

  const { snapshotState } = registerIpc({
    getWindow: () => mainWindow,
    store,
    vpn,
    quitApp
  })

  // Трей
  tray = createTray({
    onToggle: (connect) => {
      void (connect ? vpnRef.connect() : vpnRef.disconnect()).then(() => {
        tray?.rebuild(vpnRef.getStatus(), storeRef.settings.language)
        snapshotState()
      })
    },
    onShow: () => {
      if (mainWindow) {
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
      }
    },
    onQuit: quitApp
  })
  tray.rebuild(vpnRef.getStatus(), storeRef.settings.language)

  vpnRef.on('status', () => {
    tray?.rebuild(vpnRef.getStatus(), storeRef.settings.language)
  })

  // Автозапуск с системой
  app.setLoginItemSettings({ openAtLogin: !!storeRef.settings.launchAtStartup })

  if (!coreExists()) {
    xray.pushLog('error', 'app', 'Xray core not found — приложение будет работать без подключения')
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true
    app.quit()
  }
})

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    killLatencyCores()
    if (vpn) await vpn.forceCleanup()
    store?.flush()
    app.exit(0)
  })()
})
