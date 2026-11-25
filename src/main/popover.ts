import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, screen, type Tray } from 'electron'
import { POPOVER_DIMENSIONS } from '../shared/constants'
import { computePopoverBounds, type Rect } from './popoverBounds'

const BLUR_TOGGLE_DEBOUNCE_MS = 220

export class PopoverManager {
  private window: BrowserWindow | null = null
  private lastHiddenAt = 0
  private currentHeight: number = POPOVER_DIMENSIONS.INITIAL_HEIGHT
  private tray: Tray | null = null
  private lastAnchorBounds: Rect | null = null

  attachTray(tray: Tray): void {
    this.tray = tray
  }

  createWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
    const rendererHtmlPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))

    const win = new BrowserWindow({
      width: POPOVER_DIMENSIONS.WIDTH,
      minWidth: POPOVER_DIMENSIONS.WIDTH,
      maxWidth: POPOVER_DIMENSIONS.WIDTH,
      height: this.currentHeight,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      hasShadow: true,
      roundedCorners: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } else if (process.platform === 'win32') {
      win.setAlwaysOnTop(true, 'screen-saver')
    }

    win.on('blur', () => {
      if (!win.webContents.isDevToolsOpened()) {
        this.hide()
      }
    })

    win.on('closed', () => {
      this.window = null
    })

    if (!app.isPackaged) {
      win.once('ready-to-show', () => {
        this.show()
      })
    }

    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (!app.isPackaged && devServerUrl) {
      void win.loadURL(devServerUrl)
    } else {
      void win.loadFile(rendererHtmlPath)
    }

    this.window = win
    return win
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null
  }

  toggle(anchorBounds?: Rect | null): void {
    const win = this.getWindow() ?? this.createWindow()
    if (win.isVisible()) {
      this.hide()
      return
    }
    // Avoid immediate reopen when macOS/Windows fires blur right before tray/bar click
    if (Date.now() - this.lastHiddenAt < BLUR_TOGGLE_DEBOUNCE_MS) {
      return
    }
    this.show(anchorBounds)
  }

  show(anchorBounds?: Rect | null): void {
    const win = this.getWindow() ?? this.createWindow()
    this.lastAnchorBounds = anchorBounds ?? null
    this.reposition(win)
    if (process.platform === 'win32') {
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    win.show()
    if (process.platform === 'win32') {
      win.moveTop()
    }
    win.focus()
  }

  hide(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    this.lastHiddenAt = Date.now()
    win.hide()
  }

  resize(requestedHeight: number): void {
    const clamped = Math.max(
      POPOVER_DIMENSIONS.MIN_HEIGHT,
      Math.min(POPOVER_DIMENSIONS.MAX_HEIGHT, Math.ceil(requestedHeight))
    )
    if (clamped === this.currentHeight) return
    this.currentHeight = clamped

    const win = this.getWindow()
    if (!win) return
    this.reposition(win)
  }

  private reposition(win: BrowserWindow): void {
    const anchorBounds =
      this.lastAnchorBounds ??
      (this.tray ? this.tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 })

    const display =
      anchorBounds.width > 0 || anchorBounds.height > 0
        ? screen.getDisplayMatching(anchorBounds)
        : screen.getPrimaryDisplay()

    const bounds = computePopoverBounds(
      anchorBounds,
      display.workArea,
      POPOVER_DIMENSIONS.WIDTH,
      this.currentHeight,
      process.platform
    )

    win.setBounds(bounds, false)
  }
}
