import { app, nativeTheme, powerMonitor } from 'electron'
import { MANUAL_REFRESH_COOLDOWN_MS, PROVIDER_META, PROVIDER_ORDER } from '../shared/constants'
import { computeTraySummary, getCooldownRemainingMs } from '../shared/usage'
import type {
  AppSettings,
  AppSnapshot,
  DebugLogEntry,
  ImportSessionResult,
  LoginWindowResult,
  MockScenarioId,
  ProviderAlertState,
  ProviderAuthSource,
  ProviderId,
  ProviderUsage,
  RefreshResult
} from '../shared/types'
import { createDebugLogEntry, formatDebugLogsReport } from './debugLog'
import { applyLaunchAtLoginSetting } from './loginItem'
import { createInitialAlertStateMap, UsageNotifier } from './notifier'
import type { ProviderCollectResult } from './providers/base'
import { resolveChatGptAuthSource } from './providers/chatgpt'
import { parseImportedChatGptSession } from './providers/chatgptAuth'
import { resolveClaudeAuthSource } from './providers/claude'
import { parseImportedClaudeCookie } from './providers/claudeAuth'
import { resolveGeminiAuthSource } from './providers/gemini'
import { parseImportedGeminiCookie } from './providers/geminiAuth'
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

function buildInitialLiveUsages(now: number = Date.now()): Record<ProviderId, ProviderUsage> {
  const result = {} as Record<ProviderId, ProviderUsage>
  for (const id of PROVIDER_ORDER) {
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
  }
  return result
}

export class EnergyCoordinator {
  private readonly store: AppStore
  private readonly registry: ProviderRegistry
  private readonly notifier: UsageNotifier
  private readonly listeners = new Set<SnapshotListener>()
  private readonly rateLimitBackoff = new Map<ProviderId, BackoffState>()

  private usages: Record<ProviderId, ProviderUsage>
  private settings: AppSettings
  private alertStates: Record<ProviderId, ProviderAlertState>
  private lastUpdatedAt: number | null
  private cooldownUntil = 0
  private activeRefreshCount = 0
  private authSources: Record<ProviderId, ProviderAuthSource> = {
    chatgpt: 'none',
    gemini: 'none',
    claude: 'none'
  }
  private refreshTimer: NodeJS.Timeout | null = null

  private get isRefreshing(): boolean {
    return this.activeRefreshCount > 0
  }

  constructor(store: AppStore, options?: { onNotificationClick?: () => void }) {
    this.store = store
    this.registry = createProviderRegistry(store)
    this.notifier = new UsageNotifier(options?.onNotificationClick)
    this.settings = store.getSettings()
    this.alertStates = store.getAlertStates()

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
        this.recordLog({
          providerId: 'system',
          level: 'info',
          message: '절전 모드 복귀 감지 — 캐시 만료로 자동 새로고침 실행'
        })
        void this.refreshInternal(false)
      }
    })

    if (app.isPackaged) {
      applyLaunchAtLoginSetting(this.settings.launchAtLogin)
    }

    this.restartAutoRefreshTimer()
    void this.syncAuthSources().then(() => this.emit())

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
      traySummary: computeTraySummary(this.usages, this.settings.enabledProviders, {
        authSources: this.authSources,
        dataSourceMode: this.settings.dataSourceMode
      }),
      lastUpdatedAt: this.lastUpdatedAt,
      cooldownUntil: this.cooldownUntil,
      platform,
      systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      isRefreshing: this.isRefreshing,
      authSources: { ...this.authSources },
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      debugLogCount: this.store.getDebugLogs().length
    }
  }

  getDebugLogs(): DebugLogEntry[] {
    return this.store.getDebugLogs()
  }

  clearDebugLogs(): DebugLogEntry[] {
    const cleared = this.store.clearDebugLogs()
    this.emit()
    return cleared
  }

  recordSystemLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.recordLog({
      providerId: 'system',
      level,
      message
    })
  }

  formatDiagnosticsReport(): string {
    const snapshot = this.getSnapshot()
    return formatDebugLogsReport(this.store.getDebugLogs(), {
      appVersion: snapshot.appVersion,
      platform: snapshot.platform,
      dataSourceMode: snapshot.settings.dataSourceMode,
      isPackaged: snapshot.isPackaged
    })
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
    const prevLaunchAtLogin = this.settings.launchAtLogin
    const prevEnabled = { ...this.settings.enabledProviders }

    this.settings = this.store.updateSettings(patch)

    if (typeof patch.launchAtLogin === 'boolean' && patch.launchAtLogin !== prevLaunchAtLogin) {
      const loginRes = applyLaunchAtLoginSetting(patch.launchAtLogin)
      this.recordLog({
        providerId: 'system',
        level: 'info',
        message: loginRes.diagnostic
      })
    }

    if (patch.refreshIntervalMinutes && patch.refreshIntervalMinutes !== prevInterval) {
      this.restartAutoRefreshTimer()
    }

    if (patch.dataSourceMode && patch.dataSourceMode !== prevMode) {
      this.rateLimitBackoff.clear()
      this.alertStates = createInitialAlertStateMap()
      this.store.resetAlertStates()

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
      this.processNotifications()
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
    const modeChanged = this.settings.dataSourceMode !== 'mock'
    this.settings = this.store.updateSettings({
      dataSourceMode: 'mock',
      mockScenario: scenario
    })
    if (modeChanged) {
      this.alertStates = createInitialAlertStateMap()
      this.store.resetAlertStates()
    }
    const now = Date.now()
    this.usages = buildMockUsages(scenario, now)
    this.lastUpdatedAt = now
    this.store.setCachedUsages(this.usages, now)
    this.processNotifications()
    this.emit()
    return this.getSnapshot()
  }

  async importProviderSession(
    providerId: ProviderId,
    rawInput: string
  ): Promise<ImportSessionResult> {
    if (providerId === 'chatgpt') {
      const parsed = parseImportedChatGptSession(rawInput)
      if (!parsed.ok || !parsed.credential) {
        return {
          ok: false,
          error: parsed.error ?? 'ChatGPT 세션 JSON을 해석할 수 없습니다.',
          snapshot: this.getSnapshot()
        }
      }
      this.store.saveImportedChatGptSession(parsed.credential)
    } else if (providerId === 'gemini') {
      const parsed = parseImportedGeminiCookie(rawInput)
      if (!parsed.ok || !parsed.credential) {
        return {
          ok: false,
          error: parsed.error ?? 'Gemini 쿠키를 해석할 수 없습니다.',
          snapshot: this.getSnapshot()
        }
      }
      this.store.saveImportedGeminiCookie(parsed.credential)
    } else {
      const parsed = parseImportedClaudeCookie(rawInput)
      if (!parsed.ok || !parsed.credential) {
        return {
          ok: false,
          error: parsed.error ?? 'Claude 세션을 해석할 수 없습니다.',
          snapshot: this.getSnapshot()
        }
      }
      this.store.saveImportedClaudeCookie(parsed.credential)
    }

    this.rateLimitBackoff.delete(providerId)
    await this.syncAuthSources()

    if (this.settings.dataSourceMode !== 'live') {
      this.settings = this.store.updateSettings({ dataSourceMode: 'live' })
    }

    await this.refreshSingleProvider(providerId)
    const snapshot = this.getSnapshot()
    const usage = snapshot.usages[providerId]
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
          this.processNotifications()
          this.emit()
        }
      } else {
        this.rateLimitBackoff.delete(closedId)
        void this.syncAuthSources().then(() => this.refreshSingleProvider(closedId))
      }
    })
  }

  async disconnectProvider(providerId: ProviderId): Promise<AppSnapshot> {
    await clearProviderSession(providerId)
    if (providerId === 'chatgpt') {
      this.store.clearImportedChatGptSession()
    } else if (providerId === 'gemini') {
      this.store.clearImportedGeminiCookie()
    } else {
      this.store.clearImportedClaudeCookie()
    }
    this.rateLimitBackoff.delete(providerId)
    await this.syncAuthSources()

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

  private processNotifications(): void {
    this.alertStates = this.notifier.evaluateAndDispatch(
      this.alertStates,
      this.usages,
      this.settings.enabledProviders,
      this.settings.notificationsEnabled
    )
    this.store.setAlertStates(this.alertStates)
  }

  private async syncAuthSources(): Promise<void> {
    const [chatgpt, claude] = await Promise.all([
      resolveChatGptAuthSource(() => this.store.getImportedChatGptSession()),
      resolveClaudeAuthSource(() => this.store.getImportedClaudeCookie())
    ])
    const gemini = resolveGeminiAuthSource(() => this.store.getImportedGeminiCookie())
    this.authSources = { chatgpt, gemini, claude }
  }

  private async refreshSingleProvider(providerId: ProviderId): Promise<void> {
    if (this.settings.dataSourceMode !== 'live') return
    const adapter = this.registry.get(providerId)
    if (!adapter) return

    this.activeRefreshCount += 1
    this.emit()
    try {
      await this.syncAuthSources()
      const result = await adapter.collect()
      this.applyLiveResult(providerId, result)
      const now = Date.now()
      this.lastUpdatedAt = now
      this.store.setCachedUsages(this.usages, now)
      this.processNotifications()
    } finally {
      this.activeRefreshCount = Math.max(0, this.activeRefreshCount - 1)
      this.emit()
    }
  }

  private recordLog(input: {
    providerId: ProviderId | 'system'
    level: 'info' | 'warn' | 'error'
    message: string
    strategy?: string
    httpStatus?: number
    snippet?: string
  }): void {
    const entry = createDebugLogEntry(input)
    this.store.appendDebugLogEntry(entry)
  }

  private applyLiveResult(providerId: ProviderId, result: ProviderCollectResult): void {
    const { usage } = result
    const rateLimited = Boolean(result.rateLimited)

    if (rateLimited) {
      const prev = this.rateLimitBackoff.get(providerId)
      const attempts = (prev?.attempts ?? 0) + 1
      const stepIdx = Math.min(attempts - 1, RATE_LIMIT_BACKOFF_STEPS_MS.length - 1)
      const delayMs = RATE_LIMIT_BACKOFF_STEPS_MS[stepIdx]
      this.rateLimitBackoff.set(providerId, {
        attempts,
        until: Date.now() + delayMs
      })
      this.recordLog({
        providerId,
        level: 'warn',
        strategy: result.strategy,
        httpStatus: result.httpStatus ?? 429,
        message: `요청 제한(429) 감지 — ${Math.round(delayMs / 60_000)}분 백오프 적용`,
        snippet: result.diagnostic ?? usage.errorMessage
      })
    } else if (usage.status === 'ok') {
      this.rateLimitBackoff.delete(providerId)
      const planPart = usage.planName ? ` (${usage.planName})` : ''
      const pctPart =
        usage.sessionRemainingPct !== null
          ? `세션 ${usage.sessionRemainingPct}%` +
            (usage.weeklyRemainingPct !== null ? ` / 주간 ${usage.weeklyRemainingPct}%` : '')
          : 'N/A (사용량 미제공)'
      this.recordLog({
        providerId,
        level: 'info',
        strategy: result.strategy,
        httpStatus: result.httpStatus,
        message: `조회 성공${planPart} · ${pctPart}`,
        snippet: result.diagnostic
      })
    } else if (usage.status === 'auth_required') {
      const isUnconnected = this.authSources[providerId] === 'none'
      this.recordLog({
        providerId,
        level: isUnconnected ? 'info' : 'warn',
        strategy: result.strategy,
        httpStatus: result.httpStatus,
        message: isUnconnected ? '미연결 상태 (N/A)' : '세션 만료 또는 인증 필요',
        snippet: result.diagnostic ?? usage.errorMessage
      })
    } else {
      this.recordLog({
        providerId,
        level: 'error',
        strategy: result.strategy,
        httpStatus: result.httpStatus,
        message: usage.errorMessage ?? '사용량 조회 오류',
        snippet: result.diagnostic
      })
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
        this.processNotifications()
        return
      }

      await this.syncAuthSources()
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
        this.applyLiveResult(item.id, item.res)
      }

      const completedAt = Date.now()
      this.lastUpdatedAt = completedAt
      this.store.setCachedUsages(this.usages, completedAt)
      this.processNotifications()
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
