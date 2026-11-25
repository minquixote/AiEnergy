import type { ProviderId } from '../../shared/types'
import type { AppStore } from '../store'
import type { ProviderAdapter } from './base'
import { createChatGptAdapter } from './chatgpt'

export interface ProviderRegistry {
  get(id: ProviderId): ProviderAdapter | null
  isSupported(id: ProviderId): boolean
}

export function createProviderRegistry(store: AppStore): ProviderRegistry {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {
    chatgpt: createChatGptAdapter(() => store.getImportedChatGptSession())
  }

  return {
    get: (id) => adapters[id] ?? null,
    isSupported: (id) => Boolean(adapters[id])
  }
}
