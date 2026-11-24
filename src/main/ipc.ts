import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppSettings, MockScenarioId, ProviderId } from '../shared/types'
import type { PopoverManager } from './popover'
import type { EnergyCoordinator } from './scheduler'

export function registerIpcHandlers(
  coordinator: EnergyCoordinator,
  popover: PopoverManager
): void {
  ipcMain.handle(IPC_CHANNELS.GET_SNAPSHOT, () => {
    return coordinator.getSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.REFRESH_NOW, async () => {
    return coordinator.refreshManual()
  })

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, (_event, patch: Partial<AppSettings>) => {
    return coordinator.updateSettings(patch)
  })

  ipcMain.handle(IPC_CHANNELS.SET_MOCK_SCENARIO, (_event, scenario: MockScenarioId) => {
    return coordinator.setMockScenario(scenario)
  })

  ipcMain.handle(IPC_CHANNELS.OPEN_PROVIDER_LOGIN, (_event, providerId: ProviderId) => {
    popover.hide()
    return coordinator.openLogin(providerId)
  })

  ipcMain.handle(IPC_CHANNELS.DISCONNECT_PROVIDER, async (_event, providerId: ProviderId) => {
    return coordinator.disconnectProvider(providerId)
  })

  ipcMain.handle(IPC_CHANNELS.RESIZE_POPOVER, (_event, height: number) => {
    if (typeof height === 'number' && Number.isFinite(height)) {
      popover.resize(height)
    }
  })

  ipcMain.handle(IPC_CHANNELS.QUIT_APP, () => {
    app.quit()
  })
}
