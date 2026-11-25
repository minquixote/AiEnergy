import { calculateRemainingPct, clampPercentage } from '../../shared/usage'
import type { ProviderUsage } from '../../shared/types'

export interface ParsedClaudeUsage {
  sessionRemainingPct: number | null
  sessionResetAt: string | null
  weeklyRemainingPct: number | null
  weeklyResetAt: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIsoOrRaw(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return parsed.toISOString()
  }
  return trimmed
}

function parseUtilizationWindow(
  obj: unknown
): { remainingPct: number; resetAt: string | null } | null {
  if (!isObject(obj)) return null
  const util = obj['utilization']
  if (typeof util === 'number' && Number.isFinite(util)) {
    return {
      remainingPct: calculateRemainingPct(util),
      resetAt: parseIsoOrRaw(obj['resets_at'])
    }
  }
  const percent = obj['percent']
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    return {
      remainingPct: calculateRemainingPct(percent),
      resetAt: parseIsoOrRaw(obj['resets_at'])
    }
  }
  return null
}

/**
 * Parses `https://claude.ai/api/organizations/{orgId}/usage` and
 * `https://api.anthropic.com/api/oauth/usage` responses.
 */
export function parseClaudeUsageJson(payload: unknown): ParsedClaudeUsage | null {
  if (!isObject(payload)) return null

  const fiveHour = parseUtilizationWindow(payload['five_hour'])
  let sevenDay = parseUtilizationWindow(payload['seven_day'])

  // Fallback for newer `limits[]` array containing `{ kind: "weekly_all", percent, resets_at }`
  if (!sevenDay && Array.isArray(payload['limits'])) {
    const weeklyEntry = payload['limits']
      .filter(isObject)
      .find((entry) => entry['kind'] === 'weekly_all')
    if (weeklyEntry) {
      sevenDay = parseUtilizationWindow(weeklyEntry)
    }
  }

  if (!fiveHour && !sevenDay) return null

  const effectiveSession = fiveHour ?? sevenDay
  return {
    sessionRemainingPct: effectiveSession ? effectiveSession.remainingPct : null,
    sessionResetAt: effectiveSession ? effectiveSession.resetAt : null,
    weeklyRemainingPct: sevenDay ? sevenDay.remainingPct : null,
    weeklyResetAt: sevenDay ? sevenDay.resetAt : null
  }
}

export function extractClaudeOrgId(orgsPayload: unknown): string | null {
  if (!Array.isArray(orgsPayload)) return null
  for (const entry of orgsPayload) {
    if (!isObject(entry)) continue
    const uuid = entry['uuid'] ?? entry['id']
    if (typeof uuid === 'string' && uuid.trim().length > 0) {
      return uuid.trim()
    }
  }
  return null
}

function parsePctFromChunk(chunk: string): number | null {
  const remainingMatch =
    chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:remaining|left|남음)/i) ??
    chunk.match(/(?:remaining|남은\s*(?:사용량|한도)?)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)
  if (remainingMatch) return clampPercentage(Number(remainingMatch[1]))

  const usedMatch =
    chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used|사용됨|사용)/i) ??
    chunk.match(/(?:used|사용량)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i)
  if (usedMatch) return calculateRemainingPct(Number(usedMatch[1]))

  return null
}

function parseResetFromChunk(chunk: string, now: number): string | null {
  const relEn = chunk.match(
    /resets?\s+in\s+(?:(\d+)\s*d(?:ays?)?)?\s*(?:(\d+)\s*h(?:ours?|r)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?/i
  )
  if (relEn && (relEn[1] || relEn[2] || relEn[3])) {
    const offsetMs =
      ((Number(relEn[1] ?? 0) * 24 + Number(relEn[2] ?? 0)) * 60 + Number(relEn[3] ?? 0)) * 60_000
    if (offsetMs > 0) return new Date(now + offsetMs).toISOString()
  }

  const koAbs = chunk.match(
    /((?:\d{1,2}\/\d{1,2}\s+)?(?:오전|오후)\s*\d{1,2}:\d{2})\s*(?:에\s*)?(?:초기화|리셋)/i
  )
  if (koAbs) return koAbs[1].trim()

  const enAbs = chunk.match(/resets?\s+(?:at|on)?\s*([A-Za-z0-9,:\/\s]+?)(?:\n|\.|$)/i)
  if (enAbs?.[1]?.trim()) return enAbs[1].trim()

  return null
}

export function parseClaudeUsageDomText(
  domText: string,
  now: number = Date.now()
): ParsedClaudeUsage | null {
  if (!domText || !domText.trim()) return null

  const normalized = domText.replace(/\r\n/g, '\n')
  const weeklyIdx = normalized.search(/(?:weekly\s+limits?|all\s+models|주간\s*한도|주간\s*사용량)/i)
  const sessionIdx = normalized.search(/(?:current\s+session|5-hour|현재\s*세션|5시간)/i)

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
    sessionChunk = normalized.slice(0, 700)
  }

  const sPct = sessionChunk ? parsePctFromChunk(sessionChunk) : null
  const wPct = weeklyChunk ? parsePctFromChunk(weeklyChunk) : null
  if (sPct === null && wPct === null) return null

  return {
    sessionRemainingPct: sPct ?? wPct,
    sessionResetAt: sessionChunk ? parseResetFromChunk(sessionChunk, now) : null,
    weeklyRemainingPct: wPct,
    weeklyResetAt: weeklyChunk ? parseResetFromChunk(weeklyChunk, now) : null
  }
}

export function buildClaudeProviderUsage(
  parsed: ParsedClaudeUsage,
  now: number = Date.now()
): ProviderUsage {
  return {
    id: 'claude',
    status: 'ok',
    sessionRemainingPct: parsed.sessionRemainingPct,
    sessionResetAt: parsed.sessionResetAt,
    weeklyRemainingPct: parsed.weeklyRemainingPct,
    weeklyResetAt: parsed.weeklyResetAt,
    updatedAt: now
  }
}
