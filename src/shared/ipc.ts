import type {
  AppSettings,
  AppSnapshot,
  ImportSessionResult,
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
  IMPORT_CHATGPT_SESSION: 'ai-energy:import-chatgpt-session',
  OPEN_CHATGPT_SESSION_PAGE: 'ai-energy:open-chatgpt-session-page',
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
  importChatGptSession: (rawJson: string) => Promise<ImportSessionResult>
  openChatGptSessionPage: () => Promise<void>
  disconnectProvider: (providerId: ProviderId) => Promise<AppSnapshot>
  resizePopover: (height: number) => Promise<void>
  quitApp: () => Promise<void>
  onSnapshotUpdated: (listener: (snapshot: AppSnapshot) => void) => () => void
}
