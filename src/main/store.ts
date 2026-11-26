import { safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, REFRESH_INTERVAL_OPTIONS } from '../shared/constants'
import type {
  AppSettings,
  DebugLogEntry,
  FloatingBarPosition,
  ProviderAlertState,
  ProviderId,
  ProviderUsage,
  RefreshIntervalMinutes
} from '../shared/types'
import { appendDebugLog, MAX_DEBUG_LOG_ENTRIES } from './debugLog'
import { createInitialAlertStateMap } from './notifier'
import type { ChatGptCredential } from './providers/chatgptAuth'
import type { ClaudeCookieCredential } from './providers/claudeAuth'
import type { GeminiCookieCredential } from './providers/geminiAuth'

const CURRENT_SCHEMA_VERSION = 2

interface StoredCredentialBlob {
  encrypted: boolean
  payload: string
}

interface PersistedSchema {
  schemaVersion: number
  settings: AppSettings
  cachedUsages: Record<ProviderId, ProviderUsage> | null
  lastUpdatedAt: number | null
  importedChatGptSession: StoredCredentialBlob | null
  importedGeminiCookie: StoredCredentialBlob | null
  importedClaudeCookie: StoredCredentialBlob | null
  alertStates: Record<ProviderId, ProviderAlertState>
  debugLogs: DebugLogEntry[]
  floatingBarPosition: FloatingBarPosition | null
}

function getPlatformDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    showFloatingBar: process.platform === 'win32',
    enabledProviders: { ...DEFAULT_SETTINGS.enabledProviders }
  }
}

function sanitizeRefreshInterval(
  value: unknown,
  fallback: RefreshIntervalMinutes
): RefreshIntervalMinutes {
  if (typeof value === 'number' && (REFRESH_INTERVAL_OPTIONS as readonly number[]).includes(value)) {
    return value as RefreshIntervalMinutes
  }
  return fallback
}

export function mergeSettings(
  base: AppSettings,
  patch?: Partial<AppSettings> | null
): AppSettings {
  if (!patch) {
    return {
      ...base,
      refreshIntervalMinutes: sanitizeRefreshInterval(
        base.refreshIntervalMinutes,
        DEFAULT_SETTINGS.refreshIntervalMinutes
      ),
      enabledProviders: { ...base.enabledProviders }
    }
  }
  return {
    ...base,
    ...patch,
    refreshIntervalMinutes: sanitizeRefreshInterval(
      patch.refreshIntervalMinutes ?? base.refreshIntervalMinutes,
      DEFAULT_SETTINGS.refreshIntervalMinutes
    ),
    enabledProviders: {
      ...base.enabledProviders,
      ...(patch.enabledProviders ?? {})
    }
  }
}

function encodeSecretBlob(value: unknown): StoredCredentialBlob {
  const serialized = JSON.stringify(value)
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const cipher = safeStorage.encryptString(serialized).toString('base64')
      return { encrypted: true, payload: cipher }
    }
  } catch {
    // Fallback to local unencrypted JSON if OS keychain encryption is unavailable
  }
  return { encrypted: false, payload: serialized }
}

function decodeSecretBlob<T>(blob: StoredCredentialBlob | null | undefined): T | null {
  if (!blob || typeof blob.payload !== 'string') return null
  try {
    const jsonText = blob.encrypted
      ? safeStorage.decryptString(Buffer.from(blob.payload, 'base64'))
      : blob.payload
    return JSON.parse(jsonText) as T
  } catch {
    return null
  }
}

export class AppStore {
  private readonly store: Store<PersistedSchema>

  constructor() {
    this.store = new Store<PersistedSchema>({
      name: 'ai-energy-bar-config',
      defaults: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settings: getPlatformDefaultSettings(),
        cachedUsages: null,
        lastUpdatedAt: null,
        importedChatGptSession: null,
        importedGeminiCookie: null,
        importedClaudeCookie: null,
        alertStates: createInitialAlertStateMap(),
        debugLogs: [],
        floatingBarPosition: null
      }
    })

    this.migrateIfNeeded()
  }

  private migrateIfNeeded(): void {
    const version = this.store.get('schemaVersion', 1)
    if (version < CURRENT_SCHEMA_VERSION) {
      const current = this.getSettings()
      this.store.set('settings', {
        ...current,
        dataSourceMode: 'live'
      })
      this.store.set('cachedUsages', null)
      this.store.set('lastUpdatedAt', null)
      this.store.set('schemaVersion', CURRENT_SCHEMA_VERSION)
    }
  }

  getSettings(): AppSettings {
    const raw = this.store.get('settings')
    return mergeSettings(getPlatformDefaultSettings(), raw)
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = mergeSettings(this.getSettings(), patch)
    this.store.set('settings', next)
    return next
  }

  getFloatingBarPosition(): FloatingBarPosition | null {
    const raw = this.store.get('floatingBarPosition')
    if (
      raw &&
      typeof raw.x === 'number' &&
      Number.isFinite(raw.x) &&
      typeof raw.y === 'number' &&
      Number.isFinite(raw.y)
    ) {
      return { x: Math.round(raw.x), y: Math.round(raw.y) }
    }
    return null
  }

  setFloatingBarPosition(position: FloatingBarPosition | null): void {
    this.store.set('floatingBarPosition', position)
  }

  getCachedUsages(): Record<ProviderId, ProviderUsage> | null {
    return this.store.get('cachedUsages') ?? null
  }

  setCachedUsages(usages: Record<ProviderId, ProviderUsage>, updatedAt: number): void {
    this.store.set('cachedUsages', usages)
    this.store.set('lastUpdatedAt', updatedAt)
  }

  clearCachedUsages(): void {
    this.store.set('cachedUsages', null)
    this.store.set('lastUpdatedAt', null)
  }

  getLastUpdatedAt(): number | null {
    return this.store.get('lastUpdatedAt') ?? null
  }

  getAlertStates(): Record<ProviderId, ProviderAlertState> {
    const defaults = createInitialAlertStateMap()
    const raw = this.store.get('alertStates')
    if (!raw) return defaults
    return {
      chatgpt: raw.chatgpt ?? defaults.chatgpt,
      gemini: raw.gemini ?? defaults.gemini,
      claude: raw.claude ?? defaults.claude
    }
  }

  setAlertStates(states: Record<ProviderId, ProviderAlertState>): void {
    this.store.set('alertStates', states)
  }

  resetAlertStates(): void {
    this.store.set('alertStates', createInitialAlertStateMap())
  }

  // ChatGPT imported session (kept on original key so existing Phase 2 sessions survive seamlessly)
  saveImportedChatGptSession(credential: ChatGptCredential): void {
    this.store.set('importedChatGptSession', encodeSecretBlob(credential))
  }

  getImportedChatGptSession(): ChatGptCredential | null {
    const parsed = decodeSecretBlob<ChatGptCredential>(this.store.get('importedChatGptSession'))
    if (!parsed || typeof parsed.accessToken !== 'string' || parsed.accessToken.length < 20) {
      return null
    }
    return {
      accessToken: parsed.accessToken,
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : null,
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
      source: 'imported_session'
    }
  }

  clearImportedChatGptSession(): void {
    this.store.set('importedChatGptSession', null)
  }

  // Gemini imported Cookie header
  saveImportedGeminiCookie(credential: GeminiCookieCredential): void {
    this.store.set('importedGeminiCookie', encodeSecretBlob(credential))
  }

  getImportedGeminiCookie(): GeminiCookieCredential | null {
    const parsed = decodeSecretBlob<GeminiCookieCredential>(this.store.get('importedGeminiCookie'))
    if (!parsed || typeof parsed.cookieHeader !== 'string' || !parsed.cookieHeader.includes('=')) {
      return null
    }
    const authUserIndex =
      typeof parsed.authUserIndex === 'number' &&
      Number.isInteger(parsed.authUserIndex) &&
      parsed.authUserIndex > 0 &&
      parsed.authUserIndex <= 20
        ? parsed.authUserIndex
        : undefined
    return {
      cookieHeader: parsed.cookieHeader,
      ...(authUserIndex ? { authUserIndex } : {}),
      source: 'imported_cookie'
    }
  }

  clearImportedGeminiCookie(): void {
    this.store.set('importedGeminiCookie', null)
  }

  // Claude imported sessionKey / Cookie header
  saveImportedClaudeCookie(credential: ClaudeCookieCredential): void {
    this.store.set('importedClaudeCookie', encodeSecretBlob(credential))
  }

  getImportedClaudeCookie(): ClaudeCookieCredential | null {
    const parsed = decodeSecretBlob<ClaudeCookieCredential>(this.store.get('importedClaudeCookie'))
    if (!parsed || typeof parsed.cookieHeader !== 'string' || !parsed.cookieHeader.includes('=')) {
      return null
    }
    return {
      cookieHeader: parsed.cookieHeader,
      source: 'imported_cookie'
    }
  }

  clearImportedClaudeCookie(): void {
    this.store.set('importedClaudeCookie', null)
  }

  getDebugLogs(): DebugLogEntry[] {
    const logs = this.store.get('debugLogs')
    return Array.isArray(logs) ? logs : []
  }

  appendDebugLogEntry(entry: DebugLogEntry): DebugLogEntry[] {
    const next = appendDebugLog(this.getDebugLogs(), entry, MAX_DEBUG_LOG_ENTRIES)
    this.store.set('debugLogs', next)
    return next
  }

  clearDebugLogs(): DebugLogEntry[] {
    this.store.set('debugLogs', [])
    return []
  }
}
