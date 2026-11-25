import { PROVIDER_ICON_PATHS } from '@shared/providerIcons'
import type { ProviderId } from '@shared/types'

interface ProviderIconProps {
  id: ProviderId
  className?: string
}

export function ProviderIcon({ id, className = 'w-4 h-4' }: ProviderIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d={PROVIDER_ICON_PATHS[id]} />
    </svg>
  )
}
