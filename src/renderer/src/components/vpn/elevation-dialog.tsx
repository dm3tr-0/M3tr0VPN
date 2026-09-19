// ============================================================
// M3tr0VPN — диалог «Нужны права администратора»
// Показывается, когда connect()/updateSettings() вернули
// needsElevation (TUN-режим без прав). Подтверждение —
// relaunchElevated() (приложение перезапустится).
// ============================================================

import { useI18n } from '@renderer/lib/i18n-context'
import { useAppState } from '@renderer/hooks/use-app'
import { ShieldAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

export function ElevationDialog(): React.JSX.Element {
  const { t } = useI18n()
  const { elevationRequest, confirmElevation, cancelElevation } = useAppState()

  return (
    <AlertDialog open={elevationRequest} onOpenChange={(o) => !o && cancelElevation()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 font-mono">
            <ShieldAlert className="h-4 w-4 text-primary" aria-hidden />
            {t.elevation.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{t.elevation.text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="font-mono text-xs">{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void confirmElevation()
            }}
            className="bg-primary font-mono text-xs text-primary-foreground hover:bg-primary/90"
          >
            {t.elevation.btn}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
