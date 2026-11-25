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
  planName?: string | null // 현재 계정의 실제 구독제 (예: Pro 100, Pro 200, Go, Pro, Ultra, Max)
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

export type TrayBadgeKind = 'percentage' | 'unavailable' | 'alert'

export interface TrayItemSummary {
  id: ProviderId
  status: ProviderStatus
  remainingPct: number | null
  level: EnergyLevel
  badgeKind?: TrayBadgeKind
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

export type ProviderAuthSource =
  | 'codex_cli'
  | 'imported_session'
  | 'imported_cookie'
  | 'browser_partition'
  | 'none'

export interface ProviderAlertState {
  lastPct: number | null
  lowAlertSent: boolean
  resetAlertSent: boolean
}

export interface AppSnapshot {
  usages: Record<ProviderId, ProviderUsage>
  settings: AppSettings
  traySummary: TraySummary
  lastUpdatedAt: number | null
  cooldownUntil: number
  platform: HostPlatform
  systemTheme: 'dark' | 'light'
  isRefreshing: boolean
  authSources: Record<ProviderId, ProviderAuthSource>
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

export interface ImportSessionResult {
  ok: boolean
  error?: string
  snapshot: AppSnapshot
}
