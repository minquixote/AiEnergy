import { nativeTheme, powerMonitor } from 'electron'
import { MANUAL_REFRESH_COOLDOWN_MS, PROVIDER_META, PROVIDER_ORDER } from '../shared/constants'
import { computeTraySummary, getCooldownRemainingMs } from '../shared/usage'
import type {
  AppSettings,
  AppSnapshot,
  ChatGptAuthSource,
  ImportSessionResult,
  LoginWindowResult,
  MockScenarioId,
  ProviderId,
  ProviderUsage,
  RefreshResult
} from '../shared/types'
import { resolveChatGptAuthSource } from './providers/chatgpt'
import { parseImportedChatGptSession } from './providers/chatgptAuth'
import { clearProviderSession, openProviderLoginWindow } from './providers/loginWindow'
import { buildMockUsages, nudgeMockUsages } from './providers/mock'
import { createProviderRegistry, type ProviderRegistry } from './providers/registry'
import type { AppStore } from './store'

export type SnapshotListener = (snapshot: AppSnapshot) => void

// Backoff steps (in ms) when a platform responds with HTTP 429 rate-limit during auto-refresh
const RATE_LIMIT_BACKOFF_STEPS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000] as const

interface BackoffState {
  attempts: number
  until: number
}

function buildInitialLiveUsages(
  registry: ProviderRegistry,
  now: number = Date.now()
): Record<ProviderId, ProviderUsage> {
  const result = {} as Record<ProviderId, ProviderUsage>
  for (const id of PROVIDER_ORDER) {
    if (registry.isSupported(id)) {
      result[id] = {
        id,
        status: 'auth_required',
        sessionRemainingPct: null,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        updatedAt: now,
        errorMessage: `${PROVIDER_META[id].name} 연결 상태를 확인하는 중입니다.`
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
  private readonly registry: ProviderRegistry
  private readonly listeners = new Set<SnapshotListener>()
  private readonly rateLimitBackoff = new Map<ProviderId, BackoffState>()

  private usages: Record<ProviderId, ProviderUsage>
  private settings: AppSettings
  private lastUpdatedAt: number | null
  private cooldownUntil = 0
  private activeRefreshCount = 0
  private chatGptAuthSource: ChatGptAuthSource = 'none'
  private refreshTimer: NodeJS.Timeout | null = null

  private get isRefreshing(): boolean {
    return this.activeRefreshCount > 0
  }

  constructor(store: AppStore) {
    this.store = store
    this.registry = createProviderRegistry(store)
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
      this.usages = buildInitialLiveUsages(this.registry, Date.now())
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
    void this.syncAuthSource()

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
      isRefreshing: this.isRefreshing,
      chatGptAuthSource: this.chatGptAuthSource
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
        this.usages = buildInitialLiveUsages(this.registry, Date.now())
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

    if (this.settings.dataSourceMode === 'live' && patch.enabledProviders) {
      for (const id of PROVIDER_ORDER) {
        if (!prevEnabled[id] && this.settings.enabledProviders[id] && this.registry.isSupported(id)) {
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

  async importChatGptSession(rawJson: string): Promise<ImportSessionResult> {
    const parsed = parseImportedChatGptSession(rawJson)
    if (!parsed.ok || !parsed.credential) {
      return {
        ok: false,
        error: parsed.error ?? '세션 JSON을 해석할 수 없습니다.',
        snapshot: this.getSnapshot()
      }
    }

    this.store.saveImportedChatGptSession(parsed.credential)
    this.rateLimitBackoff.delete('chatgpt')
    await this.syncAuthSource()

    if (this.settings.dataSourceMode !== 'live') {
      this.settings = this.store.updateSettings({ dataSourceMode: 'live' })
    }

    await this.refreshSingleProvider('chatgpt')
    const snapshot = this.getSnapshot()
    const usage = snapshot.usages.chatgpt
    if (usage.status !== 'ok') {
      return {
        ok: false,
        error: usage.errorMessage ?? '세션은 저장되었지만 사용량 조회에 실패했습니다.',
        snapshot
      }
    }

    return {
      ok: true,
      snapshot
    }
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
        void this.syncAuthSource().then(() => this.refreshSingleProvider(closedId))
      }
    })
  }

  async disconnectProvider(providerId: ProviderId): Promise<AppSnapshot> {
    await clearProviderSession(providerId)
    if (providerId === 'chatgpt') {
      this.store.clearImportedChatGptSession()
    }
    this.rateLimitBackoff.delete(providerId)
    await this.syncAuthSource()

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
        errorMessage: '연결이 해제되었습니다. 카드를 클릭해 다시 연결해 주세요.'
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

  private async syncAuthSource(): Promise<void> {
    this.chatGptAuthSource = await resolveChatGptAuthSource(() =>
      this.store.getImportedChatGptSession()
    )
  }

  private async refreshSingleProvider(providerId: ProviderId): Promise<void> {
    if (this.settings.dataSourceMode !== 'live') return
    const adapter = this.registry.get(providerId)
    if (!adapter) return

    this.activeRefreshCount += 1
    this.emit()
    try {
      await this.syncAuthSource()
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

      await this.syncAuthSource()
      const now = Date.now()
      const targets = PROVIDER_ORDER.filter((id) => {
        if (!this.settings.enabledProviders[id]) return false
        if (!this.registry.isSupported(id)) return false
        if (!isManual) {
          const backoff = this.rateLimitBackoff.get(id)
          if (backoff && now < backoff.until) {
            return false
          }
        }
        return true
      })

      for (const id of PROVIDER_ORDER) {
        if (!this.registry.isSupported(id)) {
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
          const adapter = this.registry.get(id)
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
