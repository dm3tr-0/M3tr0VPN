// ============================================================
// M3tr0VPN — единое состояние приложения (renderer)
// Снапшот из window.m3tr0 + поток журнала + история скоростей.
// Никаких симуляторов: всё состояние приходит из main по IPC.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import type { AppSettings, AppStateSnapshot, LogEntry, ServerProfile } from '@shared/types'
import type { Result } from '@shared/ipc-api'

const HISTORY_LEN = 60
const LOG_LIMIT = 400

export interface SpeedPoint {
  /** байт/сек */
  down: number
  up: number
}

function useAppInner() {
  const [snap, setSnap] = useState<AppStateSnapshot | null>(null)
  /** Локальный журнал: начально из getState, дальше onLog (clearLogs не сбрасывает снапшот) */
  const [logs, setLogs] = useState<LogEntry[]>([])
  /** История скоростей для графика (байт/сек) */
  const [history, setHistory] = useState<SpeedPoint[]>([])
  /** Презентационная фаза подключения (0..2) — анимация, пока ядро реально стартует */
  const [connectPhase, setConnectPhase] = useState(0)
  /** Пришёл needsElevation от connect()/updateSettings() — показать диалог */
  const [elevationRequest, setElevationRequest] = useState(false)
  /** Тикающее «сейчас» для таймера сессии */
  const [now, setNow] = useState(() => Date.now())

  const stateRef = useRef<AppStateSnapshot['status']['state']>('disconnected')

  useEffect(() => {
    let alive = true
    const applySnap = (s: AppStateSnapshot): void => {
      stateRef.current = s.status.state
      setSnap(s)
    }
    void window.m3tr0.getState().then((s) => {
      if (!alive) return
      applySnap(s)
      setLogs(s.logs.slice(-LOG_LIMIT))
    })
    const offState = window.m3tr0.onStateChange(applySnap)
    const offLog = window.m3tr0.onLog((entry) => {
      setLogs((prev) => {
        const next = prev.length >= LOG_LIMIT ? prev.slice(prev.length - LOG_LIMIT + 1) : prev.slice()
        next.push(entry)
        return next
      })
    })
    const offStats = window.m3tr0.onStats((tick) => {
      if (stateRef.current !== 'connected') return
      setHistory((prev) => {
        const next = [...prev, { down: tick.down, up: tick.up }]
        return next.length > HISTORY_LEN ? next.slice(next.length - HISTORY_LEN) : next
      })
    })
    // main просит показать диалог перезапуска от администратора
    // (автоподключение в TUN-режиме без прав)
    const offElevation = window.m3tr0.onElevationRequested(() => setElevationRequest(true))
    return () => {
      alive = false
      offState()
      offLog()
      offStats()
      offElevation()
    }
  }, [])

  const state = snap?.status.state ?? 'disconnected'

  // Сброс истории при уходе из connected (новое подключение — новый график)
  useEffect(() => {
    if (state !== 'connected') setHistory([])
  }, [state])

  // Анимация фаз подключения: ядро реально стартует ~1 сек,
  // статус приходит из main — здесь только визуальный прогресс
  useEffect(() => {
    if (state !== 'connecting') {
      setConnectPhase(0)
      return
    }
    setConnectPhase(0)
    const id = setInterval(() => {
      setConnectPhase((p) => (p < 2 ? p + 1 : p))
    }, 420)
    return () => clearInterval(id)
  }, [state])

  // Таймер сессии
  useEffect(() => {
    if (state !== 'connected') return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state])

  const selectedServer = useMemo<ServerProfile | undefined>(
    () => snap?.servers.find((s) => s.id === snap.settings.selectedServerId),
    [snap]
  )

  const connect = useCallback(async (): Promise<Result> => {
    const res = await window.m3tr0.connect()
    if (res.needsElevation) {
      setElevationRequest(true)
    } else if (!res.ok && res.error) {
      toast.error(res.error)
    }
    return res
  }, [])

  const disconnect = useCallback(async (): Promise<void> => {
    const res = await window.m3tr0.disconnect()
    if (!res.ok && res.error) toast.error(res.error)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>): Promise<Result> => {
    const res = await window.m3tr0.updateSettings(patch)
    if (res.needsElevation) setElevationRequest(true)
    else if (!res.ok && res.error) toast.error(res.error)
    return res
  }, [])

  const clearLogs = useCallback(async (): Promise<void> => {
    setLogs([])
    await window.m3tr0.clearLogs()
  }, [])

  const confirmElevation = useCallback(async (): Promise<void> => {
    setElevationRequest(false)
    const res = await window.m3tr0.relaunchElevated()
    if (!res.ok) toast.error(res.error ?? 'elevation declined')
  }, [])

  const cancelElevation = useCallback((): void => {
    setElevationRequest(false)
  }, [])

  return {
    snap,
    state,
    logs,
    history,
    connectPhase,
    elevationRequest,
    now,
    selectedServer,
    connect,
    disconnect,
    updateSettings,
    clearLogs,
    confirmElevation,
    cancelElevation
  }
}

export type AppApi = ReturnType<typeof useAppInner>

const AppContext = createContext<AppApi | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const value = useAppInner()
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppState(): AppApi {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used inside AppProvider')
  return ctx
}
