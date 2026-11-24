import { fileURLToPath } from 'node:url'
import { BrowserWindow, app, screen, type Tray } from 'electron'
import { POPOVER_DIMENSIONS } from '../shared/constants'
import { computePopoverBounds } from './popoverBounds'

const BLUR_TOGGLE_DEBOUNCE_MS = 220

export class PopoverManager {
  private window: BrowserWindow | null = null
  private lastHiddenAt = 0
  private currentHeight: number = POPOVER_DIMENSIONS.INITIAL_HEIGHT
  private tray: Tray | null = null

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
    }

    win.on('blur', () => {
      if (!win.webContents.isDevToolsOpened()) {
        this.hide()
      }
    })

    win.on('closed', () => {
      this.window = null
    })

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      const isAppResource =
        details.url.startsWith('file://') ||
        details.url.startsWith('http://localhost:') ||
        details.url.startsWith('http://127.0.0.1:')
      if (!isAppResource) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      const csp = app.isPackaged
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
        : "default-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*; style-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*; img-src 'self' data: http://localhost:* http://127.0.0.1:*"

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
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

  toggle(): void {
    const win = this.getWindow() ?? this.createWindow()
    if (win.isVisible()) {
      this.hide()
      return
    }
    // Avoid immediate reopen when macOS/Windows fires blur right before tray click
    if (Date.now() - this.lastHiddenAt < BLUR_TOGGLE_DEBOUNCE_MS) {
      return
    }
    this.show()
  }

  show(): void {
    const win = this.getWindow() ?? this.createWindow()
    this.reposition(win)
    win.show()
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
    const trayBounds = this.tray
      ? this.tray.getBounds()
      : { x: 0, y: 0, width: 0, height: 0 }

    const display =
      trayBounds.width > 0 || trayBounds.height > 0
        ? screen.getDisplayMatching(trayBounds)
        : screen.getPrimaryDisplay()

    const bounds = computePopoverBounds(
      trayBounds,
      display.workArea,
      POPOVER_DIMENSIONS.WIDTH,
      this.currentHeight,
      process.platform
    )

    win.setBounds(bounds, false)
  }
}
