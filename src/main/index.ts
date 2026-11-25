import { app } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import { FloatingBarManager } from './floatingBar'
import { registerIpcHandlers } from './ipc'
import { PopoverManager } from './popover'
import { EnergyCoordinator } from './scheduler'
import { AppStore } from './store'
import { TrayManager } from './tray'

if (process.platform === 'win32') {
  // Matches electron-builder appId so Windows 10/11 toast notifications show "AI Energy Bar" cleanly
  app.setAppUserModelId('com.aienergybar.app')
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let popover: PopoverManager | null = null
  let tray: TrayManager | null = null
  let floatingBar: FloatingBarManager | null = null
  let coordinator: EnergyCoordinator | null = null

  app.on('second-instance', () => {
    popover?.show()
  })

  // Keep menu bar / tray app running even when all windows are closed
  app.on('window-all-closed', () => {
    // Intentionally do nothing so the resident tray icon stays active
  })

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock?.hide()
    }

    const store = new AppStore()
    popover = new PopoverManager()
    coordinator = new EnergyCoordinator(store, {
      onNotificationClick: () => popover?.show()
    })

    floatingBar = new FloatingBarManager(store, {
      onTogglePopover: (anchorBounds) => popover?.toggle(anchorBounds),
      onOpenPopover: (anchorBounds) => popover?.show(anchorBounds),
      onRefresh: () => {
        void coordinator?.refreshManual()
      },
      onHideFloatingBar: () => {
        coordinator?.updateSettings({ showFloatingBar: false })
      }
    })

    tray = new TrayManager({
      onTogglePopover: () => popover?.toggle(),
      onOpenPopover: () => popover?.show(),
      onRefresh: () => {
        void coordinator?.refreshManual()
      },
      onToggleFloatingBar: (next) => {
        coordinator?.updateSettings({ showFloatingBar: next })
      }
    })

    popover.attachTray(tray.getTray())
    popover.createWindow()

    registerIpcHandlers(coordinator, popover, floatingBar)

    const initial = coordinator.getSnapshot()
    tray.update(initial.traySummary, initial.settings)
    floatingBar.sync(initial)

    coordinator.subscribe((snapshot) => {
      tray?.update(snapshot.traySummary, snapshot.settings)
      floatingBar?.sync(snapshot)
      const win = popover?.getWindow()
      if (win && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot)
      }
    })
  })

  app.on('before-quit', () => {
    coordinator?.dispose()
    floatingBar?.destroy()
    tray?.destroy()
  })
}
