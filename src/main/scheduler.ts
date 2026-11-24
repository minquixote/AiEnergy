import { nativeTheme, powerMonitor } from 'electron'
import { MANUAL_REFRESH_COOLDOWN_MS, PROVIDER_META, PROVIDER_ORDER } from '../shared/constants'
import { computeTraySummary, getCooldownRemainingMs } from '../shared/usage'
import type {
  AppSettings,
  AppSnapshot,
  LoginWindowResult,
  MockScenarioId,
  ProviderId,
  ProviderUsage,
  RefreshResult
} from '../shared/types'
import { clearProviderSession, openProviderLoginWindow } from './providers/loginWindow'
import { buildMockUsages, nudgeMockUsages } from './providers/mock'
import { getLiveProviderAdapter, isLiveProviderSupported } from './providers/registry'
import type { AppStore } from './store'

export type SnapshotListener = (snapshot: AppSnapshot) => void

// Backoff steps (in ms) when a platform responds with HTTP 429 rate-limit during auto-refresh
const RATE_LIMIT_BACKOFF_STEPS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const

interface BackoffState {
  attempts: number
  until: number
}

function buildInitialLiveUsages(now: number = Date.now()): Record<ProviderId, ProviderUsage> {
  const result = {} as Record<ProviderId, ProviderUsage>
  for (const id of PROVIDER_ORDER) {
    if (isLiveProviderSupported(id)) {
      result[id] = {
        id,
        status: 'auth_required',
        sessionRemainingPct: null,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        updatedAt: now,
        errorMessage: `${PROVIDER_META[id].name} 연결 상태를 확인하는 중입니다. 로그인이 필요하면 카드를 클릭해 주세요.`
      }
    } else {
      result[id] = {
        id,
        status: 'error',
        sessionRemainingPct: null,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        updatedAt: now,
        errorMessage: `${PROVIDER_META[id].name} 실연동은 Phase 3에서 추가 예정입니다. (설정에서 숨김 또는 Mock 모드 확인 가능)`
      }
    }
  }
  return result
}

export class EnergyCoordinator {
  private readonly store: AppStore
  private readonly listeners = new Set<SnapshotListener>()
  private readonly rateLimitBackoff = new Map<ProviderId, BackoffState>()

  private usages: Record<ProviderId, ProviderUsage>
  private settings: AppSettings
  private lastUpdatedAt: number | null
  private cooldownUntil = 0
  private activeRefreshCount = 0
  private refreshTimer: NodeJS.Timeout | null = null

  private get isRefreshing(): boolean {
    return this.activeRefreshCount > 0
  }

  constructor(store: AppStore) {
    this.store = store
    this.settings = store.getSettings()

    const cached = store.getCachedUsages()
    const cachedAt = store.getLastUpdatedAt()
    if (cached && cachedAt) {
      this.usages = cached
      this.lastUpdatedAt = cachedAt
    } else if (this.settings.dataSourceMode === 'mock') {
      const now = Date.now()
      this.usages = buildMockUsages(this.settings.mockScenario, now)
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
    } else {
      this.usages = buildInitialLiveUsages(Date.now())
      this.lastUpdatedAt = null
    }

    nativeTheme.on('updated', () => {
      this.emit()
    })

    powerMonitor.on('resume', () => {
      const intervalMs = this.settings.refreshIntervalMinutes * 60_000
      if (!this.lastUpdatedAt || Date.now() - this.lastUpdatedAt >= intervalMs) {
        void this.refreshInternal(false)
      }
    })

    this.restartAutoRefreshTimer()

    // Trigger immediate live collection on app startup so fresh ChatGPT data appears right away
    if (this.settings.dataSourceMode === 'live') {
      void this.refreshInternal(false)
    }
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): AppSnapshot {
    const platform =
      process.platform === 'darwin' ||
      process.platform === 'win32' ||
      process.platform === 'linux'
        ? process.platform
        : 'other'

    return {
      usages: this.usages,
      settings: this.settings,
      traySummary: computeTraySummary(this.usages, this.settings.enabledProviders),
      lastUpdatedAt: this.lastUpdatedAt,
      cooldownUntil: this.cooldownUntil,
      platform,
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      isRefreshing: this.isRefreshing
    }
  }

  async refreshManual(): Promise<RefreshResult> {
    const now = Date.now()
    const remaining = getCooldownRemainingMs(this.cooldownUntil, now)
    if (remaining > 0) {
      return {
        refreshed: false,
        cooldownRemainingMs: remaining,
        snapshot: this.getSnapshot()
      }
    }

    this.cooldownUntil = now + MANUAL_REFRESH_COOLDOWN_MS
    // Explicit manual refresh overrides any automatic 429 backoff
    this.rateLimitBackoff.clear()
    await this.refreshInternal(true)
    return {
      refreshed: true,
      cooldownRemainingMs: MANUAL_REFRESH_COOLDOWN_MS,
      snapshot: this.getSnapshot()
    }
  }

  updateSettings(patch: Partial<AppSettings>): AppSnapshot {
    const prevInterval = this.settings.refreshIntervalMinutes
    const prevScenario = this.settings.mockScenario
    const prevMode = this.settings.dataSourceMode
    const prevEnabled = { ...this.settings.enabledProviders }

    this.settings = this.store.updateSettings(patch)

    if (patch.refreshIntervalMinutes && patch.refreshIntervalMinutes !== prevInterval) {
      this.restartAutoRefreshTimer()
    }

    if (patch.dataSourceMode && patch.dataSourceMode !== prevMode) {
      this.rateLimitBackoff.clear()
      if (this.settings.dataSourceMode === 'mock') {
        const now = Date.now()
        this.usages = buildMockUsages(this.settings.mockScenario, now)
        this.lastUpdatedAt = now
        this.store.setCachedUsages(this.usages, now)
      } else {
        this.usages = buildInitialLiveUsages(Date.now())
        this.lastUpdatedAt = null
        this.store.clearCachedUsages()
        void this.refreshInternal(false)
      }
    } else if (
      patch.mockScenario &&
      patch.mockScenario !== prevScenario &&
      this.settings.dataSourceMode === 'mock'
    ) {
      const now = Date.now()
      this.usages = buildMockUsages(this.settings.mockScenario, now)
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
    }

    // If a live-supported provider was just toggled ON in live mode, fetch it promptly
    if (this.settings.dataSourceMode === 'live' && patch.enabledProviders) {
      for (const id of PROVIDER_ORDER) {
        if (!prevEnabled[id] && this.settings.enabledProviders[id] && isLiveProviderSupported(id)) {
          void this.refreshSingleProvider(id)
        }
      }
    }

    this.emit()
    return this.getSnapshot()
  }

  setMockScenario(scenario: MockScenarioId): AppSnapshot {
    this.settings = this.store.updateSettings({
      dataSourceMode: 'mock',
      mockScenario: scenario
    })
    const now = Date.now()
    this.usages = buildMockUsages(scenario, now)
    this.lastUpdatedAt = now
    this.store.setCachedUsages(this.usages, now)
    this.emit()
    return this.getSnapshot()
  }

  openLogin(providerId: ProviderId): LoginWindowResult {
    return openProviderLoginWindow(providerId, (closedId) => {
      if (this.settings.dataSourceMode === 'mock') {
        const current = this.usages[closedId]
        if (current.status !== 'ok') {
          const now = Date.now()
          const fresh = buildMockUsages('healthy', now)[closedId]
          this.usages = { ...this.usages, [closedId]: fresh }
          this.lastUpdatedAt = now
          this.store.setCachedUsages(this.usages, now)
          this.emit()
        }
      } else {
        this.rateLimitBackoff.delete(closedId)
        void this.refreshSingleProvider(closedId)
      }
    })
  }

  async disconnectProvider(providerId: ProviderId): Promise<AppSnapshot> {
    await clearProviderSession(providerId)
    this.rateLimitBackoff.delete(providerId)
    const now = Date.now()
    this.usages = {
      ...this.usages,
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
    this.lastUpdatedAt = now
    this.store.setCachedUsages(this.usages, now)
    this.emit()
    return this.getSnapshot()
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.listeners.clear()
  }

  private async refreshSingleProvider(providerId: ProviderId): Promise<void> {
    if (this.settings.dataSourceMode !== 'live') return
    const adapter = getLiveProviderAdapter(providerId)
    if (!adapter) return

    this.activeRefreshCount += 1
    this.emit()
    try {
      const result = await adapter.collect()
      this.applyLiveResult(providerId, result.usage, Boolean(result.rateLimited))
      const now = Date.now()
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
    } finally {
      this.activeRefreshCount = Math.max(0, this.activeRefreshCount - 1)
      this.emit()
    }
  }

  private applyLiveResult(providerId: ProviderId, usage: ProviderUsage, rateLimited: boolean): void {
    if (rateLimited) {
      const prev = this.rateLimitBackoff.get(providerId)
      const attempts = (prev?.attempts ?? 0) + 1
      const stepIdx = Math.min(attempts - 1, RATE_LIMIT_BACKOFF_STEPS_MS.length - 1)
      this.rateLimitBackoff.set(providerId, {
        attempts,
        until: Date.now() + RATE_LIMIT_BACKOFF_STEPS_MS[stepIdx]
      })
    } else if (usage.status === 'ok') {
      this.rateLimitBackoff.delete(providerId)
    }

    this.usages = {
      ...this.usages,
      [providerId]: usage
    }
  }

  private async refreshInternal(isManual: boolean): Promise<void> {
    if (this.isRefreshing) return
    this.activeRefreshCount += 1
    this.emit()

    try {
      if (this.settings.dataSourceMode === 'mock') {
        await new Promise((resolve) => setTimeout(resolve, isManual ? 280 : 120))
        const now = Date.now()
        this.usages = nudgeMockUsages(this.usages, now)
        this.lastUpdatedAt = now
        this.store.setCachedUsages(this.usages, now)
        return
      }

      const now = Date.now()
      const targets = PROVIDER_ORDER.filter((id) => {
        if (!this.settings.enabledProviders[id]) return false
        if (!isLiveProviderSupported(id)) return false
        if (!isManual) {
          const backoff = this.rateLimitBackoff.get(id)
          if (backoff && now < backoff.until) {
            return false
          }
        }
        return true
      })

      for (const id of PROVIDER_ORDER) {
        if (!isLiveProviderSupported(id)) {
          this.usages = {
            ...this.usages,
            [id]: {
              id,
              status: 'error',
              sessionRemainingPct: null,
              sessionResetAt: null,
              weeklyRemainingPct: null,
              weeklyResetAt: null,
              updatedAt: now,
              errorMessage: `${PROVIDER_META[id].name} 실연동은 Phase 3에서 추가 예정입니다. (설정에서 숨김 또는 Mock 모드 확인 가능)`
            }
          }
        }
      }

      const results = await Promise.all(
        targets.map(async (id) => {
          const adapter = getLiveProviderAdapter(id)
          if (!adapter) return null
          const res = await adapter.collect()
          return { id, res }
        })
      )

      for (const item of results) {
        if (!item) continue
        this.applyLiveResult(item.id, item.res.usage, Boolean(item.res.rateLimited))
      }

      const completedAt = Date.now()
      this.lastUpdatedAt = completedAt
      this.store.setCachedUsages(this.usages, completedAt)
    } finally {
      this.activeRefreshCount = Math.max(0, this.activeRefreshCount - 1)
      this.emit()
    }
  }

  private restartAutoRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
    }
    const intervalMs = this.settings.refreshIntervalMinutes * 60_000
    this.refreshTimer = setInterval(() => {
      void this.refreshInternal(false)
    }, intervalMs)
  }

  private emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}
