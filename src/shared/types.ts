export type ProviderId = 'chatgpt' | 'gemini' | 'claude'

export type ProviderStatus = 'ok' | 'auth_required' | 'error'

export interface ProviderUsage {
  id: ProviderId
  status: ProviderStatus
  sessionRemainingPct: number | null // 0 ~ 100
  sessionResetAt: string | null // 원문 또는 ISO 시각
  weeklyRemainingPct: number | null // 0 ~ 100
  weeklyResetAt: string | null
  updatedAt: number // timestamp
  errorMessage?: string
}

export type EnergyLevel = 'high' | 'medium' | 'low' | 'unknown'

export type RefreshIntervalMinutes = 1 | 5 | 10 | 15

export type ThemePreference = 'dark' | 'light' | 'system'

export type DataSourceMode = 'mock' | 'live'

export type MockScenarioId = 'balanced' | 'healthy' | 'warning' | 'auth_issue'

export interface ProviderMeta {
  id: ProviderId
  name: string
  planLabel: string
  partition: `persist:${ProviderId}`
  loginUrl: string
  usageUrl: string
}

export interface AppSettings {
  refreshIntervalMinutes: RefreshIntervalMinutes
  theme: ThemePreference
  notificationsEnabled: boolean
  showTrayPercentage: boolean
  launchAtLogin: boolean
  dataSourceMode: DataSourceMode
  mockScenario: MockScenarioId
  enabledProviders: Record<ProviderId, boolean>
}

export interface TrayItemSummary {
  id: ProviderId
  status: ProviderStatus
  remainingPct: number | null
  level: EnergyLevel
}

export interface TraySummary {
  items: TrayItemSummary[]
  lowestRemainingPct: number | null
  lowestProviderId: ProviderId | null
  level: EnergyLevel
  connectedCount: number
  enabledCount: number
}

export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'other'

export interface AppSnapshot {
  usages: Record<ProviderId, ProviderUsage>
  settings: AppSettings
  traySummary: TraySummary
  lastUpdatedAt: number | null
  cooldownUntil: number
  platform: HostPlatform
  systemTheme: 'dark' | 'light'
  isRefreshing: boolean
}

export interface RefreshResult {
  refreshed: boolean
  cooldownRemainingMs: number
  snapshot: AppSnapshot
}

export interface LoginWindowResult {
  opened: boolean
  providerId: ProviderId
  note?: string
}
