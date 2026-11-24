import { AlertCircle, ArrowUpRight, Clock, KeyRound } from 'lucide-react'
import { LIVE_SUPPORTED_PROVIDERS, PROVIDER_META } from '@shared/constants'
import type { DataSourceMode, EnergyLevel, ProviderId, ProviderUsage } from '@shared/types'
import {
  clampPercentage,
  formatCountdown,
  formatResetTime,
  getEnergyLevel,
  getEnergyLevelLabel
} from '@shared/usage'
import { EnergyBar } from './EnergyBar'
import { ProviderIcon } from './ProviderIcon'

interface ProviderCardProps {
  usage: ProviderUsage
  dataSourceMode: DataSourceMode
  now: number
  onOpenLogin: (providerId: ProviderId) => void
  onOpenSettings: () => void
}

const LEVEL_TEXT_COLOR: Record<EnergyLevel, string> = {
  high: 'var(--energy-high-text)',
  medium: 'var(--energy-medium-text)',
  low: 'var(--energy-low-text)',
  unknown: 'var(--energy-unknown-text)'
}

const LEVEL_SOFT_BG: Record<EnergyLevel, string> = {
  high: 'var(--energy-high-soft)',
  medium: 'var(--energy-medium-soft)',
  low: 'var(--energy-low-soft)',
  unknown: 'var(--energy-unknown-soft)'
}

export function ProviderCard({
  usage,
  dataSourceMode,
  now,
  onOpenLogin,
  onOpenSettings
}: ProviderCardProps) {
  const meta = PROVIDER_META[usage.id]
  const isPhase3Pending =
    dataSourceMode === 'live' && !LIVE_SUPPORTED_PROVIDERS.includes(usage.id)
  const isActionable = usage.status !== 'ok'

  const sessionPct =
    usage.status === 'ok' && usage.sessionRemainingPct !== null
      ? clampPercentage(usage.sessionRemainingPct)
      : null
  const level = getEnergyLevel(sessionPct)
  const levelLabel = getEnergyLevelLabel(level)

  const sessionResetLabel = formatResetTime(usage.sessionResetAt, false)
  const sessionCountdown = formatCountdown(usage.sessionResetAt, now)

  const weeklyPct =
    usage.status === 'ok' && usage.weeklyRemainingPct !== null
      ? clampPercentage(usage.weeklyRemainingPct)
      : null
  const weeklyResetLabel = formatResetTime(usage.weeklyResetAt, true)

  const badge = (() => {
    if (isPhase3Pending) {
      return {
        label: 'Phase 3 예정',
        dotColor: 'var(--energy-unknown)',
        textColor: 'var(--energy-unknown-text)',
        bgColor: 'var(--energy-unknown-soft)'
      }
    }
    if (usage.status === 'ok') {
      return {
        label: '연동됨',
        dotColor: 'var(--energy-high)',
        textColor: 'var(--energy-high-text)',
        bgColor: 'var(--energy-high-soft)'
      }
    }
    if (usage.status === 'auth_required') {
      return {
        label: '재로그인 필요',
        dotColor: 'var(--energy-medium)',
        textColor: 'var(--energy-medium-text)',
        bgColor: 'var(--energy-medium-soft)'
      }
    }
    return {
      label: '조회 실패',
      dotColor: 'var(--energy-low)',
      textColor: 'var(--energy-low-text)',
      bgColor: 'var(--energy-low-soft)'
    }
  })()

  const cardInner = (
    <>
      {/* Row 1: Provider identity + Status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--text-primary)'
            }}
          >
            <ProviderIcon id={usage.id} className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">
              {meta.name}
            </span>
            <span className="truncate text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
              {meta.planLabel}
            </span>
          </div>
        </div>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{
            backgroundColor: badge.bgColor,
            color: badge.textColor
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: badge.dotColor }}
          />
          {badge.label}
        </span>
      </div>

      {/* Row 2+: Usage bars or actionable error/auth prompt */}
      {usage.status === 'ok' && sessionPct !== null ? (
        <div className="mt-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-[19px] font-bold tracking-[-0.02em] leading-none tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {sessionPct}%
              </span>
              <span className="text-[11.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                남음
              </span>
            </div>

            <span
              className="rounded px-1.5 py-[1px] text-[10px] font-semibold"
              style={{
                backgroundColor: LEVEL_SOFT_BG[level],
                color: LEVEL_TEXT_COLOR[level]
              }}
            >
              {levelLabel}
            </span>
          </div>

          <EnergyBar percentage={sessionPct} level={level} />

          <div
            className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="truncate">{sessionResetLabel ?? '초기화 시각 정보 없음'}</span>
            {sessionCountdown && (
              <span
                className="shrink-0 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {sessionCountdown}
              </span>
            )}
          </div>

          {weeklyPct !== null && (
            <div
              className="mt-2.5 flex items-center justify-between gap-2 pt-2 text-[11px] tabular-nums"
              style={{
                borderTop: '1px solid var(--border-hairline)',
                color: 'var(--text-secondary)'
              }}
            >
              <span className="truncate">
                주간 <strong style={{ color: 'var(--text-primary)' }}>{weeklyPct}%</strong> 남음
                {weeklyResetLabel ? ` · ${weeklyResetLabel}` : ''}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2">
          <p
            className="text-[11.5px] leading-relaxed text-left"
            style={{ color: 'var(--text-secondary)' }}
          >
            {usage.errorMessage ??
              (usage.status === 'auth_required'
                ? '로그인 세션이 만료되었습니다. 다시 연결해 주세요.'
                : '사용량을 가져오는 중 오류가 발생했습니다.')}
          </p>
          <div
            className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--text-primary)'
            }}
          >
            <span className="flex items-center gap-1.5">
              {isPhase3Pending ? (
                <Clock className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
              ) : usage.status === 'auth_required' ? (
                <KeyRound className="h-3.5 w-3.5" style={{ color: 'var(--energy-medium-text)' }} />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" style={{ color: 'var(--energy-low-text)' }} />
              )}
              {isPhase3Pending
                ? '설정에서 표시 관리'
                : usage.status === 'auth_required'
                  ? '클릭하여 로그인 창 열기'
                  : '클릭하여 세션 확인'}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          </div>
        </div>
      )}
    </>
  )

  if (isActionable) {
    return (
      <button
        id={`card-provider-${usage.id}`}
        type="button"
        onClick={() => (isPhase3Pending ? onOpenSettings() : onOpenLogin(usage.id))}
        className="surface-card surface-card-interactive block w-full p-3 text-left"
      >
        {cardInner}
      </button>
    )
  }

  return (
    <section id={`card-provider-${usage.id}`} className="surface-card p-3">
      {cardInner}
    </section>
  )
}
