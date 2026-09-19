# M3tr0VPN Desktop — контракт IPC (для порта UI)

Это Electron-приложение (electron-vite + React 19 + Tailwind 4). Main-процесс уже
реализован и протестирован на реальном ядре Xray. Задача фронта — перенести
одобренный UI из веб-прототипа и подключить его к реальному API `window.m3tr0`.

## Архитектура

```
src/
├── shared/          # типы + чистая логика (используют main И renderer)
│   ├── types.ts     # ServerProfile, AppSettings, ConnectionStatus, …
│   ├── routing.ts   # normalizeDomain/isValidDomain/evaluateDomain (для RouteChecker)
│   └── ipc-api.ts   # интерфейс M3tr0Api (window.m3tr0)
├── main/            # ГОТОВО, НЕ ТРОГАТЬ (кроме мелких фиксов — описать в worklog)
├── preload/         # ГОТОВО
└── renderer/        # ПОРТИРУЕМ UI СЮДА
    └── src/
        ├── App.tsx          # заменить каркас
        ├── env.d.ts         # типизация window.m3tr0 (уже есть)
        └── assets/global.css  # тема Incy (порт из web src/app/globals.css)
```

## window.m3tr0 (preload API)

Полный тип: `src/shared/ipc-api.ts`. Кратко:

**Состояние** — единый снимок, пушится при любом изменении:
```ts
const [snap, setSnap] = useState<AppStateSnapshot | null>(null)
useEffect(() => {
  void window.m3tr0.getState().then(setSnap)      // начальное (с logs и coreVersion)
  return window.m3tr0.onStateChange(setSnap)      // дальше пушится из main
}, [])
```
`AppStateSnapshot = { servers, subscriptions, appRules, settings, status, logs, coreVersion, singboxVersion, appVersion, platform, isElevated, transportAvailable }`

**Соединение**: `connect(): Promise<Result>` / `disconnect()` / `selectServer(id)`.
`Result = { ok, error?, needsElevation? }` — если `needsElevation === true`,
показать диалог «TUN-режим требует прав администратора — перезапустить?» и
вызвать `relaunchElevated()`.

**Скорости**: `status.speedDown / speedUp / totalDown / totalUp` (байт/сек и байт)
обновляются в снапшоте каждые ~2 сек (реальные счётчики ядра). Плюс поток
`onStats(cb)` если нужен тик отдельно.

**Журнал ядра**: `snap.logs` при первом getState, дальше `onLog(cb)` добавляет
записи `{ t, level: 'info'|'warn'|'error', source: 'core'|'app', message }`.
`clearLogs()` очищает (после этого массив в снапшоте не сбрасывается — держите
локальный список в стейте, дописывайте из onLog).

**Серверы**: `addServerUri('vless://…')` (парсер vless/vmess/trojan/ss уже в main),
`addServerManual(input)`, `updateServer`, `deleteServer`, `testLatency()` —
TCP-пинг (главная кнопка, Tcping из v2rayN): время TCP-коннекта к серверу,
быстро и без ядер (обновляет latencyMs/latencyError в снапшоте). UDP-протоколы
(hysteria/hy2/tuic/wireguard/amneziawg) пингуются по TCP-порту другого сервера
на том же хосте; если его нет — сквозной пробой временного ядра.
`testLatencyReal()` — сквозной замер («true delay» в v2rayN): для каждого
сервера поднимается временное ядро (xray или sing-box, 4 параллельно)
и через него запрашивается `http://www.gstatic.com/generate_204`.

**Подписки**: `addSubscription(name, url)` — main скачивает, парсит base64-список
ссылок, создаёт серверы; `refreshSubscription(id)`, `deleteSubscription(id)`.

**Туннелирование**: `updateSettings({ selectedDomains: [...] })` — «Выбранное»;
`addApp/updateApp/deleteApp` — исключения приложений (process-правила ядра).

**Настройки**: `updateSettings(patch)` — language/autoConnect/launchAtStartup/ipv6/
mux/dns/transportMode/coreOverrides (ядро для протокола, как CoreTypeItem
в v2rayN: VLESS/VMess/Trojan/SS/Hysteria2/WireGuard — Xray или sing-box).
Изменение транспортных полей при активном соединении само перезапускает ядро
(reconnect с сохранением сессии).

**Конфиг**: `showConfig()` → `{ configs: [{ name, config }] }` (конфиг активного
ядра — Xray с нативным tun-инбаундом в TUN-режиме либо sing-box для своих
протоколов; диалог показывает табами), `exportConfig()` — сохранить в файл.

**Окно**: `windowMinimize() / windowMaximize() / windowClose() / isMaximized()`,
подписка `onMaximizedChange(cb)`. Кнопка «Закрыть» — сворачивает в трей если
подключены (подтверждение в UI уже спроектировано); полный выход — `quitApp()`
(он корректно погасит ядро и системный прокси).

**Прочее**: `openExternal(url)`, `openLogsFolder()`, `scanQrClipboard()` —
QR из буфера обмена (картинка → ссылка vless://…), `platform`.

## Что менять при порте (отличия от веб-прототипа)

1. **app-window.tsx**: убрать симуляцию «рабочего стола» / windowed-состояния /
   ярлыка. Это НАСТОЯЩЕЕ окно теперь. Титлбар: логотип, название, статус-чип,
   RU|EN, кнопки — «реальные»: `window.m3tr0.windowMinimize()` и т.д.
   Титлбар — drag-регион (`WebkitAppRegion: 'drag'`, кнопки — 'no-drag').
   Кнопка «закрыть» открывает существующий AlertDialog (Выйти? / Свернуть в трей).
2. **Хранилище**: никакого Zustand-симулятора и TanStack Query. Единый источник —
   снапшот из IPC. Локальный стейт только для UI-мелочей (открытые диалоги).
3. **Фазы подключения**: `status.state` = disconnected | connecting | connected |
   error. connecting — реальный запуск ядра (~1 сек), НЕ setTimeout-ы.
4. **Скорости/трафик**: реальные (байты). Форматирование — lib/format.ts из web.
5. **route-checker**: вместо POST /api/route-check — локально
   `evaluateDomain(domain, snap.settings.selectedDomains)` из `@shared/routing`.
6. **config-dialog**: вместо useQuery — `window.m3tr0.showConfig()`.
7. **add-server-dialog**: парсер URI оставить как пререндер-валидацию, но
   сохранение — через `window.m3tr0.addServerUri(uri)` / `addSubscription(name,url)` /
   `addServerManual(input)`. Добавить кнопку «Из QR в буфере» (scanQrClipboard).
8. **settings-view**:
   - Ядро: версии из `snap.coreVersion` (Xray) и `snap.singboxVersion`, Mux, IPv6, DNS — как было;
   - НОВОЕ «Режим работы»: radio Системный прокси | TUN-адаптер (весь трафик,
     нужны права администратора). При выборе TUN без прав — диалог с
     `relaunchElevated()`. `snap.isElevated` показывает текущие права.
   - автозапуск — `updateSettings({ launchAtStartup })` (main применяет сам);
   - «Открыть папку логов» — `openLogsFolder()`.
9. **status-view**: подпись «через Amsterdam #1 · VLESS» + режим
   (Системный прокси / TUN) из `status.transport`.
10. **Тема**: глобальные стили и утилиты (.card-m3tr0, .glow-*, .text-glow,
    .terminal-chip, .cursor-blink, grid-фон, скроллбар) — порт из
    web `src/app/globals.css`. Шрифты: `@fontsource/jetbrains-mono` (импорты
    весов 400/500/700 в main.tsx или css), sans — системный стек
    (`system-ui, 'Segoe UI', …`). Никаких next/font.
11. **i18n**: порт `src/lib/i18n.ts` + контекст из web, НО: язык хранится в
    main-store — `updateSettings({ language })`, начальное из снапшота.
    Локального localStorage-кеша не нужно.
12. Никаких 'use client' директив, Next-специфики, next/font, next-intl.
13. UI-компоненты shadcn: скопировать нужные из web `src/components/ui/` в
    `renderer/src/components/ui/` (button, card, dialog, alert-dialog, dropdown-menu,
    tabs, switch, scroll-area, separator, label, tooltip, input, badge, …).
    Пути `@/components/...` → `@renderer/components/...`.
14. Тосты — sonner (укажите `theme="dark"`).

## Сборка и проверка

```bash
cd desktop
bun run build        # electron-vite build (renderer + main + preload)
bun run typecheck    # tsc по обоим конфигам
# опционально: xvfb-run -a node_modules/.bin/electron out/main/index.js --no-sandbox --m3tr0-shoot=/tmp/shot.png
```

Обе команды должны быть зелёными. ESLint не используется в desktop (не требуется).
