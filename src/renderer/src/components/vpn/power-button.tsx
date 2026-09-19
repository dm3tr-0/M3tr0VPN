// ============================================================
// M3tr0VPN — большая кнопка подключения (центр Status-экрана)
// Порт из веб-прототипа; состояние error — с красной рамкой.
// ============================================================

import { motion } from 'framer-motion'
import { Loader2, Power } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ConnectionState } from '@shared/types'

interface PowerButtonProps {
  status: ConnectionState
  disabled?: boolean
  onToggle: () => void
  label: string
}

export function PowerButton({ status, disabled, onToggle, label }: PowerButtonProps): React.JSX.Element {
  const connected = status === 'connected'
  const connecting = status === 'connecting'
  const errored = status === 'error'

  return (
    <div className="relative flex flex-col items-center gap-4 select-none">
      {/* пульсирующее гало при подключении */}
      {connected && (
        <span
          aria-hidden
          className="animate-pulse-ring absolute top-1/2 left-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary/50"
        />
      )}

      <motion.button
        type="button"
        aria-label={label}
        aria-pressed={connected}
        disabled={disabled || connecting}
        onClick={onToggle}
        whileTap={{ scale: 0.96 }}
        whileHover={disabled ? undefined : { scale: 1.03 }}
        className={cn(
          'relative z-10 flex h-36 w-36 items-center justify-center rounded-full border-4 transition-all duration-300 outline-none sm:h-40 sm:w-40',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          connected
            ? 'glow-lg border-primary bg-primary/15 text-primary'
            : connecting
              ? 'border-primary/50 bg-primary/5 text-primary/80'
              : errored
                ? 'border-destructive/60 bg-destructive/10 text-destructive hover:border-destructive hover:text-destructive'
                : 'border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-primary hover:glow-sm',
          (disabled || connecting) && 'cursor-not-allowed opacity-60'
        )}
      >
        {connecting ? (
          <Loader2 className="h-14 w-14 animate-spin sm:h-16 sm:w-16" strokeWidth={1.6} />
        ) : (
          <Power
            className={cn(
              'h-14 w-14 transition-transform duration-300 sm:h-16 sm:w-16',
              connected && 'scale-110 drop-shadow-[0_0_14px_var(--glow)]'
            )}
            strokeWidth={1.6}
          />
        )}
      </motion.button>
    </div>
  )
}
