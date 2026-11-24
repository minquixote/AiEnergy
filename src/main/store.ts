import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '../shared/constants'
import type { AppSettings, ProviderId, ProviderUsage } from '../shared/types'

interface PersistedSchema {
  settings: AppSettings
  cachedUsages: Record<ProviderId, ProviderUsage> | null
  lastUpdatedAt: number | null
}

export function mergeSettings(
  base: AppSettings,
  patch?: Partial<AppSettings> | null
): AppSettings {
  if (!patch) {
    return {
      ...base,
      enabledProviders: { ...base.enabledProviders }
    }
  }
  return {
    ...base,
    ...patch,
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
        settings: DEFAULT_SETTINGS,
        cachedUsages: null,
        lastUpdatedAt: null
      }
    })
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

  getLastUpdatedAt(): number | null {
    return this.store.get('lastUpdatedAt') ?? null
  }
}
