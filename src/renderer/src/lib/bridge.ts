import { DEFAULT_SETTINGS, MANUAL_REFRESH_COOLDOWN_MS } from '@shared/constants'
import type { AiEnergyApi } from '@shared/ipc'
import type {
  AppSettings,
  AppSnapshot,
  MockScenarioId,
  ProviderId,
  ProviderUsage
} from '@shared/types'
import { clampPercentage, computeTraySummary, getCooldownRemainingMs } from '@shared/usage'

function buildBrowserFallbackUsages(
  scenario: MockScenarioId,
  now: number
): Record<ProviderId, ProviderUsage> {
  const hour = 60 * 60_000
  const day = 24 * hour
  const iso = (offset: number): string => new Date(now + offset).toISOString()

  if (scenario === 'healthy') {
    return {
      chatgpt: {
        id: 'chatgpt',
        status: 'ok',
        sessionRemainingPct: 88,
        sessionResetAt: iso(3.3 * hour),
        weeklyRemainingPct: 96,
        weeklyResetAt: iso(5.2 * day),
        updatedAt: now
      },
      gemini: {
        id: 'gemini',
        status: 'ok',
        sessionRemainingPct: 64,
        sessionResetAt: iso(2.1 * hour),
        weeklyRemainingPct: 91,
        weeklyResetAt: iso(4.4 * day),
        updatedAt: now
      },
      claude: {
        id: 'claude',
        status: 'ok',
        sessionRemainingPct: 95,
        sessionResetAt: iso(4.7 * hour),
        weeklyRemainingPct: 99,
        weeklyResetAt: iso(6.1 * day),
        updatedAt: now
      }
    }
  }

  if (scenario === 'warning') {
    return {
      chatgpt: {
        id: 'chatgpt',
        status: 'ok',
        sessionRemainingPct: 45,
        sessionResetAt: iso(1.8 * hour),
        weeklyRemainingPct: 74,
        weeklyResetAt: iso(3.2 * day),
        updatedAt: now
      },
      gemini: {
        id: 'gemini',
        status: 'ok',
        sessionRemainingPct: 32,
        sessionResetAt: iso(0.9 * hour),
        weeklyRemainingPct: 68,
        weeklyResetAt: iso(2.5 * day),
        updatedAt: now
      },
      claude: {
        id: 'claude',
        status: 'ok',
        sessionRemainingPct: 78,
        sessionResetAt: iso(3.2 * hour),
        weeklyRemainingPct: 88,
        weeklyResetAt: iso(5 * day),
        updatedAt: now
      }
    }
  }

  if (scenario === 'auth_issue') {
    return {
      chatgpt: {
        id: 'chatgpt',
        status: 'ok',
        sessionRemainingPct: 61,
        sessionResetAt: iso(2.4 * hour),
        weeklyRemainingPct: 89,
        weeklyResetAt: iso(4.3 * day),
        updatedAt: now
      },
      gemini: {
        id: 'gemini',
        status: 'auth_required',
        sessionRemainingPct: null,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        updatedAt: now,
        errorMessage: '로그인 세션이 만료되었습니다. 카드를 클릭해 다시 연결해 주세요.'
      },
      claude: {
        id: 'claude',
        status: 'error',
        sessionRemainingPct: null,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        updatedAt: now,
        errorMessage: '사용량 응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
      }
    }
  }

  return {
    chatgpt: {
      id: 'chatgpt',
      status: 'ok',
      sessionRemainingPct: 72,
      sessionResetAt: iso(2.6 * hour),
      weeklyRemainingPct: 94,
      weeklyResetAt: iso(5.1 * day),
      updatedAt: now
    },
    gemini: {
      id: 'gemini',
      status: 'ok',
      sessionRemainingPct: 38,
      sessionResetAt: iso(1.2 * hour),
      weeklyRemainingPct: 82,
      weeklyResetAt: iso(3.3 * day),
      updatedAt: now
    },
    claude: {
      id: 'claude',
      status: 'ok',
      sessionRemainingPct: 14,
      sessionResetAt: iso(0.7 * hour),
      weeklyRemainingPct: 99,
      weeklyResetAt: iso(6.2 * day),
      updatedAt: now
    }
  }
}

function createBrowserFallbackBridge(): AiEnergyApi {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    dataSourceMode: 'mock',
    enabledProviders: { ...DEFAULT_SETTINGS.enabledProviders }
  }
  let lastUpdatedAt = Date.now()
  let usages = buildBrowserFallbackUsages(settings.mockScenario, lastUpdatedAt)
  let cooldownUntil = 0
  const listeners = new Set<(snapshot: AppSnapshot) => void>()

  const getSystemTheme = (): 'dark' | 'light' =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

  const snapshot = (): AppSnapshot => ({
    usages,
    settings,
    traySummary: computeTraySummary(usages, settings.enabledProviders),
    lastUpdatedAt,
    cooldownUntil,
    platform: 'darwin',
    systemTheme: getSystemTheme(),
    isRefreshing: false,
    authSources: { chatgpt: 'none', gemini: 'none', claude: 'none' },
    appVersion: '0.1.0',
    isPackaged: false,
    debugLogCount: 0
  })

  const emit = (): void => {
    const next = snapshot()
    for (const listener of listeners) listener(next)
  }

  return {
    getSnapshot: async () => snapshot(),
    refreshNow: async () => {
      const now = Date.now()
      const rem = getCooldownRemainingMs(cooldownUntil, now)
      if (rem > 0) {
        return { refreshed: false, cooldownRemainingMs: rem, snapshot: snapshot() }
      }
      cooldownUntil = now + MANUAL_REFRESH_COOLDOWN_MS
      lastUpdatedAt = now
      for (const id of ['chatgpt', 'gemini', 'claude'] as const) {
        const cur = usages[id]
        if (cur.status === 'ok' && cur.sessionRemainingPct !== null) {
          usages = {
            ...usages,
            [id]: {
              ...cur,
              sessionRemainingPct:
                cur.sessionRemainingPct <= 2 ? 100 : clampPercentage(cur.sessionRemainingPct - 1),
              updatedAt: now
            }
          }
        }
      }
      emit()
      return {
        refreshed: true,
        cooldownRemainingMs: MANUAL_REFRESH_COOLDOWN_MS,
        snapshot: snapshot()
      }
    },
    updateSettings: async (patch) => {
      settings = {
        ...settings,
        ...patch,
        enabledProviders: {
          ...settings.enabledProviders,
          ...(patch.enabledProviders ?? {})
        }
      }
      emit()
      return snapshot()
    },
    setMockScenario: async (scenario) => {
      settings = { ...settings, mockScenario: scenario }
      lastUpdatedAt = Date.now()
      usages = buildBrowserFallbackUsages(scenario, lastUpdatedAt)
      emit()
      return snapshot()
    },
    openProviderLogin: async (providerId) => {
      const now = Date.now()
      usages = {
        ...usages,
        [providerId]: buildBrowserFallbackUsages('healthy', now)[providerId]
      }
      lastUpdatedAt = now
      emit()
      return {
        opened: true,
        providerId,
        note: '브라우저 미리보기 모드에서 재연결을 시뮬레이션했습니다.'
      }
    },
    importProviderSession: async (providerId, rawInput) => {
      if (!rawInput.trim()) {
        return { ok: false, error: '인증 정보를 붙여넣어 주세요.', snapshot: snapshot() }
      }
      const now = Date.now()
      usages = {
        ...usages,
        [providerId]: buildBrowserFallbackUsages('healthy', now)[providerId]
      }
      lastUpdatedAt = now
      emit()
      return { ok: true, snapshot: snapshot() }
    },
    openExternalProviderPage: async (providerId) => {
      const urls: Record<ProviderId, string> = {
        chatgpt: 'https://chatgpt.com/api/auth/session',
        gemini: 'https://gemini.google.com/usage',
        claude: 'https://claude.ai/settings/usage'
      }
      window.open(urls[providerId], '_blank', 'noopener,noreferrer')
    },
    disconnectProvider: async (providerId) => {
      const now = Date.now()
      usages = {
        ...usages,
        [providerId]: {
          id: providerId,
          status: 'auth_required',
          sessionRemainingPct: null,
          sessionResetAt: null,
          weeklyRemainingPct: null,
          weeklyResetAt: null,
          updatedAt: now,
          errorMessage: '연결이 해제되었습니다. 카드를 클릭해 다시 로그인해 주세요.'
        }
      }
      lastUpdatedAt = now
      emit()
      return snapshot()
    },
    getDebugLogs: async () => [],
    clearDebugLogs: async () => [],
    copyDebugLogs: async () => true,
    togglePopoverFromFloatingBar: async () => undefined,
    openFloatingBarMenu: async () => undefined,
    resizeFloatingBar: async () => undefined,
    resizePopover: async () => undefined,
    quitApp: async () => undefined,
    onSnapshotUpdated: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

let cachedBridge: AiEnergyApi | null = null

export function getEnergyBridge(): AiEnergyApi {
  if (typeof window !== 'undefined' && window.aiEnergy) {
    return window.aiEnergy
  }
  if (!cachedBridge) {
    cachedBridge = createBrowserFallbackBridge()
  }
  return cachedBridge
}
