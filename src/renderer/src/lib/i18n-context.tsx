// ============================================================
// M3tr0VPN — i18n контекст (RU/EN), десктоп-версия
// Источник правды по языку — main-процесс (store.settings).
// Начальное значение приходит из снапшота; переключение
// сохраняется через window.m3tr0.updateSettings({ language }).
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Language } from '@shared/types'
import { getDict, type Dict } from './i18n'

interface I18nContextValue {
  lang: Language
  t: Dict
  /** Переключить язык: локально + сохранить в main */
  setLang: (l: Language) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Language>('ru')
  /** true после ручного выбора языка пользователем — тогда снапшот не перезаписывает */
  const touched = useRef(false)

  // Начальный язык + синхронизация (пока пользователь не выбрал сам)
  useEffect(() => {
    let alive = true
    const apply = (l: Language): void => {
      if (!alive || touched.current || (l !== 'ru' && l !== 'en')) return
      setLangState(l)
    }
    void window.m3tr0.getState().then((snap) => apply(snap.settings.language))
    const off = window.m3tr0.onStateChange((snap) => apply(snap.settings.language))
    return () => {
      alive = false
      off()
    }
  }, [])

  const setLang = useCallback((l: Language) => {
    touched.current = true
    setLangState(l)
    void window.m3tr0.updateSettings({ language: l })
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({ lang, t: getDict(lang), setLang }),
    [lang, setLang]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
