import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AiEnergyApi } from '../shared/ipc'
import type { AppSettings, AppSnapshot, MockScenarioId, ProviderId } from '../shared/types'

const api: AiEnergyApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  refreshNow: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_NOW),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, patch),
  setMockScenario: (scenario: MockScenarioId) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_MOCK_SCENARIO, scenario),
  openProviderLogin: (providerId: ProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_PROVIDER_LOGIN, providerId),
  disconnectProvider: (providerId: ProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_PROVIDER, providerId),
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
