function titleCaseWords(raw: string): string {
  return raw
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Formats ChatGPT `/backend-api/wham/usage` `plan_type` strings into concise exact subscription labels:
 * - `prolite` / `pro_lite` -> `Pro 100`
 * - `pro` -> `Pro 200`
 * - `go` -> `Go`
 * - `plus` -> `Plus`
 * - `team` / `business` / `enterprise` / `edu` / `free`
 */
export function formatChatGptPlanName(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')

  const exactMap: Record<string, string> = {
    free: 'Free',
    go: 'Go',
    plus: 'Plus',
    prolite: 'Pro 100',
    pro_lite: 'Pro 100',
    pro100: 'Pro 100',
    pro_100: 'Pro 100',
    pro: 'Pro 200',
    pro200: 'Pro 200',
    pro_200: 'Pro 200',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu'
  }

  return exactMap[normalized] ?? titleCaseWords(raw)
}

/**
 * Formats Gemini `getUsageInfo.subscriptionTier` values into exact user-facing labels:
 * - `TIER1` / `AI_PRO` / `PRO` -> `Pro`
 * - `TIER2` / `AI_ULTRA` / `ULTRA` -> `Ultra`
 * - `AI_PLUS` / `PLUS` -> `Plus`
 * - `TIER0` / `FREE` -> `Free`
 */
export function formatGeminiPlanName(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, '_')

  if (
    normalized === 'UNRECOGNIZED' ||
    normalized === 'UNKNOWN' ||
    normalized === 'SUBSCRIPTION_TIER_UNSPECIFIED'
  ) {
    return null
  }

  const exactMap: Record<string, string> = {
    TIER0: 'Free',
    FREE: 'Free',
    AI_PLUS: 'Plus',
    PLUS: 'Plus',
    TIER1: 'Pro',
    AI_PRO: 'Pro',
    GOOGLE_AI_PRO: 'Pro',
    PRO: 'Pro',
    TIER2: 'Ultra',
    AI_ULTRA: 'Ultra',
    GOOGLE_AI_ULTRA: 'Ultra',
    ULTRA: 'Ultra',
    ULTRA_LITE: 'Ultra Lite',
    AI_ULTRA_LITE: 'Ultra Lite'
  }

  return exactMap[normalized] ?? titleCaseWords(raw)
}

/**
 * Extracts and formats the active Claude subscription tier from `/api/organizations` metadata
 * (`rate_limit_tier` and `capabilities`).
 */
export function formatClaudePlanName(org: {
  rate_limit_tier?: unknown
  capabilities?: unknown
  billing_type?: unknown
}): string | null {
  const tier = typeof org.rate_limit_tier === 'string' ? org.rate_limit_tier.toLowerCase() : ''
  const caps = Array.isArray(org.capabilities)
    ? org.capabilities.filter((c): c is string => typeof c === 'string').map((c) => c.toLowerCase())
    : []

  if (tier.includes('max_20x')) return 'Max 20x'
  if (tier.includes('max_5x')) return 'Max 5x'
  if (tier.includes('ultra')) return 'Ultra'
  if (tier.includes('max') || caps.includes('claude_max')) return 'Max'
  if (tier.includes('pro') || caps.includes('claude_pro')) return 'Pro'
  if (caps.includes('enterprise') || tier.includes('enterprise')) return 'Enterprise'
  if (caps.includes('raven') || caps.includes('team') || tier.includes('team')) return 'Team'
  if (caps.length > 0 || tier.length > 0) return 'Free'
  return null
}
