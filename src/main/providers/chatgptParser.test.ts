import { describe, expect, it } from 'vitest'
import { inspectAuthOrChallengeText } from './base'
import {
  buildChatGptProviderUsage,
  parseChatGptUsageDomText,
  parseChatGptUsageJson
} from './chatgptParser'

describe('parseChatGptUsageJson', () => {
  const fixedNow = 1_780_000_000_000

  it('parses Plus/Pro wham/usage response with 5-hour primary and 7-day secondary windows', () => {
    const payload = {
      user_id: 'user-123',
      plan_type: 'pro',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 28,
          limit_window_seconds: 18_000,
          reset_after_seconds: 9_300,
          reset_at: 1_780_009_300
        },
        secondary_window: {
          used_percent: 6,
          limit_window_seconds: 604_800,
          reset_after_seconds: 442_800,
          reset_at: 1_780_442_800
        }
      }
    }

    const parsed = parseChatGptUsageJson(payload, fixedNow)
    expect(parsed).not.toBeNull()
    expect(parsed?.planType).toBe('pro')
    expect(parsed?.sessionRemainingPct).toBe(72)
    expect(parsed?.sessionResetAt).toBe(new Date(1_780_009_300 * 1000).toISOString())
    expect(parsed?.weeklyRemainingPct).toBe(94)
    expect(parsed?.weeklyResetAt).toBe(new Date(1_780_442_800 * 1000).toISOString())

    const usage = buildChatGptProviderUsage(parsed!, fixedNow)
    expect(usage.id).toBe('chatgpt')
    expect(usage.status).toBe('ok')
    expect(usage.planName).toBe('Pro 200')
    expect(usage.updatedAt).toBe(fixedNow)

    const proliteParsed = parseChatGptUsageJson({ ...payload, plan_type: 'prolite' }, fixedNow)
    expect(buildChatGptProviderUsage(proliteParsed!, fixedNow).planName).toBe('Pro 100')
  })

  it('classifies windows by limit_window_seconds even when weekly is in primary_window (Team plan)', () => {
    const payload = {
      plan_type: 'team',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 15,
          limit_window_seconds: 604_800,
          reset_after_seconds: 500_000
        },
        secondary_window: null
      }
    }

    const parsed = parseChatGptUsageJson(payload, fixedNow)
    expect(parsed).not.toBeNull()
    // Single weekly window surfaces both as weekly and effective primary session reading
    expect(parsed?.weeklyRemainingPct).toBe(85)
    expect(parsed?.sessionRemainingPct).toBe(85)
    expect(parsed?.weeklyResetAt).toBe(new Date(fixedNow + 500_000 * 1000).toISOString())
  })

  it('clamps out-of-range used_percent > 100 and handles limit_reached with missing percent', () => {
    const overused = parseChatGptUsageJson(
      {
        rate_limit: {
          allowed: false,
          limit_reached: true,
          primary_window: {
            used_percent: 108,
            limit_window_seconds: 18_000,
            reset_after_seconds: 1_200
          }
        }
      },
      fixedNow
    )
    expect(overused?.sessionRemainingPct).toBe(0)

    const blockedOnly = parseChatGptUsageJson(
      {
        rate_limit: {
          allowed: false,
          limit_reached: true
        }
      },
      fixedNow
    )
    expect(blockedOnly?.sessionRemainingPct).toBe(0)
  })

  it('handles 0% used cleanly as 100% remaining without falsy-zero bugs', () => {
    const fresh = parseChatGptUsageJson(
      {
        plan_type: 'pro',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 0,
            limit_window_seconds: 18_000,
            reset_after_seconds: 18_000
          }
        }
      },
      fixedNow
    )
    expect(fresh?.sessionRemainingPct).toBe(100)
    expect(fresh?.sessionResetAt).toBe(new Date(fixedNow + 18_000 * 1000).toISOString())
  })

  it('returns null for unrelated JSON payloads', () => {
    expect(parseChatGptUsageJson({ hello: 'world' }, fixedNow)).toBeNull()
    expect(parseChatGptUsageJson(null, fixedNow)).toBeNull()
  })
})

describe('parseChatGptUsageDomText', () => {
  const fixedNow = 1_780_000_000_000

  it('parses English Codex/ChatGPT usage page DOM text with remaining % and relative resets', () => {
    const domText = `
      Settings
      Usage
      5-hour usage limit
      48% remaining
      Resets in 2h 35m

      Weekly usage limit
      91% remaining
      Resets on Dec 1 at 8:18 PM
    `

    const parsed = parseChatGptUsageDomText(domText, fixedNow)
    expect(parsed).not.toBeNull()
    expect(parsed?.sessionRemainingPct).toBe(48)
    expect(parsed?.sessionResetAt).toBe(new Date(fixedNow + (2 * 60 + 35) * 60_000).toISOString())
    expect(parsed?.weeklyRemainingPct).toBe(91)
    expect(parsed?.weeklyResetAt).toBe('Dec 1 at 8:18 PM')
  })

  it('parses Korean usage page DOM text with used % inversion and Korean timestamps', () => {
    const domText = `
      설정 > 사용량
      5시간 사용량 한도
      52% 사용됨
      오전 12:18 초기화

      주간 사용량 한도
      1% 사용됨
      12/1 오후 8:18 초기화
    `

    const parsed = parseChatGptUsageDomText(domText, fixedNow)
    expect(parsed).not.toBeNull()
    expect(parsed?.sessionRemainingPct).toBe(48)
    expect(parsed?.sessionResetAt).toBe('오전 12:18')
    expect(parsed?.weeklyRemainingPct).toBe(99)
    expect(parsed?.weeklyResetAt).toBe('12/1 오후 8:18')
  })

  it('returns null when page has no usage percentage', () => {
    expect(parseChatGptUsageDomText('Welcome to ChatGPT. Sign in to continue.', fixedNow)).toBeNull()
  })
})

describe('inspectAuthOrChallengeText', () => {
  it('detects OpenAI login redirects and Cloudflare verification gates without bypassing', () => {
    expect(
      inspectAuthOrChallengeText('https://auth.openai.com/log-in', 'Log in', '')
    ).toEqual({ blockedOrUnauthenticated: true, reason: 'login_redirect' })

    expect(
      inspectAuthOrChallengeText(
        'https://chatgpt.com/codex/settings/usage',
        'Just a moment...',
        'Verify you are human by completing the action below.'
      )
    ).toEqual({ blockedOrUnauthenticated: true, reason: 'bot_challenge' })

    expect(
      inspectAuthOrChallengeText(
        'https://chatgpt.com/codex/settings/usage',
        'ChatGPT',
        '5-hour usage limit 72% remaining'
      )
    ).toEqual({ blockedOrUnauthenticated: false })
  })
})
