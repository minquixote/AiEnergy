import type { ProviderId } from '../../shared/types'
import type { AppStore } from '../store'
import type { ProviderAdapter } from './base'
import { createChatGptAdapter } from './chatgpt'
import { createClaudeAdapter } from './claude'
import { createGeminiAdapter } from './gemini'

export interface ProviderRegistry {
  get(id: ProviderId): ProviderAdapter | null
  isSupported(id: ProviderId): boolean
}

export function createProviderRegistry(store: AppStore): ProviderRegistry {
  const adapters: Record<ProviderId, ProviderAdapter> = {
    chatgpt: createChatGptAdapter(() => store.getImportedChatGptSession()),
    gemini: createGeminiAdapter(() => store.getImportedGeminiCookie()),
    claude: createClaudeAdapter(() => store.getImportedClaudeCookie())
  }

  return {
    get: (id) => adapters[id] ?? null,
    isSupported: (id) => Boolean(adapters[id])
  }
}
