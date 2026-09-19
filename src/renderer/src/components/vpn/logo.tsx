// ============================================================
// M3tr0VPN — логотип (бандлится Vite из ассетов)
// ============================================================

import logoUrl from '@renderer/assets/m3tr0vpn-logo.png'

export function Logo({ className }: { className?: string }): React.JSX.Element {
  return <img src={logoUrl} alt="" draggable={false} className={className} />
}
