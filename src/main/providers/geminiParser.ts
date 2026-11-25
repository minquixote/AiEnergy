import { calculateRemainingPct, clampPercentage } from '../../shared/usage'
import type { ProviderUsage } from '../../shared/types'

export interface ParsedGeminiUsage {
  sessionRemainingPct: number | null
  sessionResetAt: string | null
  weeklyRemainingPct: number | null
  weeklyResetAt: string | null
  subscriptionTier?: string
}

export type GeminiGraphqlParseOutcome =
  | { kind: 'ok'; parsed: ParsedGeminiUsage }
  | { kind: 'auth_required' }
  | { kind: 'no_windows' }
  | { kind: 'invalid' }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toUsedPercent(rawValue: unknown): number | null {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
    return null
  }
  // Gemini GraphQL returns percentageUsed as a 0..1 fraction (e.g. 0.71 -> 71%).
  // Also tolerate 0..100 numeric values if the schema ever changes.
  const scaled = rawValue <= 1 ? rawValue * 100 : rawValue
  return Math.max(0, Math.min(100, scaled))
}

/**
 * Parses `https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery`
 * (`UsagePageQuery`) response containing `GXU_FIVE_HOURLY` and `GXU_WEEKLY` pools.
 */
export function parseGeminiGraphqlResponse(rawBodyText: string): GeminiGraphqlParseOutcome {
  const cleaned = rawBodyText.trim().replace(/^\)\]\}'\s*/, '')
  if (!cleaned || cleaned.startsWith('<')) {
    return { kind: 'auth_required' }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(cleaned)
  } catch {
    return { kind: 'invalid' }
  }

  const entries = Array.isArray(parsedJson) ? parsedJson : [parsedJson]
  const dataObjects = entries
    .map((item) => (isObject(item) && isObject(item['data']) ? item['data'] : null))
    .filter((d): d is Record<string, unknown> => d !== null)

  if (dataObjects.length === 0) {
    return { kind: 'invalid' }
  }

  const viewerContainer = dataObjects.find((d) => Object.prototype.hasOwnProperty.call(d, 'viewer'))
  if (!viewerContainer) {
    return { kind: 'invalid' }
  }

  if (viewerContainer['viewer'] === null) {
    return { kind: 'auth_required' }
  }

  const viewer = isObject(viewerContainer['viewer']) ? viewerContainer['viewer'] : null
  const rpcs = viewer && isObject(viewer['rpcs']) ? viewer['rpcs'] : null
  const usageInfo = rpcs && isObject(rpcs['getUsageInfo']) ? rpcs['getUsageInfo'] : null

  if (!usageInfo || !Array.isArray(usageInfo['pools'])) {
    return { kind: 'invalid' }
  }

  const pools = usageInfo['pools'].filter(isObject)

  const readPool = (
    poolType: 'GXU_FIVE_HOURLY' | 'GXU_WEEKLY'
  ): { remainingPct: number; resetAt: string | null } | null => {
    const match = pools.find((p) => p['poolType'] === poolType)
    if (!match) return null

    const usedPct = toUsedPercent(match['percentageUsed'])
    if (usedPct === null) return null

    const gxu = isObject(match['gxu']) ? match['gxu'] : null
    const resetAt = parseIsoDate(gxu?.['windowRefreshesAt'])
    return {
      remainingPct: calculateRemainingPct(usedPct),
      resetAt
    }
  }

  const fiveHour = readPool('GXU_FIVE_HOURLY')
  const weekly = readPool('GXU_WEEKLY')

  if (!fiveHour && !weekly) {
    return { kind: 'no_windows' }
  }

  const effectiveSession = fiveHour ?? weekly
  const tier = typeof usageInfo['subscriptionTier'] === 'string' ? usageInfo['subscriptionTier'] : undefined

  return {
    kind: 'ok',
    parsed: {
      sessionRemainingPct: effectiveSession ? effectiveSession.remainingPct : null,
      sessionResetAt: effectiveSession ? effectiveSession.resetAt : null,
      weeklyRemainingPct: weekly ? weekly.remainingPct : null,
      weeklyResetAt: weekly ? weekly.resetAt : null,
      subscriptionTier: tier
    }
  }
}

function extractPctFromChunk(chunk: string): number | null {
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

function extractResetFromChunk(chunk: string): string | null {
  const koAbs = chunk.match(
    /((?:\d{1,2}\/\d{1,2}\s+)?(?:오전|오후)\s*\d{1,2}:\d{2})\s*(?:에\s*)?(?:초기화|리셋)/i
  )
  if (koAbs) return koAbs[1].trim()

  const enAbs = chunk.match(/resets?\s+(?:at|on)?\s*([A-Za-z0-9,:\/\s]+?)(?:\n|\.|$)/i)
  if (enAbs?.[1]?.trim()) return enAbs[1].trim()

  return null
}

/**
 * Auxiliary EN/KO DOM text fallback for `https://gemini.google.com/usage`.
 */
export function parseGeminiUsageDomText(domText: string): ParsedGeminiUsage | null {
  if (!domText || !domText.trim()) return null

  const normalized = domText.replace(/\r\n/g, '\n')
  const weeklyIdx = normalized.search(/(?:weekly\s+limit|주간\s*한도|주간\s*사용량)/i)
  const sessionIdx = normalized.search(/(?:current\s+usage|5-hour|5시간|현재\s*사용량|세션)/i)

  let sessionChunk = ''
  let weeklyChunk = ''

  if (sessionIdx !== -1 && weeklyIdx !== -1) {
    if (sessionIdx < weeklyIdx) {
      sessionChunk = normalized.slice(sessionIdx, weeklyIdx)
      weeklyChunk = normalized.slice(weeklyIdx, weeklyIdx + 350)
    } else {
      weeklyChunk = normalized.slice(weeklyIdx, sessionIdx)
      sessionChunk = normalized.slice(sessionIdx, sessionIdx + 350)
    }
  } else if (sessionIdx !== -1) {
    sessionChunk = normalized.slice(sessionIdx, sessionIdx + 350)
  } else if (weeklyIdx !== -1) {
    weeklyChunk = normalized.slice(weeklyIdx, weeklyIdx + 350)
  } else {
    sessionChunk = normalized.slice(0, 600)
  }

  const sPct = sessionChunk ? extractPctFromChunk(sessionChunk) : null
  const wPct = weeklyChunk ? extractPctFromChunk(weeklyChunk) : null

  if (sPct === null && wPct === null) return null

  return {
    sessionRemainingPct: sPct ?? wPct,
    sessionResetAt: sessionChunk ? extractResetFromChunk(sessionChunk) : null,
    weeklyRemainingPct: wPct,
    weeklyResetAt: weeklyChunk ? extractResetFromChunk(weeklyChunk) : null
  }
}

export function buildGeminiProviderUsage(
  parsed: ParsedGeminiUsage,
  now: number = Date.now()
): ProviderUsage {
  return {
    id: 'gemini',
    status: 'ok',
    sessionRemainingPct: parsed.sessionRemainingPct,
    sessionResetAt: parsed.sessionResetAt,
    weeklyRemainingPct: parsed.weeklyRemainingPct,
    weeklyResetAt: parsed.weeklyResetAt,
    updatedAt: now
  }
}
