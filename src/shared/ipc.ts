import type {
  AppSettings,
  AppSnapshot,
  LoginWindowResult,
  MockScenarioId,
  ProviderId,
  RefreshResult
} from './types'

export const IPC_CHANNELS = {
  GET_SNAPSHOT: 'ai-energy:get-snapshot',
  REFRESH_NOW: 'ai-energy:refresh-now',
  UPDATE_SETTINGS: 'ai-energy:update-settings',
  SET_MOCK_SCENARIO: 'ai-energy:set-mock-scenario',
  OPEN_PROVIDER_LOGIN: 'ai-energy:open-provider-login',
  DISCONNECT_PROVIDER: 'ai-energy:disconnect-provider',
  RESIZE_POPOVER: 'ai-energy:resize-popover',
  QUIT_APP: 'ai-energy:quit-app',
  SNAPSHOT_UPDATED: 'ai-energy:snapshot-updated'
} as const

export interface AiEnergyApi {
  getSnapshot: () => Promise<AppSnapshot>
  refreshNow: () => Promise<RefreshResult>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSnapshot>
  setMockScenario: (scenario: MockScenarioId) => Promise<AppSnapshot>
  openProviderLogin: (providerId: ProviderId) => Promise<LoginWindowResult>
  disconnectProvider: (providerId: ProviderId) => Promise<AppSnapshot>
  resizePopover: (height: number) => Promise<void>
  quitApp: () => Promise<void>
  onSnapshotUpdated: (listener: (snapshot: AppSnapshot) => void) => () => void
}
