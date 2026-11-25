import { safeStorage } from 'electron'
import Store from 'electron-store'
import { DEFAULT_SETTINGS, REFRESH_INTERVAL_OPTIONS } from '../shared/constants'
import type {
  AppSettings,
  ProviderId,
  ProviderUsage,
  RefreshIntervalMinutes
} from '../shared/types'
import type { ChatGptCredential } from './providers/chatgptAuth'

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

export class AppStore {
  private readonly store: Store<PersistedSchema>

  constructor() {
    this.store = new Store<PersistedSchema>({
      name: 'ai-energy-bar-config',
      defaults: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        settings: DEFAULT_SETTINGS,
        cachedUsages: null,
        lastUpdatedAt: null,
        importedChatGptSession: null
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
    return mergeSettings(DEFAULT_SETTINGS, raw)
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const next = mergeSettings(this.getSettings(), patch)
    this.store.set('settings', next)
    return next
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

  saveImportedChatGptSession(credential: ChatGptCredential): void {
    const serialized = JSON.stringify(credential)
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const cipher = safeStorage.encryptString(serialized).toString('base64')
        this.store.set('importedChatGptSession', { encrypted: true, payload: cipher })
        return
      }
    } catch {
      // Fallback to local unencrypted JSON if OS keychain encryption is unavailable
    }
    this.store.set('importedChatGptSession', { encrypted: false, payload: serialized })
  }

  getImportedChatGptSession(): ChatGptCredential | null {
    const blob = this.store.get('importedChatGptSession')
    if (!blob || typeof blob.payload !== 'string') return null

    try {
      const jsonText = blob.encrypted
        ? safeStorage.decryptString(Buffer.from(blob.payload, 'base64'))
        : blob.payload
      const parsed = JSON.parse(jsonText) as ChatGptCredential
      if (parsed && typeof parsed.accessToken === 'string' && parsed.accessToken.length >= 20) {
        return {
          accessToken: parsed.accessToken,
          accountId: typeof parsed.accountId === 'string' ? parsed.accountId : null,
          expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
          source: 'imported_session'
        }
      }
      return null
    } catch {
      return null
    }
  }

  clearImportedChatGptSession(): void {
    this.store.set('importedChatGptSession', null)
  }
}
