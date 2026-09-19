// ============================================================
// M3tr0VPN — каталог популярных приложений для исключений
// и маппинг «имя иконки из store → компонент lucide»
// (порт из веб-прототипа)
// ============================================================

import {
  AppWindow,
  Briefcase,
  Building2,
  Compass,
  Download,
  Flame,
  Gamepad,
  Gamepad2,
  Globe,
  Landmark,
  MessageCircle,
  MessageSquare,
  MonitorSmartphone,
  Music,
  Send,
  Users,
  Video,
  type LucideIcon
} from 'lucide-react'

export interface CatalogApp {
  /** Имя процесса в Windows */
  appId: string
  appName: string
  /** Имя иконки lucide (хранится в store) */
  icon: string
}

export const APP_CATALOG: CatalogApp[] = [
  { appId: 'chrome.exe', appName: 'Chrome', icon: 'globe' },
  { appId: 'firefox.exe', appName: 'Firefox', icon: 'flame' },
  { appId: 'msedge.exe', appName: 'Edge', icon: 'compass' },
  { appId: 'Telegram.exe', appName: 'Telegram', icon: 'send' },
  { appId: 'Discord.exe', appName: 'Discord', icon: 'message-square' },
  { appId: 'WhatsApp.exe', appName: 'WhatsApp', icon: 'message-circle' },
  { appId: 'qbittorrent.exe', appName: 'qBittorrent', icon: 'download' },
  { appId: 'uTorrent.exe', appName: 'µTorrent', icon: 'download' },
  { appId: 'steam.exe', appName: 'Steam', icon: 'gamepad-2' },
  { appId: 'EpicGamesLauncher.exe', appName: 'Epic Games', icon: 'gamepad' },
  { appId: 'anydesk.exe', appName: 'AnyDesk', icon: 'monitor-smartphone' },
  { appId: 'TeamViewer.exe', appName: 'TeamViewer', icon: 'users' },
  { appId: 'Zoom.exe', appName: 'Zoom', icon: 'video' },
  { appId: 'Spotify.exe', appName: 'Spotify', icon: 'music' },
  { appId: 'sberbank.exe', appName: 'СберБанк', icon: 'landmark' },
  { appId: 'gosuslugi.exe', appName: 'Госуслуги', icon: 'building-2' },
  { appId: 'VK.exe', appName: 'VK', icon: 'users' },
  { appId: '1cv8.exe', appName: '1С:Предприятие', icon: 'briefcase' }
]

const iconMap: Record<string, LucideIcon> = {
  globe: Globe,
  flame: Flame,
  compass: Compass,
  send: Send,
  'message-square': MessageSquare,
  'message-circle': MessageCircle,
  download: Download,
  'gamepad-2': Gamepad2,
  gamepad: Gamepad,
  'monitor-smartphone': MonitorSmartphone,
  users: Users,
  video: Video,
  music: Music,
  landmark: Landmark,
  'building-2': Building2,
  briefcase: Briefcase,
  'app-window': AppWindow
}

export function AppIcon({ icon, className }: { icon: string; className?: string }): React.JSX.Element {
  const Icon = iconMap[icon] ?? AppWindow
  return <Icon className={className} aria-hidden />
}
