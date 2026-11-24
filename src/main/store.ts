import Store from 'electron-store'
import { DEFAULT_SETTINGS, REFRESH_INTERVAL_OPTIONS } from '../shared/constants'
import type {
  AppSettings,
  ProviderId,
  ProviderUsage,
  RefreshIntervalMinutes
} from '../shared/types'

const CURRENT_SCHEMA_VERSION = 2

interface PersistedSchema {
  schemaVersion: number
  settings: AppSettings
  cachedUsages: Record<ProviderId, ProviderUsage> | null
  lastUpdatedAt: number | null
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
        lastUpdatedAt: null
      }
    })

    this.migrateIfNeeded()
  }

  private migrateIfNeeded(): void {
    const version = this.store.get('schemaVersion', 1)
    if (version < CURRENT_SCHEMA_VERSION) {
      // Phase 1 -> Phase 2 migration: switch default to live mode and clear Phase 1 mock cache
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
}
