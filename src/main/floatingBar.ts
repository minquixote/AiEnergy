import { fileURLToPath } from 'node:url'
import { BrowserWindow, Menu, app, screen } from 'electron'
import { APP_NAME } from '../shared/constants'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppSnapshot, FloatingBarPosition } from '../shared/types'
import type { Rect } from './popoverBounds'
import type { AppStore } from './store'

export interface FloatingBarCallbacks {
  onTogglePopover: (anchorBounds: Rect | null) => void
  onOpenPopover: (anchorBounds: Rect | null) => void
  onRefresh: () => void
  onHideFloatingBar: () => void
}

const DEFAULT_WIDTH = 228
const DEFAULT_HEIGHT = 36
const EDGE_MARGIN = 12

function clampPositionToWorkArea(
  pos: FloatingBarPosition,
  width: number,
  height: number
): FloatingBarPosition {
  const display = screen.getDisplayMatching({
    x: pos.x,
    y: pos.y,
    width: Math.max(1, width),
    height: Math.max(1, height)
  })
  const wa = display.workArea
  const minX = wa.x + 4
  const maxX = Math.max(minX, wa.x + wa.width - width - 4)
  const minY = wa.y + 4
  const maxY = Math.max(minY, wa.y + wa.height - height - 4)

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, pos.y)))
  }
}

function getDefaultBottomRightPosition(width: number, height: number): FloatingBarPosition {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(wa.x + wa.width - width - EDGE_MARGIN),
    y: Math.round(wa.y + wa.height - height - EDGE_MARGIN)
  }
}

/**
 * Optional always-on-top draggable mini bar widget (primarily for Windows 10/11 where the
 * system tray restricts icons to 16x16 squares). Reuses the built React renderer bundle
 * with `?mode=floating-bar` so official brand SVG icons, glass battery capsules, and live
 * IPC updates stay 100% unified with zero extra build entries.
 */
export class FloatingBarManager {
  private readonly store: AppStore
  private readonly callbacks: FloatingBarCallbacks
  private window: BrowserWindow | null = null
  private currentWidth = DEFAULT_WIDTH
  private currentHeight = DEFAULT_HEIGHT
  private latestSnapshot: AppSnapshot | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private isLoaded = false
  private shouldBeVisible = false

  constructor(store: AppStore, callbacks: FloatingBarCallbacks) {
    this.store = store
    this.callbacks = callbacks
  }

  private createWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
    const rendererHtmlPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))

    const savedPos = this.store.getFloatingBarPosition()
    const initialPos = savedPos
      ? clampPositionToWorkArea(savedPos, this.currentWidth, this.currentHeight)
      : getDefaultBottomRightPosition(this.currentWidth, this.currentHeight)

    const win = new BrowserWindow({
      x: initialPos.x,
      y: initialPos.y,
      width: this.currentWidth,
      height: this.currentHeight,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      hasShadow: false,
      roundedCorners: true,
      focusable: false,
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
      win.setAlwaysOnTop(true, 'floating')
    } else {
      win.setAlwaysOnTop(true, 'floating')
    }

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

    win.on('moved', () => {
      if (win.isDestroyed()) return
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        if (win.isDestroyed()) return
        const b = win.getBounds()
        this.store.setFloatingBarPosition({ x: b.x, y: b.y })
      }, 220)
    })

    win.on('closed', () => {
      if (this.window === win) {
        this.window = null
        this.isLoaded = false
      }
    })

    win.webContents.once('did-finish-load', () => {
      this.isLoaded = true
      if (win.isDestroyed()) return
      if (this.latestSnapshot) {
        win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, this.latestSnapshot)
      }
      if (this.shouldBeVisible) {
        win.showInactive()
      }
    })

    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (!app.isPackaged && devServerUrl) {
      const sep = devServerUrl.includes('?') ? '&' : '?'
      void win.loadURL(`${devServerUrl}${sep}mode=floating-bar`)
    } else {
      void win.loadFile(rendererHtmlPath, { query: { mode: 'floating-bar' } })
    }

    this.window = win
    return win
  }

  sync(snapshot: AppSnapshot): void {
    this.latestSnapshot = snapshot
    const visible = snapshot.settings.showFloatingBar && snapshot.traySummary.items.length > 0
    this.shouldBeVisible = visible

    if (!visible) {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
        this.window.hide()
      }
      return
    }

    const win = this.createWindow()
    if (this.isLoaded && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot)
      if (!win.isVisible()) {
        win.showInactive()
      }
    }
  }

  resize(requestedWidth: number, requestedHeight: number): void {
    const win = this.window
    if (!win || win.isDestroyed()) return

    const nextW = Math.max(68, Math.min(360, Math.ceil(requestedWidth)))
    const nextH = Math.max(28, Math.min(48, Math.ceil(requestedHeight)))
    if (nextW === this.currentWidth && nextH === this.currentHeight) return

    const prevBounds = win.getBounds()
    const display = screen.getDisplayMatching(prevBounds)
    const wa = display.workArea

    // If the floating bar sits on the right half of the display, keep its right edge pinned smoothly
    const isRightHalf = prevBounds.x + prevBounds.width / 2 > wa.x + wa.width / 2
    const nextX = isRightHalf ? prevBounds.x + (prevBounds.width - nextW) : prevBounds.x
    const clamped = clampPositionToWorkArea({ x: nextX, y: prevBounds.y }, nextW, nextH)

    this.currentWidth = nextW
    this.currentHeight = nextH
    win.setBounds({ x: clamped.x, y: clamped.y, width: nextW, height: nextH }, false)
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
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
    this.isLoaded = false
  }
}
