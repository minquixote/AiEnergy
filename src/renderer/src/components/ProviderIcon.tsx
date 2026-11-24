import type { ProviderId } from '@shared/types'

interface ProviderIconProps {
  id: ProviderId
  className?: string
}

export function ProviderIcon({ id, className = 'w-4 h-4' }: ProviderIconProps) {
  switch (id) {
    case 'chatgpt':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M12 3.2c2.1 0 3.9 1.2 4.7 3 1.9.4 3.4 2.1 3.4 4.2 0 1.3-.6 2.5-1.6 3.3.5 1.9-.2 4-1.9 5-1.1.7-2.5.8-3.7.4-1.2 1.2-3 1.7-4.8 1.2-1.8-.5-3.1-2-3.3-3.8-1.8-.7-3-2.5-2.9-4.5.1-1.3.7-2.4 1.6-3.2-.4-1.9.3-3.9 2-4.9 1.1-.7 2.4-.8 3.6-.4.8-.8 1.8-1.3 2.9-1.3Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      )
    case 'gemini':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M12 2.8c1.1 4.6 4.6 8.1 9.2 9.2-4.6 1.1-8.1 4.6-9.2 9.2-1.1-4.6-4.6-8.1-9.2-9.2 4.6-1.1 8.1-4.6 9.2-9.2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'claude':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
          <path
            d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}
