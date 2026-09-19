// ============================================================
// M3tr0VPN — корень renderer
// I18nProvider (язык из main-store) + AppProvider (снапшот IPC)
// + окно приложения + диалог повышения прав + тосты sonner.
// ============================================================

import { I18nProvider } from '@renderer/lib/i18n-context'
import { AppProvider } from '@renderer/hooks/use-app'
import { AppWindow } from '@renderer/components/vpn/app-window'
import { ElevationDialog } from '@renderer/components/vpn/elevation-dialog'
import { Toaster } from '@renderer/components/ui/sonner'

export default function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <AppProvider>
        <AppWindow />
        <ElevationDialog />
        <Toaster />
      </AppProvider>
    </I18nProvider>
  )
}
