import { Menu, Tray, app, nativeImage, nativeTheme } from 'electron'
import { APP_NAME, PROVIDER_META } from '../shared/constants'
import type { AppSettings, ProviderId, TraySummary } from '../shared/types'
import { TrayCanvasRenderer } from './trayCanvasRenderer'
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

function createFallbackTrayNativeImage(
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
  private readonly canvasRenderer = new TrayCanvasRenderer()
  private renderSeq = 0
  private hasCanvasRendered = false

  constructor(callbacks: TrayCallbacks) {
    const placeholder = createFallbackTrayNativeImage(
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
    if (this.tray.isDestroyed()) return

    const isDark = nativeTheme.shouldUseDarkColors
    const showPercentage = settings.showTrayPercentage

    // Percentage numbers are drawn inside each platform's battery graphic
    if (process.platform === 'darwin') {
      this.tray.setTitle('')
    }

    this.tray.setToolTip(formatTrayTooltip(APP_NAME, summary.items, PROVIDER_NAMES))

    // Windows compact tray slot or empty-provider state uses fast synchronous PNG icon
    if (process.platform === 'win32' || summary.items.length === 0) {
      this.renderSeq += 1
      this.hasCanvasRendered = false
      const icon = createFallbackTrayNativeImage(summary, showPercentage, isDark)
      this.tray.setImage(icon)
      return
    }

    // Show immediate fallback only before the first Skia canvas frame has rendered
    if (!this.hasCanvasRendered) {
      const initialIcon = createFallbackTrayNativeImage(summary, showPercentage, isDark)
      this.tray.setImage(initialIcon)
    }

    const seq = ++this.renderSeq
    const itemsSnapshot = summary.items.map((item) => ({ ...item }))

    void this.canvasRenderer
      .renderMultiProviderTray({
        items: itemsSnapshot,
        showPercentage,
        isDarkTheme: isDark
      })
      .then((rendered) => {
        if (seq !== this.renderSeq || this.tray.isDestroyed()) return

        if (!rendered) {
          const fallback = createFallbackTrayNativeImage(summary, showPercentage, isDark)
          this.tray.setImage(fallback)
          return
        }

        const image = nativeImage.createEmpty()
        image.addRepresentation({ scaleFactor: 1, buffer: rendered.png1x })
        image.addRepresentation({ scaleFactor: 2, buffer: rendered.png2x })
        this.hasCanvasRendered = true
        this.tray.setImage(image)
      })
      .catch(() => {
        if (seq !== this.renderSeq || this.tray.isDestroyed()) return
        const fallback = createFallbackTrayNativeImage(summary, showPercentage, isDark)
        this.tray.setImage(fallback)
      })
  }

  destroy(): void {
    this.renderSeq += 1
    this.canvasRenderer.dispose()
    if (!this.tray.isDestroyed()) {
      this.tray.destroy()
    }
  }
}
