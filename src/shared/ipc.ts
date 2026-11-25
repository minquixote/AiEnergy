import type {
  AppSettings,
  AppSnapshot,
  DebugLogEntry,
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
  IMPORT_PROVIDER_SESSION: 'ai-energy:import-provider-session',
  OPEN_EXTERNAL_PROVIDER_PAGE: 'ai-energy:open-external-provider-page',
  DISCONNECT_PROVIDER: 'ai-energy:disconnect-provider',
  GET_DEBUG_LOGS: 'ai-energy:get-debug-logs',
  CLEAR_DEBUG_LOGS: 'ai-energy:clear-debug-logs',
  COPY_DEBUG_LOGS: 'ai-energy:copy-debug-logs',
  TOGGLE_POPOVER_FROM_FLOATING_BAR: 'ai-energy:toggle-popover-from-floating-bar',
  OPEN_FLOATING_BAR_MENU: 'ai-energy:open-floating-bar-menu',
  RESIZE_FLOATING_BAR: 'ai-energy:resize-floating-bar',
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
  importProviderSession: (providerId: ProviderId, rawInput: string) => Promise<ImportSessionResult>
  openExternalProviderPage: (providerId: ProviderId) => Promise<void>
  disconnectProvider: (providerId: ProviderId) => Promise<AppSnapshot>
  getDebugLogs: () => Promise<DebugLogEntry[]>
  clearDebugLogs: () => Promise<DebugLogEntry[]>
  copyDebugLogs: () => Promise<boolean>
  togglePopoverFromFloatingBar: () => Promise<void>
  openFloatingBarMenu: () => Promise<void>
  resizeFloatingBar: (width: number, height: number) => Promise<void>
  resizePopover: (height: number) => Promise<void>
  quitApp: () => Promise<void>
  onSnapshotUpdated: (listener: (snapshot: AppSnapshot) => void) => () => void
}
