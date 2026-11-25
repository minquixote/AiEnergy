import { describe, expect, it } from 'vitest'
import {
  formatChatGptPlanName,
  formatClaudePlanName,
  formatGeminiPlanName
} from './planNames'

describe('formatChatGptPlanName', () => {
  it('maps ChatGPT plan_type identifiers to exact user-facing tiers', () => {
    expect(formatChatGptPlanName('prolite')).toBe('Pro 100')
    expect(formatChatGptPlanName('pro_lite')).toBe('Pro 100')
    expect(formatChatGptPlanName('pro')).toBe('Pro 200')
    expect(formatChatGptPlanName('go')).toBe('Go')
    expect(formatChatGptPlanName('plus')).toBe('Plus')
    expect(formatChatGptPlanName('team')).toBe('Team')
    expect(formatChatGptPlanName('business')).toBe('Business')
    expect(formatChatGptPlanName('enterprise')).toBe('Enterprise')
    expect(formatChatGptPlanName('edu')).toBe('Edu')
    expect(formatChatGptPlanName('free')).toBe('Free')
  })

  it('handles empty or unknown values gracefully', () => {
    expect(formatChatGptPlanName(null)).toBeNull()
    expect(formatChatGptPlanName(undefined)).toBeNull()
    expect(formatChatGptPlanName('   ')).toBeNull()
    expect(formatChatGptPlanName('custom_tier')).toBe('Custom Tier')
  })
})

describe('formatGeminiPlanName', () => {
  it('maps Gemini subscriptionTier enum and DOM names accurately', () => {
    expect(formatGeminiPlanName('TIER0')).toBe('Free')
    expect(formatGeminiPlanName('TIER1')).toBe('Pro')
    expect(formatGeminiPlanName('TIER2')).toBe('Ultra')
    expect(formatGeminiPlanName('AI_PRO')).toBe('Pro')
    expect(formatGeminiPlanName('AI_ULTRA')).toBe('Ultra')
    expect(formatGeminiPlanName('PRO')).toBe('Pro')
    expect(formatGeminiPlanName('ULTRA')).toBe('Ultra')
    expect(formatGeminiPlanName('PLUS')).toBe('Plus')
    expect(formatGeminiPlanName('ULTRA_LITE')).toBe('Ultra Lite')
  })

  it('returns null for unspecified or unrecognized tiers', () => {
    expect(formatGeminiPlanName('UNRECOGNIZED')).toBeNull()
    expect(formatGeminiPlanName('UNKNOWN')).toBeNull()
    expect(formatGeminiPlanName('SUBSCRIPTION_TIER_UNSPECIFIED')).toBeNull()
    expect(formatGeminiPlanName(undefined)).toBeNull()
  })
})

describe('formatClaudePlanName', () => {
  it('detects Max 20x, Max 5x, Max, Pro, Team, Enterprise, and Free from org metadata', () => {
    expect(formatClaudePlanName({ rate_limit_tier: 'default_claude_max_20x' })).toBe('Max 20x')
    expect(formatClaudePlanName({ rate_limit_tier: 'default_claude_max_5x' })).toBe('Max 5x')
    expect(formatClaudePlanName({ capabilities: ['chat', 'claude_max'] })).toBe('Max')
    expect(formatClaudePlanName({ rate_limit_tier: 'default_claude_pro' })).toBe('Pro')
    expect(formatClaudePlanName({ capabilities: ['chat', 'claude_pro'] })).toBe('Pro')
    expect(formatClaudePlanName({ capabilities: ['raven'] })).toBe('Team')
    expect(formatClaudePlanName({ capabilities: ['enterprise'] })).toBe('Enterprise')
    expect(formatClaudePlanName({ capabilities: ['chat'] })).toBe('Free')
    expect(formatClaudePlanName({})).toBeNull()
  })
})
