import { Menu, Tray, app, nativeImage, nativeTheme } from 'electron'
import { APP_NAME, PROVIDER_META } from '../shared/constants'
import type { AppSettings, ProviderId, TraySummary } from '../shared/types'
import {
  formatTrayTooltip,
  renderBatteryIconPng,
  renderMultiProviderTrayPng
} from './trayIcon'

export interface TrayCallbacks {
  onTogglePopover: () => void
  onOpenPopover: () => void
  onRefresh: () => void
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  chatgpt: PROVIDER_META.chatgpt.name,
  gemini: PROVIDER_META.gemini.name,
  claude: PROVIDER_META.claude.name
}

function createTrayNativeImage(
  summary: TraySummary,
  showPercentage: boolean,
  isDarkTheme: boolean
): Electron.NativeImage {
  const image = nativeImage.createEmpty()

  // Windows system tray enforces a square 16x16 slot, so use compact summary battery there;
  // macOS menu bar natively renders wide multi-platform Retina strips cleanly.
  if (process.platform === 'win32') {
    const png1x = renderBatteryIconPng({
      percentage: summary.lowestRemainingPct,
      level: summary.level,
      isDarkTheme,
      scale: 1
    })
    const png2x = renderBatteryIconPng({
      percentage: summary.lowestRemainingPct,
      level: summary.level,
      isDarkTheme,
      scale: 2
    })
    image.addRepresentation({ scaleFactor: 1, buffer: png1x })
    image.addRepresentation({ scaleFactor: 2, buffer: png2x })
    return image
  }

  const r1x = renderMultiProviderTrayPng({
    items: summary.items,
    showPercentage,
    isDarkTheme,
    scale: 1
  })
  const r2x = renderMultiProviderTrayPng({
    items: summary.items,
    showPercentage,
    isDarkTheme,
    scale: 2
  })

  image.addRepresentation({ scaleFactor: 1, buffer: r1x.png })
  image.addRepresentation({ scaleFactor: 2, buffer: r2x.png })

  return image
}

export class TrayManager {
  private readonly tray: Tray

  constructor(callbacks: TrayCallbacks) {
    const placeholder = createTrayNativeImage(
      {
        items: [],
        lowestRemainingPct: null,
        lowestProviderId: null,
        level: 'unknown',
        connectedCount: 0,
        enabledCount: 0
      },
      true,
      nativeTheme.shouldUseDarkColors
    )

    this.tray = new Tray(placeholder)
    this.tray.setToolTip(APP_NAME)

    this.tray.on('click', () => {
      callbacks.onTogglePopover()
    })

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '위젯 열기',
        click: () => callbacks.onOpenPopover()
      },
      {
        label: '지금 새로고침',
        click: () => callbacks.onRefresh()
      },
      { type: 'separator' },
      {
        label: `${APP_NAME} 종료`,
        click: () => app.quit()
      }
    ])

    this.tray.on('right-click', () => {
      this.tray.popUpContextMenu(contextMenu)
    })
  }

  getTray(): Tray {
    return this.tray
  }

  update(summary: TraySummary, settings: AppSettings): void {
    const isDark = nativeTheme.shouldUseDarkColors
    const icon = createTrayNativeImage(summary, settings.showTrayPercentage, isDark)
    this.tray.setImage(icon)

    // Percentage numbers are now drawn inside each platform's battery graphic
    if (process.platform === 'darwin') {
      this.tray.setTitle('')
    }

    this.tray.setToolTip(formatTrayTooltip(APP_NAME, summary.items, PROVIDER_NAMES))
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) {
      this.tray.destroy()
    }
  }
}
