import { clampPercentage } from '../../shared/usage'
import type { MockScenarioId, ProviderId, ProviderUsage } from '../../shared/types'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function isoFromNow(now: number, offsetMs: number): string {
  return new Date(now + offsetMs).toISOString()
}

export function buildMockUsages(
  scenario: MockScenarioId,
  now: number = Date.now()
): Record<ProviderId, ProviderUsage> {
  switch (scenario) {
    case 'healthy':
      return {
        chatgpt: {
          id: 'chatgpt',
          status: 'ok',
          sessionRemainingPct: 88,
          sessionResetAt: isoFromNow(now, 3 * HOUR_MS + 18 * MINUTE_MS),
          weeklyRemainingPct: 96,
          weeklyResetAt: isoFromNow(now, 5 * DAY_MS + 4 * HOUR_MS),
          updatedAt: now
        },
        gemini: {
          id: 'gemini',
          status: 'ok',
          sessionRemainingPct: 64,
          sessionResetAt: isoFromNow(now, 2 * HOUR_MS + 5 * MINUTE_MS),
          weeklyRemainingPct: 91,
          weeklyResetAt: isoFromNow(now, 4 * DAY_MS + 9 * HOUR_MS),
          updatedAt: now
        },
        claude: {
          id: 'claude',
          status: 'ok',
          sessionRemainingPct: 95,
          sessionResetAt: isoFromNow(now, 4 * HOUR_MS + 42 * MINUTE_MS),
          weeklyRemainingPct: 99,
          weeklyResetAt: isoFromNow(now, 6 * DAY_MS + 2 * HOUR_MS),
          updatedAt: now
        }
      }

    case 'warning':
      return {
        chatgpt: {
          id: 'chatgpt',
          status: 'ok',
          sessionRemainingPct: 45,
          sessionResetAt: isoFromNow(now, 1 * HOUR_MS + 48 * MINUTE_MS),
          weeklyRemainingPct: 74,
          weeklyResetAt: isoFromNow(now, 3 * DAY_MS + 6 * HOUR_MS),
          updatedAt: now
        },
        gemini: {
          id: 'gemini',
          status: 'ok',
          sessionRemainingPct: 32,
          sessionResetAt: isoFromNow(now, 54 * MINUTE_MS),
          weeklyRemainingPct: 68,
          weeklyResetAt: isoFromNow(now, 2 * DAY_MS + 11 * HOUR_MS),
          updatedAt: now
        },
        claude: {
          id: 'claude',
          status: 'ok',
          sessionRemainingPct: 78,
          sessionResetAt: isoFromNow(now, 3 * HOUR_MS + 12 * MINUTE_MS),
          weeklyRemainingPct: 88,
          weeklyResetAt: isoFromNow(now, 5 * DAY_MS + 1 * HOUR_MS),
          updatedAt: now
        }
      }

    case 'auth_issue':
      return {
        chatgpt: {
          id: 'chatgpt',
          status: 'ok',
          sessionRemainingPct: 61,
          sessionResetAt: isoFromNow(now, 2 * HOUR_MS + 27 * MINUTE_MS),
          weeklyRemainingPct: 89,
          weeklyResetAt: isoFromNow(now, 4 * DAY_MS + 7 * HOUR_MS),
          updatedAt: now
        },
        gemini: {
          id: 'gemini',
          status: 'auth_required',
          sessionRemainingPct: null,
          sessionResetAt: null,
          weeklyRemainingPct: null,
          weeklyResetAt: null,
          updatedAt: now,
          errorMessage: '로그인 세션이 만료되었습니다. 카드를 클릭해 다시 연결해 주세요.'
        },
        claude: {
          id: 'claude',
          status: 'error',
          sessionRemainingPct: null,
          sessionResetAt: null,
          weeklyRemainingPct: null,
          weeklyResetAt: null,
          updatedAt: now,
          errorMessage: '사용량 응답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
        }
      }

    case 'balanced':
    default:
      return {
        chatgpt: {
          id: 'chatgpt',
          status: 'ok',
          sessionRemainingPct: 72,
          sessionResetAt: isoFromNow(now, 2 * HOUR_MS + 35 * MINUTE_MS),
          weeklyRemainingPct: 94,
          weeklyResetAt: isoFromNow(now, 5 * DAY_MS + 3 * HOUR_MS),
          updatedAt: now
        },
        gemini: {
          id: 'gemini',
          status: 'ok',
          sessionRemainingPct: 38,
          sessionResetAt: isoFromNow(now, 1 * HOUR_MS + 14 * MINUTE_MS),
          weeklyRemainingPct: 82,
          weeklyResetAt: isoFromNow(now, 3 * DAY_MS + 8 * HOUR_MS),
          updatedAt: now
        },
        claude: {
          id: 'claude',
          status: 'ok',
          sessionRemainingPct: 14,
          sessionResetAt: isoFromNow(now, 41 * MINUTE_MS),
          weeklyRemainingPct: 99,
          weeklyResetAt: isoFromNow(now, 6 * DAY_MS + 5 * HOUR_MS),
          updatedAt: now
        }
      }
  }
}

export function nudgeMockUsages(
  current: Record<ProviderId, ProviderUsage>,
  now: number = Date.now()
): Record<ProviderId, ProviderUsage> {
  const next = { ...current }
  for (const id of ['chatgpt', 'gemini', 'claude'] as const) {
    const item = current[id]
    if (item.status !== 'ok' || item.sessionRemainingPct === null) {
      next[id] = { ...item, updatedAt: now }
      continue
    }
    // Slight realistic tick (-1% or reset to 100% if depleted) on manual refresh in mock mode
    const adjusted =
      item.sessionRemainingPct <= 2 ? 100 : clampPercentage(item.sessionRemainingPct - 1)
    next[id] = {
      ...item,
      sessionRemainingPct: adjusted,
      updatedAt: now
    }
  }
  return next
}
