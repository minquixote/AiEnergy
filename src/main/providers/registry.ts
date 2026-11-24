import type { ProviderId } from '../../shared/types'
import type { ProviderAdapter } from './base'
import { chatgptAdapter } from './chatgpt'

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  chatgpt: chatgptAdapter
}

export function getLiveProviderAdapter(id: ProviderId): ProviderAdapter | null {
  return ADAPTERS[id] ?? null
}

export function isLiveProviderSupported(id: ProviderId): boolean {
  return Boolean(ADAPTERS[id])
}
