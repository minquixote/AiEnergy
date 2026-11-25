import { app, clipboard, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AppSettings, MockScenarioId, ProviderId } from '../shared/types'
import type { PopoverManager } from './popover'
import type { EnergyCoordinator } from './scheduler'

const EXTERNAL_PROVIDER_URLS: Record<ProviderId, string> = {
  chatgpt: 'https://chatgpt.com/api/auth/session',
  gemini: 'https://gemini.google.com/usage',
  claude: 'https://claude.ai/settings/usage'
}

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

  ipcMain.handle(
    IPC_CHANNELS.IMPORT_PROVIDER_SESSION,
    async (_event, providerId: ProviderId, rawInput: string) => {
      return coordinator.importProviderSession(
        providerId,
        typeof rawInput === 'string' ? rawInput : ''
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL_PROVIDER_PAGE, async (_event, providerId: ProviderId) => {
    const url = EXTERNAL_PROVIDER_URLS[providerId]
    if (url) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC_CHANNELS.DISCONNECT_PROVIDER, async (_event, providerId: ProviderId) => {
    return coordinator.disconnectProvider(providerId)
  })

  ipcMain.handle(IPC_CHANNELS.GET_DEBUG_LOGS, () => {
    return coordinator.getDebugLogs()
  })

  ipcMain.handle(IPC_CHANNELS.CLEAR_DEBUG_LOGS, () => {
    return coordinator.clearDebugLogs()
  })

  ipcMain.handle(IPC_CHANNELS.COPY_DEBUG_LOGS, () => {
    const report = coordinator.formatDiagnosticsReport()
    clipboard.writeText(report)
    return true
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
