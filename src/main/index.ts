import { app } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import { registerIpcHandlers } from './ipc'
import { PopoverManager } from './popover'
import { EnergyCoordinator } from './scheduler'
import { AppStore } from './store'
import { TrayManager } from './tray'

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let popover: PopoverManager | null = null
  let tray: TrayManager | null = null
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

    tray = new TrayManager({
      onTogglePopover: () => popover?.toggle(),
      onOpenPopover: () => popover?.show(),
      onRefresh: () => {
        void coordinator?.refreshManual()
      }
    })

    popover.attachTray(tray.getTray())
    popover.createWindow()

    registerIpcHandlers(coordinator, popover)

    const initial = coordinator.getSnapshot()
    tray.update(initial.traySummary, initial.settings)

    coordinator.subscribe((snapshot) => {
      tray?.update(snapshot.traySummary, snapshot.settings)
      const win = popover?.getWindow()
      if (win && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SNAPSHOT_UPDATED, snapshot)
      }
    })
  })

  app.on('before-quit', () => {
    coordinator?.dispose()
    tray?.destroy()
  })
}
