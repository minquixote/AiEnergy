import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, screen } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppSnapshot, DebugLogLevel, FloatingBarPosition } from '../shared/types'
import {
  FLOATING_BAR_DEFAULTS,
  clampFloatingBarPosition,
  getDefaultFloatingBarPosition,
  isFloatingBarVisibleOnWorkAreas
} from './floatingBarBounds'
import type { Rect } from './popoverBounds'
import type { AppStore } from './store'

export interface FloatingBarCallbacks {
  onTogglePopover: (anchorBounds: Rect | null) => void
  onOpenPopover: (anchorBounds: Rect | null) => void
  onRefresh: () => void
  onHideFloatingBar: () => void
  onDiagnostic?: (level: DebugLogLevel, message: string) => void
}

function getWorkAreaForPoint(point?: { x: number; y: number } | null): Rect {
  try {
    const display = point
      ? screen.getDisplayNearestPoint(point)
      : screen.getPrimaryDisplay()
    return display.workArea
  } catch {
    return screen.getPrimaryDisplay().workArea
  }
}

function resolveInitialPosition(
  savedPos: FloatingBarPosition | null,
  width: number,
  height: number
): FloatingBarPosition {
  const displays = screen.getAllDisplays()
  const workAreas = displays.map((d) => d.workArea)

  if (savedPos && isFloatingBarVisibleOnWorkAreas(savedPos, width, height, workAreas)) {
    const display = screen.getDisplayMatching({
      x: savedPos.x,
      y: savedPos.y,
      width: Math.max(1, width),
      height: Math.max(1, height)
    })
    return clampFloatingBarPosition(savedPos, width, height, display.workArea)
  }

  return getDefaultFloatingBarPosition(width, height, screen.getPrimaryDisplay().workArea)
}

function formatBounds(bounds: Rect): string {
  return `${bounds.width}x${bounds.height}@(${bounds.x},${bounds.y})`
}

/**
 * Optional always-on-top draggable mini bar widget (primarily for Windows 10/11 where the
 * system tray restricts icons to 16x16 squares). Reuses the built React renderer bundle
 * and identifies itself via sandboxed `additionalArguments` (`--ai-energy-window=floating-bar`)
 * so packaged `app.asar` loads use the exact same plain `loadFile()` path as the popover.
 */
export class FloatingBarManager {
  private readonly store: AppStore
  private readonly callbacks: FloatingBarCallbacks
  private window: BrowserWindow | null = null
  private currentWidth: number = FLOATING_BAR_DEFAULTS.WIDTH
  private currentHeight: number = FLOATING_BAR_DEFAULTS.HEIGHT
  private latestSnapshot: AppSnapshot | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private revealFallbackTimer: NodeJS.Timeout | null = null
  private programmaticMoveTimer: NodeJS.Timeout | null = null
  private isLoaded = false
  private hasRevealed = false
  private shouldBeVisible = false
  private isProgrammaticMove = false
  private readonly handleDisplayChange: () => void

  constructor(store: AppStore, callbacks: FloatingBarCallbacks) {
    this.store = store
    this.callbacks = callbacks
    this.handleDisplayChange = () => {
      this.ensureWindowOnScreen()
    }
    screen.on('display-metrics-changed', this.handleDisplayChange)
    screen.on('display-removed', this.handleDisplayChange)
  }

  private logDiagnostic(level: DebugLogLevel, message: string): void {
    this.callbacks.onDiagnostic?.(level, message)
  }

  private applyAlwaysOnTop(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setAlwaysOnTop(true, 'floating')
    } else if (process.platform === 'win32') {
      // On Windows, 'floating' places the window behind Shell_TrayWnd and can drop WS_EX_TOPMOST;
      // 'screen-saver' keeps reliable HWND_TOPMOST above normal apps and taskbar.
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      win.setAlwaysOnTop(true, 'floating')
    }
  }

  private applyBoundsProgrammatically(win: BrowserWindow, nextBounds: Rect): void {
    if (win.isDestroyed()) return
    this.isProgrammaticMove = true
    if (this.programmaticMoveTimer) clearTimeout(this.programmaticMoveTimer)

    try {
      const wasResizable = win.isResizable()
      if (!wasResizable) {
        win.setResizable(true)
      }
      win.setMinimumSize(FLOATING_BAR_DEFAULTS.MIN_WIDTH, FLOATING_BAR_DEFAULTS.MIN_HEIGHT)
      win.setBounds(nextBounds, false)
      if (!wasResizable) {
        win.setResizable(false)
      }
    } finally {
      this.programmaticMoveTimer = setTimeout(() => {
        this.isProgrammaticMove = false
        this.programmaticMoveTimer = null
      }, 150)
    }
  }

  private ensureWindowOnScreen(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const cur = win.getBounds()
    const displays = screen.getAllDisplays()
    const workAreas = displays.map((d) => d.workArea)
    if (isFloatingBarVisibleOnWorkAreas({ x: cur.x, y: cur.y }, cur.width, cur.height, workAreas)) {
      return
    }
    const rescued = getDefaultFloatingBarPosition(
      this.currentWidth,
      this.currentHeight,
      screen.getPrimaryDisplay().workArea
    )
    this.applyBoundsProgrammatically(win, {
      x: rescued.x,
      y: rescued.y,
      width: this.currentWidth,
      height: this.currentHeight
    })
    this.store.setFloatingBarPosition(rescued)
    this.logDiagnostic('info', `미니 바 화면 밖 좌표 복구 -> ${formatBounds(win.getBounds())}`)
  }

  private revealWindow(win: BrowserWindow, reason: string): void {
    if (win.isDestroyed() || !this.shouldBeVisible) return
    if (this.revealFallbackTimer) {
      clearTimeout(this.revealFallbackTimer)
      this.revealFallbackTimer = null
    }

    this.ensureWindowOnScreen()
    this.applyAlwaysOnTop(win)
    win.setOpacity(1)
    win.showInactive()
    if (process.platform === 'win32') {
      win.moveTop()
    }
    this.hasRevealed = true

    const actual = win.getBounds()
    const display = screen.getDisplayMatching(actual)
    this.logDiagnostic(
      'info',
      `미니 바 표시 (${reason}): visible=${win.isVisible()}, bounds=${formatBounds(actual)}, display=${formatBounds(display.workArea)}@${display.scaleFactor}x`
    )
  }

  private createWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
    const rendererHtmlPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))

    const savedPos = this.store.getFloatingBarPosition()
    const initialPos = resolveInitialPosition(savedPos, this.currentWidth, this.currentHeight)
    const primary = screen.getPrimaryDisplay()

    const win = new BrowserWindow({
      x: initialPos.x,
      y: initialPos.y,
      width: this.currentWidth,
      height: this.currentHeight,
      minWidth: FLOATING_BAR_DEFAULTS.MIN_WIDTH,
      minHeight: FLOATING_BAR_DEFAULTS.MIN_HEIGHT,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      hasShadow: false,
      roundedCorners: false,
      backgroundColor: '#00000000',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: ['--ai-energy-window=floating-bar']
      }
    })

    this.applyAlwaysOnTop(win)
    this.hasRevealed = false

    this.logDiagnostic(
      'info',
      `미니 바 창 생성: target=${formatBounds({ x: initialPos.x, y: initialPos.y, width: this.currentWidth, height: this.currentHeight })}, primary=${formatBounds(primary.workArea)}@${primary.scaleFactor}x`
    )

    win.on('moved', () => {
      if (win.isDestroyed() || !win.isVisible() || this.isProgrammaticMove) return
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        if (win.isDestroyed() || !win.isVisible() || this.isProgrammaticMove) return
        const b = win.getBounds()
        this.store.setFloatingBarPosition({ x: b.x, y: b.y })
      }, 220)
    })

    win.on('closed', () => {
      if (this.window === win) {
        this.window = null
        this.isLoaded = false
        this.hasRevealed = false
      }
    })

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      if (this.shouldBeVisible && !this.hasRevealed) {
        this.revealWindow(win, 'ready-to-show')
      }
    })

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.logDiagnostic(
        'error',
        `미니 바 로드 실패 (${errorCode}): ${errorDescription} [${validatedURL}]`
      )
    })

    win.webContents.on('render-process-gone', (_event, details) => {
      this.logDiagnostic(
        'error',
        `미니 바 렌더러 비정상 종료: reason=${details.reason}, exitCode=${details.exitCode}`
      )
    })

    win.webContents.once('did-finish-load', () => {
      this.isLoaded = true
      if (win.isDestroyed()) return
      if (this.latestSnapshot) {
        win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, this.latestSnapshot)
      }
      if (this.shouldBeVisible && !this.hasRevealed) {
        this.revealFallbackTimer = setTimeout(() => {
          this.revealFallbackTimer = null
          if (!win.isDestroyed() && this.shouldBeVisible && !this.hasRevealed) {
            this.revealWindow(win, 'did-finish-load')
          }
        }, 120)
      }
    })

    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    const loadPromise =
      !app.isPackaged && devServerUrl
        ? win.loadURL(`${devServerUrl}${devServerUrl.includes('?') ? '&' : '?'}mode=floating-bar`)
        : win.loadFile(rendererHtmlPath)

    void loadPromise.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.logDiagnostic('error', `미니 바 페이지 로드 예외: ${msg}`)
    })

    this.window = win
    return win
  }

  sync(snapshot: AppSnapshot): void {
    this.latestSnapshot = snapshot
    const visible = snapshot.settings.showFloatingBar && snapshot.traySummary.items.length > 0
    const becameVisible = visible && !this.shouldBeVisible
    this.shouldBeVisible = visible

    if (!visible) {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
        this.window.hide()
        this.hasRevealed = false
      }
      return
    }

    const win = this.createWindow()
    if (this.isLoaded && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot)
      if (!win.isVisible() || becameVisible) {
        this.revealWindow(win, becameVisible ? 'toggle-on' : 'sync')
      }
    }
  }

  resize(requestedWidth: number, requestedHeight: number): void {
    const win = this.window
    if (!win || win.isDestroyed()) return

    const nextW = Math.max(
      FLOATING_BAR_DEFAULTS.MIN_WIDTH,
      Math.min(FLOATING_BAR_DEFAULTS.MAX_WIDTH, Math.ceil(requestedWidth))
    )
    const nextH = Math.max(
      FLOATING_BAR_DEFAULTS.MIN_HEIGHT,
      Math.min(FLOATING_BAR_DEFAULTS.MAX_HEIGHT, Math.ceil(requestedHeight))
    )
    if (nextW === this.currentWidth && nextH === this.currentHeight) return

    const prevBounds = win.getBounds()
    const display = screen.getDisplayMatching(prevBounds)
    const wa = display.workArea

    // If the floating bar sits on the right half of the display, keep its right edge pinned smoothly
    const isRightHalf = prevBounds.x + prevBounds.width / 2 > wa.x + wa.width / 2
    const nextX = isRightHalf ? prevBounds.x + (prevBounds.width - nextW) : prevBounds.x
    const clamped = clampFloatingBarPosition({ x: nextX, y: prevBounds.y }, nextW, nextH, wa)

    this.currentWidth = nextW
    this.currentHeight = nextH
    this.applyBoundsProgrammatically(win, {
      x: clamped.x,
      y: clamped.y,
      width: nextW,
      height: nextH
    })
  }

  resetPosition(anchorPoint?: { x: number; y: number } | null): void {
    this.store.setFloatingBarPosition(null)
    const workArea = getWorkAreaForPoint(anchorPoint ?? screen.getCursorScreenPoint())
    const nextPos = getDefaultFloatingBarPosition(this.currentWidth, this.currentHeight, workArea)

    if (!this.shouldBeVisible) {
      return
    }

    const win = this.createWindow()
    if (win.isDestroyed()) return

    this.applyBoundsProgrammatically(win, {
      x: nextPos.x,
      y: nextPos.y,
      width: this.currentWidth,
      height: this.currentHeight
    })
    if (this.isLoaded) {
      this.revealWindow(win, 'reset-position')
    }
  }

  getBounds(): Rect | null {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return null
    }
    return this.window.getBounds()
  }

  openContextMenu(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return

    const menu = Menu.buildFromTemplate([
      {
        label: '위젯 열기',
        click: () => this.callbacks.onOpenPopover(this.getBounds())
      },
      {
        label: '지금 새로고침',
        click: () => this.callbacks.onRefresh()
      },
      { type: 'separator' },
      {
        label: '미니 바 위치 초기화',
        click: () => this.resetPosition(screen.getCursorScreenPoint())
      },
      {
        label: '미니 바 숨기기',
        click: () => this.callbacks.onHideFloatingBar()
      },
      { type: 'separator' },
      {
        label: `${APP_NAME} 종료`,
        click: () => app.quit()
      }
    ])

    menu.popup({ window: win })
  }

  triggerTogglePopover(): void {
    this.callbacks.onTogglePopover(this.getBounds())
  }

  destroy(): void {
    screen.removeListener('display-metrics-changed', this.handleDisplayChange)
    screen.removeListener('display-removed', this.handleDisplayChange)
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.revealFallbackTimer) {
      clearTimeout(this.revealFallbackTimer)
      this.revealFallbackTimer = null
    }
    if (this.programmaticMoveTimer) {
      clearTimeout(this.programmaticMoveTimer)
      this.programmaticMoveTimer = null
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
    this.isLoaded = false
    this.hasRevealed = false
  }
}
