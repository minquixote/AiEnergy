import type { EnergyLevel } from '@shared/types'
import { clampPercentage } from '@shared/usage'

interface EnergyBarProps {
  percentage: number | null
  level: EnergyLevel
  heightClass?: string
}

const LEVEL_BAR_COLOR: Record<EnergyLevel, string> = {
  high: 'var(--energy-high)',
  medium: 'var(--energy-medium)',
  low: 'var(--energy-low)',
  unknown: 'var(--energy-unknown)'
}

export function EnergyBar({ percentage, level, heightClass = 'h-2.5' }: EnergyBarProps) {
  const safePct = percentage === null ? 0 : clampPercentage(percentage)
  const visibleWidth = safePct > 0 ? Math.max(3, safePct) : 0

  return (
    <div
      className={`energy-track w-full overflow-hidden rounded-full ${heightClass}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage ?? undefined}
    >
      <div
        className="energy-fill h-full rounded-full"
        style={{
          width: `${visibleWidth}%`,
          backgroundColor: LEVEL_BAR_COLOR[level]
        }}
      />
    </div>
  )
}
