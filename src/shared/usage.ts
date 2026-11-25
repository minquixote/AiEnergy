import { ENERGY_THRESHOLDS, PROVIDER_ORDER } from './constants'
import type {
  DataSourceMode,
  EnergyLevel,
  ProviderAuthSource,
  ProviderId,
  ProviderUsage,
  TrayBadgeKind,
  TrayItemSummary,
  TraySummary
} from './types'

export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function calculateRemainingPct(usedPct: number): number {
  return clampPercentage(100 - usedPct)
}

export function getEnergyLevel(remainingPct: number | null): EnergyLevel {
  if (remainingPct === null || !Number.isFinite(remainingPct)) {
    return 'unknown'
  }
  const pct = clampPercentage(remainingPct)
  if (pct >= ENERGY_THRESHOLDS.HIGH_MIN) return 'high'
  if (pct >= ENERGY_THRESHOLDS.MEDIUM_MIN) return 'medium'
  return 'low'
}

export function getEnergyLevelLabel(level: EnergyLevel): string {
  switch (level) {
    case 'high':
      return '여유'
    case 'medium':
      return '주의'
    case 'low':
      return '경고'
    default:
      return '미확인'
  }
}

export interface TraySummaryContext {
  authSources?: Partial<Record<ProviderId, ProviderAuthSource>>
  dataSourceMode?: DataSourceMode
}

export function computeTraySummary(
  usages: Record<ProviderId, ProviderUsage>,
  enabledProviders: Record<ProviderId, boolean>,
  context?: TraySummaryContext
): TraySummary {
  const items: TrayItemSummary[] = []
  let lowestRemainingPct: number | null = null
  let lowestProviderId: ProviderId | null = null
  let connectedCount = 0
  let enabledCount = 0

  for (const id of PROVIDER_ORDER) {
    if (!enabledProviders[id]) continue
    enabledCount += 1

    const usage = usages[id]
    const isOkWithPct = Boolean(usage && usage.status === 'ok' && usage.sessionRemainingPct !== null)
    const pct =
      isOkWithPct && usage.sessionRemainingPct !== null
        ? clampPercentage(usage.sessionRemainingPct)
        : null

    let badgeKind: TrayBadgeKind
    if (isOkWithPct && pct !== null) {
      badgeKind = 'percentage'
    } else if (usage?.status === 'ok' && usage.sessionRemainingPct === null) {
      // Connected account whose plan (e.g. Claude Free) does not expose numeric % usage windows
      badgeKind = 'unavailable'
    } else if (
      usage?.status === 'auth_required' &&
      context?.dataSourceMode === 'live' &&
      context?.authSources?.[id] === 'none'
    ) {
      // Unsubscribed or not-yet-connected platform should show calm N/A instead of urgent !
      badgeKind = 'unavailable'
    } else {
      badgeKind = 'alert'
    }

    items.push({
      id,
      status: usage?.status ?? 'error',
      remainingPct: pct,
      level: getEnergyLevel(pct),
      badgeKind
    })

    if (!isOkWithPct || pct === null) continue

    connectedCount += 1
    if (lowestRemainingPct === null || pct < lowestRemainingPct) {
      lowestRemainingPct = pct
      lowestProviderId = id
    }
  }

  return {
    items,
    lowestRemainingPct,
    lowestProviderId,
    level: getEnergyLevel(lowestRemainingPct),
    connectedCount,
    enabledCount
  }
}

export function getCooldownRemainingMs(cooldownUntil: number, now: number = Date.now()): number {
  return Math.max(0, cooldownUntil - now)
}

export function formatRelativeTime(timestamp: number | null, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '업데이트 기록 없음'
  }
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (diffSec < 60) return '방금 업데이트됨'

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}시간 전`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function parseResetTimestamp(resetAt: string | null): Date | null {
  if (!resetAt) return null
  if (!ISO_DATE_PATTERN.test(resetAt)) return null
  const parsed = new Date(resetAt)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatKoreanClock(date: Date): string {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const period = hours < 12 ? '오전' : '오후'
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const paddedMinutes = String(minutes).padStart(2, '0')
  return `${period} ${hour12}:${paddedMinutes}`
}

export function formatResetTime(resetAt: string | null, includeDate = false): string | null {
  if (!resetAt) return null
  const date = parseResetTimestamp(resetAt)
  if (!date) {
    return resetAt.includes('초기화') ? resetAt : `${resetAt} 초기화`
  }

  const clock = formatKoreanClock(date)
  if (includeDate) {
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}/${day} ${clock} 초기화`
  }
  return `${clock} 초기화`
}

export function formatCountdown(resetAt: string | null, now: number = Date.now()): string | null {
  const date = parseResetTimestamp(resetAt)
  if (!date) return null

  const diffMs = date.getTime() - now
  if (diffMs <= 0) return '곧 초기화'

  const totalMinutes = Math.ceil(diffMs / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return hours > 0 ? `${days}일 ${hours}시간 후` : `${days}일 후`
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분 후` : `${hours}시간 후`
  }
  if (diffMs < 60_000) {
    const seconds = Math.max(1, Math.ceil(diffMs / 1000))
    return `${seconds}초 후`
  }
  return `${minutes}분 후`
}
