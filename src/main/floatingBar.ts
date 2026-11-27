import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, screen } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppSnapshot, DebugLogLevel, FloatingBarPosition } from '../shared/types'
import {
  FLOATING_BAR_DEFAULTS,
  clampFloatingBarPosition,
  getDefaultFloatingBarPosition,
  isFloatingBarOverlappingTaskbar,
  isFloatingBarVisibleOnWorkAreas
} from './floatingBarBounds'
import type { Rect } from './popoverBounds'
import type { AppStore } from './store'

export interface FloatingBarCallbacks {
  onTogglePopover: (anchorBounds: Rect | null) => void
  onOpenPopover: (anchorBounds: Rect | null) => void
  onRefresh: () => void
  onHideFloatingBar: () => void
  isPopoverVisible?: () => boolean
  onDiagnostic?: (level: DebugLogLevel, message: string) => void
}

const TASKBAR_GUARD_INTERVAL_MS = 300
const DESKTOP_GUARD_INTERVAL_MS = 1500
const BLUR_REASSERT_DELAYS_MS = [20, 110, 260] as const

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
  // Validate against full display bounds (including taskbar) so users who drag the mini bar
  // onto the Windows 11 taskbar keep that position across restarts.
  const fullBoundsList = displays.map((d) => d.bounds)

  if (savedPos && isFloatingBarVisibleOnWorkAreas(savedPos, width, height, fullBoundsList)) {
    const display = screen.getDisplayMatching({
      x: savedPos.x,
      y: savedPos.y,
      width: Math.max(1, width),
      height: Math.max(1, height)
    })
    return clampFloatingBarPosition(savedPos, width, height, display.bounds, 0)
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
  private topmostGuardTimer: NodeJS.Timeout | null = null
  private topmostGuardIntervalMs = 0
  private blurReassertTimers: NodeJS.Timeout[] = []
  private isLoaded = false
  private hasRevealed = false
  private shouldBeVisible = false
  private isProgrammaticMove = false
  private isContextMenuOpen = false
  private wasOverTaskbar = false
  private readonly handleDisplayChange: () => void

  constructor(store: AppStore, callbacks: FloatingBarCallbacks) {
    this.store = store
    this.callbacks = callbacks
    this.handleDisplayChange = () => {
      this.ensureWindowOnScreen()
      this.syncTopmostGuard()
    }
    screen.on('display-metrics-changed', this.handleDisplayChange)
    screen.on('display-removed', this.handleDisplayChange)
  }

  private logDiagnostic(level: DebugLogLevel, message: string): void {
    this.callbacks.onDiagnostic?.(level, message)
  }

  private isCurrentlyOverTaskbar(win: BrowserWindow): boolean {
    if (win.isDestroyed()) return false
    const bounds = win.getBounds()
    const display = screen.getDisplayMatching(bounds)
    return isFloatingBarOverlappingTaskbar(bounds, display.bounds, display.workArea)
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

  private reassertTopmost(win: BrowserWindow, forceReapplyFlag: boolean = false): void {
    if (process.platform !== 'win32') return
    if (win.isDestroyed() || !this.shouldBeVisible) return
    if (this.isContextMenuOpen || this.callbacks.isPopoverVisible?.()) return

    if (win.isMinimized()) {
      win.restore()
      win.showInactive()
    }

    if (!win.isVisible()) return
    if (win.isFocused()) return

    if (forceReapplyFlag || !win.isAlwaysOnTop()) {
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    // Win32 SetWindowPos(hwnd, HWND_TOP, SWP_NOACTIVATE): raises our HWND_TOPMOST window back
    // above Shell_TrayWnd (Windows 11 taskbar) without stealing focus or disrupting input.
    win.moveTop()
  }

  private clearBlurReassertTimers(): void {
    for (const t of this.blurReassertTimers) {
      clearTimeout(t)
    }
    this.blurReassertTimers = []
  }

  private scheduleBlurReassert(win: BrowserWindow): void {
    if (process.platform !== 'win32') return
    this.clearBlurReassertTimers()
    for (const delayMs of BLUR_REASSERT_DELAYS_MS) {
      const timer = setTimeout(() => {
        if (!win.isDestroyed()) {
          this.reassertTopmost(win, true)
        }
      }, delayMs)
      this.blurReassertTimers.push(timer)
    }
  }

  private stopTopmostGuard(): void {
    if (this.topmostGuardTimer) {
      clearInterval(this.topmostGuardTimer)
      this.topmostGuardTimer = null
    }
    this.topmostGuardIntervalMs = 0
    this.clearBlurReassertTimers()
  }

  private syncTopmostGuard(): void {
    if (process.platform !== 'win32') return
    const win = this.window
    if (!this.shouldBeVisible || !win || win.isDestroyed()) {
      this.stopTopmostGuard()
      return
    }

    const overTaskbar = this.isCurrentlyOverTaskbar(win)
    if (overTaskbar && !this.wasOverTaskbar) {
      this.wasOverTaskbar = true
      this.logDiagnostic(
        'info',
        `미니 바 작업표시줄 영역 배치 감지 (${formatBounds(win.getBounds())}) — 최상위 유지 강화 활성`
      )
    } else if (!overTaskbar && this.wasOverTaskbar) {
      this.wasOverTaskbar = false
    }

    const desiredInterval = overTaskbar ? TASKBAR_GUARD_INTERVAL_MS : DESKTOP_GUARD_INTERVAL_MS
    if (this.topmostGuardTimer && this.topmostGuardIntervalMs === desiredInterval) {
      return
    }

    if (this.topmostGuardTimer) {
      clearInterval(this.topmostGuardTimer)
    }

    this.topmostGuardIntervalMs = desiredInterval
    let tickCount = 0
    this.topmostGuardTimer = setInterval(() => {
      const currentWin = this.window
      if (!currentWin || currentWin.isDestroyed() || !this.shouldBeVisible) {
        this.stopTopmostGuard()
        return
      }
      tickCount += 1
      // Re-apply screen-saver flag periodically in case explorer/OS reset topmost flags
      const forceFlag = overTaskbar && tickCount % 10 === 0
      this.reassertTopmost(currentWin, forceFlag)
    }, desiredInterval)
  }

  private applyBoundsProgrammatically(win: BrowserWindow, nextBounds: Rect): void {
    if (win.isDestroyed()) return
    this.isProgrammaticMove = true
    if (this.programmaticMoveTimer) clearTimeout(this.programmaticMoveTimer)

    try {
      // Avoid toggling setResizable(true/false) on transparent Windows BrowserWindow,
      // which can trigger DPI height drift or break layered transparency.
      win.setBounds(nextBounds, false)
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
    const fullBoundsList = displays.map((d) => d.bounds)
    if (
      isFloatingBarVisibleOnWorkAreas({ x: cur.x, y: cur.y }, cur.width, cur.height, fullBoundsList)
    ) {
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
    this.syncTopmostGuard()

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
        this.syncTopmostGuard()
      }, 220)
    })

    win.on('blur', () => {
      if (win.isDestroyed() || !this.shouldBeVisible) return
      this.scheduleBlurReassert(win)
    })

    win.on('minimize', () => {
      if (process.platform !== 'win32' || win.isDestroyed() || !this.shouldBeVisible) return
      setTimeout(() => {
        if (!win.isDestroyed() && this.shouldBeVisible) {
          this.reassertTopmost(win, true)
        }
      }, 50)
    })

    win.on('closed', () => {
      if (this.window === win) {
        this.stopTopmostGuard()
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
      this.stopTopmostGuard()
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

  notifyPopoverClosed(): void {
    const win = this.window
    if (win && !win.isDestroyed() && this.shouldBeVisible) {
      this.scheduleBlurReassert(win)
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
    const area = display.bounds

    // If the floating bar sits on the right half of the display, keep its right edge pinned smoothly
    const isRightHalf = prevBounds.x + prevBounds.width / 2 > area.x + area.width / 2
    const nextX = isRightHalf ? prevBounds.x + (prevBounds.width - nextW) : prevBounds.x
    const clamped = clampFloatingBarPosition({ x: nextX, y: prevBounds.y }, nextW, nextH, area, 0)

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
        label: `${APP_NAME} 정보`,
        click: () => app.showAboutPanel()
      },
      {
        label: `${APP_NAME} 종료`,
        click: () => app.quit()
      }
    ])

    this.isContextMenuOpen = true
    menu.popup({
      window: win,
      callback: () => {
        this.isContextMenuOpen = false
        if (!win.isDestroyed() && this.shouldBeVisible) {
          this.scheduleBlurReassert(win)
        }
      }
    })
  }

  triggerTogglePopover(): void {
    this.callbacks.onTogglePopover(this.getBounds())
  }

  destroy(): void {
    screen.removeListener('display-metrics-changed', this.handleDisplayChange)
    screen.removeListener('display-removed', this.handleDisplayChange)
    this.stopTopmostGuard()
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
