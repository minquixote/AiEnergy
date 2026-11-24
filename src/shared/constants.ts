import type {
  AppSettings,
  MockScenarioId,
  ProviderId,
  ProviderMeta,
  RefreshIntervalMinutes
} from './types'

export const APP_NAME = 'AI Energy Bar'

export const PROVIDER_ORDER: readonly ProviderId[] = ['chatgpt', 'gemini', 'claude']

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    planLabel: 'Plus / Pro',
    partition: 'persist:chatgpt',
    loginUrl: 'https://chatgpt.com',
    usageUrl: 'https://chatgpt.com/codex/settings/usage'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    planLabel: 'AI Pro / Ultra',
    partition: 'persist:gemini',
    loginUrl: 'https://gemini.google.com',
    usageUrl: 'https://gemini.google.com'
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    planLabel: 'Pro / Max',
    partition: 'persist:claude',
    loginUrl: 'https://claude.ai/login',
    usageUrl: 'https://claude.ai/settings/usage'
  }
}

export const LIVE_SUPPORTED_PROVIDERS: readonly ProviderId[] = ['chatgpt']

export const REFRESH_INTERVAL_OPTIONS: readonly RefreshIntervalMinutes[] = [1, 5, 10, 15]

export const MANUAL_REFRESH_COOLDOWN_MS = 30_000

export const ENERGY_THRESHOLDS = {
  HIGH_MIN: 51,
  MEDIUM_MIN: 21,
  LOW_MAX: 20
} as const

export const POPOVER_DIMENSIONS = {
  WIDTH: 340,
  INITIAL_HEIGHT: 460,
  MIN_HEIGHT: 260,
  MAX_HEIGHT: 620
} as const

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalMinutes: 10,
  theme: 'dark',
  notificationsEnabled: true,
  showTrayPercentage: true,
  launchAtLogin: false,
  dataSourceMode: 'live',
  mockScenario: 'balanced',
  enabledProviders: {
    chatgpt: true,
    gemini: true,
    claude: true
  }
}

export const MOCK_SCENARIOS: ReadonlyArray<{
  id: MockScenarioId
  label: string
  description: string
}> = [
  {
    id: 'balanced',
    label: '혼합 상태 (기본)',
    description: '여유(72%) · 주의(38%) · 경고(14%)'
  },
  {
    id: 'healthy',
    label: '전체 여유',
    description: '모든 플랫폼 51% 이상 초록 상태'
  },
  {
    id: 'warning',
    label: '주의 구간',
    description: '최저 32% 노랑/주황 트레이 반영'
  },
  {
    id: 'auth_issue',
    label: '세션 만료 / 오류',
    description: '재로그인 필요 및 조회 실패 카드 확인'
  }
]
