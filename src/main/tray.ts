import { Menu, Tray, app, nativeImage, nativeTheme } from 'electron'
import { APP_NAME, PROVIDER_META } from '../shared/constants'
import type { AppSettings, TraySummary } from '../shared/types'
import { formatMacTrayTitle, renderBatteryIconPng } from './trayIcon'

export interface TrayCallbacks {
  onTogglePopover: () => void
  onOpenPopover: () => void
  onRefresh: () => void
}

function createTrayNativeImage(summary: TraySummary, isDarkTheme: boolean): Electron.NativeImage {
  const image = nativeImage.createEmpty()

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

  image.addRepresentation({
    scaleFactor: 1,
    width: 24,
    height: 16,
    buffer: png1x
  })
  image.addRepresentation({
    scaleFactor: 2,
    width: 48,
    height: 32,
    buffer: png2x
  })

  return image
}

export class TrayManager {
  private readonly tray: Tray

  constructor(callbacks: TrayCallbacks) {
    const placeholder = createTrayNativeImage(
      {
        lowestRemainingPct: null,
        lowestProviderId: null,
        level: 'unknown',
        connectedCount: 0,
        enabledCount: 3
      },
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
    const icon = createTrayNativeImage(summary, isDark)
    this.tray.setImage(icon)

    if (process.platform === 'darwin') {
      const title = formatMacTrayTitle(summary, settings.showTrayPercentage)
      this.tray.setTitle(title, { fontType: 'monospacedDigit' })
    }

    if (summary.lowestRemainingPct !== null && summary.lowestProviderId !== null) {
      const providerName = PROVIDER_META[summary.lowestProviderId].name
      this.tray.setToolTip(`${APP_NAME} · 최저 ${summary.lowestRemainingPct}% (${providerName})`)
    } else {
      this.tray.setToolTip(`${APP_NAME} · 연동 대기 중`)
    }
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) {
      this.tray.destroy()
    }
  }
}
