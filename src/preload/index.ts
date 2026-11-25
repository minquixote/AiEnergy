import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AiEnergyApi } from '../shared/ipc'
import type { AppSettings, AppSnapshot, MockScenarioId, ProviderId } from '../shared/types'

const windowMode =
  Array.isArray(process.argv) && process.argv.includes('--ai-energy-window=floating-bar')
    ? 'floating-bar'
    : 'popover'

const api: AiEnergyApi = {
  windowMode,
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  refreshNow: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_NOW),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch),
  setMockScenario: (scenario: MockScenarioId) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_MOCK_SCENARIO, scenario),
  openProviderLogin: (providerId: ProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_PROVIDER_LOGIN, providerId),
  importProviderSession: (providerId: ProviderId, rawInput: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.IMPORT_PROVIDER_SESSION, providerId, rawInput),
  openExternalProviderPage: (providerId: ProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_PROVIDER_PAGE, providerId),
  disconnectProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_PROVIDER, providerId),
  getDebugLogs: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DEBUG_LOGS),
  clearDebugLogs: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_DEBUG_LOGS),
  copyDebugLogs: () => ipcRenderer.invoke(IPC_CHANNELS.COPY_DEBUG_LOGS),
  togglePopoverFromFloatingBar: () =>
    ipcRenderer.invoke(IPC_CHANNELS.TOGGLE_POPOVER_FROM_FLOATING_BAR),
  openFloatingBarMenu: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FLOATING_BAR_MENU),
  resizeFloatingBar: (width: number, height: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.RESIZE_FLOATING_BAR, width, height),
  resetFloatingBarPosition: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_FLOATING_BAR_POSITION),
  resizePopover: (height: number) => ipcRenderer.invoke(IPC_CHANNELS.RESIZE_POPOVER, height),
  quitApp: () => ipcRenderer.invoke(IPC_CHANNELS.QUIT_APP),
  onSnapshotUpdated: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_UPDATED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_UPDATED, handler)
    }
  }
}

contextBridge.exposeInMainWorld('aiEnergy', api)
