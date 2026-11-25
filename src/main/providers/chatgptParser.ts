import { formatChatGptPlanName } from '../../shared/planNames'
import { calculateRemainingPct, clampPercentage } from '../../shared/usage'
import type { ProviderUsage } from '../../shared/types'

interface WhamWindow {
  used_percent?: number | null
  remaining_percent?: number | null
  limit_window_seconds?: number | null
  reset_after_seconds?: number | null
  reset_at?: number | string | null
}

interface WhamRateLimit {
  allowed?: boolean
  limit_reached?: boolean
  primary_window?: WhamWindow | null
  secondary_window?: WhamWindow | null
}

interface WhamUsageResponse {
  plan_type?: string
  rate_limit?: WhamRateLimit | null
  primary_window?: WhamWindow | null
  secondary_window?: WhamWindow | null
}

export interface ParsedChatGptUsage {
  sessionRemainingPct: number | null
  sessionResetAt: string | null
  weeklyRemainingPct: number | null
  weeklyResetAt: string | null
  planType?: string
}

const ONE_DAY_SECONDS = 86_400

function toIsoTimestamp(value: number | string | null | undefined, resetAfterSeconds: number | null | undefined, now: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Distinguish Unix seconds (< 1e12) from milliseconds (>= 1e12)
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return value.trim()
  }

  if (typeof resetAfterSeconds === 'number' && Number.isFinite(resetAfterSeconds) && resetAfterSeconds >= 0) {
    return new Date(now + resetAfterSeconds * 1000).toISOString()
  }

  return null
}

function extractWindowRemainingPct(
  win: WhamWindow | null | undefined,
  rateLimit?: WhamRateLimit | null
): number | null {
  if (!win) return null
  if (typeof win.used_percent === 'number' && Number.isFinite(win.used_percent)) {
    return calculateRemainingPct(win.used_percent)
  }
  if (typeof win.remaining_percent === 'number' && Number.isFinite(win.remaining_percent)) {
    return clampPercentage(win.remaining_percent)
  }
  if (rateLimit && (rateLimit.allowed === false || rateLimit.limit_reached === true)) {
    return 0
  }
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Parses ChatGPT / Codex `/backend-api/wham/usage` JSON responses into normalized session & weekly limits.
 * Window classification follows `limit_window_seconds` (<= 24h => session, > 24h => weekly) rather than
 * assuming primary is always 5-hour.
 */
export function parseChatGptUsageJson(
  payload: unknown,
  now: number = Date.now()
): ParsedChatGptUsage | null {
  if (!isObject(payload)) return null

  const data = payload as WhamUsageResponse
  const rateLimit = isObject(data.rate_limit) ? (data.rate_limit as WhamRateLimit) : null
  const primary = (rateLimit?.primary_window ?? data.primary_window) ?? null
  const secondary = (rateLimit?.secondary_window ?? data.secondary_window) ?? null

  const windows: WhamWindow[] = [primary, secondary].filter(
    (w): w is WhamWindow => isObject(w)
  )

  if (windows.length === 0) {
    // Handle blocked account payload with no window objects
    if (rateLimit && (rateLimit.allowed === false || rateLimit.limit_reached === true)) {
      return {
        sessionRemainingPct: 0,
        sessionResetAt: null,
        weeklyRemainingPct: null,
        weeklyResetAt: null,
        planType: typeof data.plan_type === 'string' ? data.plan_type : undefined
      }
    }
    return null
  }

  let sessionWin: WhamWindow | null = null
  let weeklyWin: WhamWindow | null = null

  for (const win of windows) {
    const duration =
      typeof win.limit_window_seconds === 'number' && Number.isFinite(win.limit_window_seconds)
        ? win.limit_window_seconds
        : null

    if (duration !== null) {
      if (duration <= ONE_DAY_SECONDS && !sessionWin) {
        sessionWin = win
      } else if (duration > ONE_DAY_SECONDS && !weeklyWin) {
        weeklyWin = win
      }
    } else if (!sessionWin) {
      sessionWin = win
    } else if (!weeklyWin) {
      weeklyWin = win
    }
  }

  // Some plans (e.g. Team or weekly-only cap) only expose a single weekly window.
  // Surface it in sessionRemainingPct as well so the main energy bar always displays an active reading.
  const effectiveSessionWin = sessionWin ?? weeklyWin

  const sessionRemainingPct = extractWindowRemainingPct(effectiveSessionWin, rateLimit)
  const sessionResetAt = effectiveSessionWin
    ? toIsoTimestamp(effectiveSessionWin.reset_at, effectiveSessionWin.reset_after_seconds, now)
    : null

  const weeklyRemainingPct = weeklyWin ? extractWindowRemainingPct(weeklyWin, rateLimit) : null
  const weeklyResetAt = weeklyWin
    ? toIsoTimestamp(weeklyWin.reset_at, weeklyWin.reset_after_seconds, now)
    : null

  if (sessionRemainingPct === null && weeklyRemainingPct === null) {
    return null
  }

  return {
    sessionRemainingPct,
    sessionResetAt,
    weeklyRemainingPct,
    weeklyResetAt,
    planType: typeof data.plan_type === 'string' ? data.plan_type : undefined
  }
}

function parsePercentFromText(text: string): number | null {
  // Prefer explicit remaining phrasing first
  const remainingMatch =
    text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:remaining|left|남음|남아)/i) ??
    text.match(/(?:remaining|남은\s*(?:사용량|한도)?)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)
  if (remainingMatch) {
    return clampPercentage(Number(remainingMatch[1]))
  }

  // Otherwise invert "used" percentage
  const usedMatch =
    text.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used|사용됨|사용)/i) ??
    text.match(/(?:used|사용량)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)
  if (usedMatch) {
    return calculateRemainingPct(Number(usedMatch[1]))
  }

  return null
}

function parseResetFromText(text: string, now: number): string | null {
  // Relative duration in English: "Resets in 2h 35m", "Resets in 41m", "Resets in 5d 3h"
  const relEn = text.match(
    /resets?\s+in\s+(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|r)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i
  )
  if (relEn && (relEn[1] || relEn[2] || relEn[3])) {
    const days = Number(relEn[1] ?? 0)
    const hours = Number(relEn[2] ?? 0)
    const minutes = Number(relEn[3] ?? 0)
    const offsetMs = ((days * 24 + hours) * 60 + minutes) * 60_000
    if (offsetMs > 0) return new Date(now + offsetMs).toISOString()
  }

  // Relative duration in Korean: "2시간 35분 후 초기화", "41분 후 초기화"
  const relKo = text.match(
    /(?:(\d+)\s*일)?\s*(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?\s*후\s*(?:초기화|리셋)/i
  )
  if (relKo && (relKo[1] || relKo[2] || relKo[3])) {
    const days = Number(relKo[1] ?? 0)
    const hours = Number(relKo[2] ?? 0)
    const minutes = Number(relKo[3] ?? 0)
    const offsetMs = ((days * 24 + hours) * 60 + minutes) * 60_000
    if (offsetMs > 0) return new Date(now + offsetMs).toISOString()
  }

  // Absolute time phrasing in Korean: "오전 12:18 초기화", "12/1 오후 8:18 초기화"
  const absKo = text.match(
    /((?:\d{1,2}\/\d{1,2}\s+)?(?:오전|오후)\s*\d{1,2}:\d{2})\s*(?:에\s*)?(?:초기화|리셋)/i
  )
  if (absKo) {
    return absKo[1].trim()
  }

  // Absolute time phrasing in English: "Resets at 12:18 AM", "Resets Dec 1, 8:18 PM", "Resets on Dec 1 at 8:18 PM"
  const absEn = text.match(/resets?\s+(?:at|on)\s+([A-Za-z0-9,:\/\s]+?)(?:\n|\.|$)/i)
  if (absEn) {
    const raw = absEn[1].trim()
    return raw.length > 0 ? raw : null
  }

  return null
}

/**
 * Fallback parser for visible DOM innerText on ChatGPT's Usage / Codex Analytics page.
 * Handles both English and Korean UI copy.
 */
export function parseChatGptUsageDomText(
  domText: string,
  now: number = Date.now()
): ParsedChatGptUsage | null {
  if (!domText || domText.trim().length === 0) return null

  const normalized = domText.replace(/\r\n/g, '\n')
  const weeklyIdx = normalized.search(/(?:weekly\s+(?:usage\s+)?limit|7-day|7일\s*한도|주간\s*(?:사용량\s*)?한도|주간)/i)
  const sessionIdx = normalized.search(/(?:5-hour|5\s*hour|5시간|current\s+session|세션\s*한도)/i)

  let sessionChunk = ''
  let weeklyChunk = ''

  if (sessionIdx !== -1 && weeklyIdx !== -1) {
    if (sessionIdx < weeklyIdx) {
      sessionChunk = normalized.slice(sessionIdx, weeklyIdx)
      weeklyChunk = normalized.slice(weeklyIdx, weeklyIdx + 400)
    } else {
      weeklyChunk = normalized.slice(weeklyIdx, sessionIdx)
      sessionChunk = normalized.slice(sessionIdx, sessionIdx + 400)
    }
  } else if (sessionIdx !== -1) {
    sessionChunk = normalized.slice(sessionIdx, sessionIdx + 400)
  } else if (weeklyIdx !== -1) {
    weeklyChunk = normalized.slice(weeklyIdx, weeklyIdx + 400)
  } else {
    sessionChunk = normalized.slice(0, 800)
  }

  const parsedSessionPct = sessionChunk ? parsePercentFromText(sessionChunk) : null
  const parsedWeeklyPct = weeklyChunk ? parsePercentFromText(weeklyChunk) : null

  const sessionRemainingPct = parsedSessionPct ?? parsedWeeklyPct
  const sessionResetAt = sessionChunk
    ? parseResetFromText(sessionChunk, now)
    : weeklyChunk
      ? parseResetFromText(weeklyChunk, now)
      : null
  const weeklyRemainingPct = parsedWeeklyPct
  const weeklyResetAt = weeklyChunk ? parseResetFromText(weeklyChunk, now) : null

  if (sessionRemainingPct === null && weeklyRemainingPct === null) {
    return null
  }

  return {
    sessionRemainingPct,
    sessionResetAt,
    weeklyRemainingPct,
    weeklyResetAt
  }
}

export function buildChatGptProviderUsage(
  parsed: ParsedChatGptUsage,
  now: number = Date.now()
): ProviderUsage {
  return {
    id: 'chatgpt',
    status: 'ok',
    sessionRemainingPct: parsed.sessionRemainingPct,
    sessionResetAt: parsed.sessionResetAt,
    weeklyRemainingPct: parsed.weeklyRemainingPct,
    weeklyResetAt: parsed.weeklyResetAt,
    planName: formatChatGptPlanName(parsed.planType),
    updatedAt: now
  }
}
