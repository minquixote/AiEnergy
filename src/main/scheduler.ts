import { nativeTheme, powerMonitor } from 'electron'
import { MANUAL_REFRESH_COOLDOWN_MS } from '../shared/constants'
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
import { buildMockUsages, nudgeMockUsages } from './providers/mock'
import { clearProviderSession, openProviderLoginWindow } from './providers/loginWindow'
import type { AppStore } from './store'

export type SnapshotListener = (snapshot: AppSnapshot) => void

export class EnergyCoordinator {
  private readonly store: AppStore
  private readonly listeners = new Set<SnapshotListener>()

  private usages: Record<ProviderId, ProviderUsage>
  private settings: AppSettings
  private lastUpdatedAt: number | null
  private cooldownUntil = 0
  private isRefreshing = false
  private refreshTimer: NodeJS.Timeout | null = null

  constructor(store: AppStore) {
    this.store = store
    this.settings = store.getSettings()

    const cached = store.getCachedUsages()
    const cachedAt = store.getLastUpdatedAt()
    if (cached && cachedAt) {
      this.usages = cached
      this.lastUpdatedAt = cachedAt
    } else {
      const now = Date.now()
      this.usages = buildMockUsages(this.settings.mockScenario, now)
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
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

    this.settings = this.store.updateSettings(patch)

    if (patch.refreshIntervalMinutes && patch.refreshIntervalMinutes !== prevInterval) {
      this.restartAutoRefreshTimer()
    }

    if (
      patch.mockScenario &&
      patch.mockScenario !== prevScenario &&
      this.settings.dataSourceMode === 'mock'
    ) {
      const now = Date.now()
      this.usages = buildMockUsages(this.settings.mockScenario, now)
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
    }

    this.emit()
    return this.getSnapshot()
  }

  setMockScenario(scenario: MockScenarioId): AppSnapshot {
    this.settings = this.store.updateSettings({ mockScenario: scenario })
    const now = Date.now()
    this.usages = buildMockUsages(scenario, now)
    this.lastUpdatedAt = now
    this.store.setCachedUsages(this.usages, now)
    this.emit()
    return this.getSnapshot()
  }

  openLogin(providerId: ProviderId): LoginWindowResult {
    return openProviderLoginWindow(providerId, (closedId) => {
      // When login window closes in Phase 1 mock mode, recover auth_required/error card for smooth UX testing
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
        void this.refreshInternal(false)
      }
    })
  }

  async disconnectProvider(providerId: ProviderId): Promise<AppSnapshot> {
    await clearProviderSession(providerId)
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

  private async refreshInternal(isManual: boolean): Promise<void> {
    if (this.isRefreshing) return
    this.isRefreshing = true
    this.emit()

    try {
      // Brief visual feedback delay in mock mode; Phase 2/3 replaces with real ProviderAdapter collectors
      await new Promise((resolve) => setTimeout(resolve, isManual ? 280 : 120))
      const now = Date.now()
      this.usages = nudgeMockUsages(this.usages, now)
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
    } finally {
      this.isRefreshing = false
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
