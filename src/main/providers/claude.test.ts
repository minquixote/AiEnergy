import { describe, expect, it } from 'vitest'
import { parseImportedClaudeCookie } from './claudeAuth'
import {
  buildClaudeProviderUsage,
  extractClaudeOrgId,
  extractClaudeOrgInfo,
  parseClaudeUsageDomText,
  parseClaudeUsageJson
} from './claudeParser'

describe('parseImportedClaudeCookie', () => {
  it('accepts raw sk-ant-sid sessionKey value and Copy as cURL cookie header', () => {
    const rawKey = 'sk-ant-sid01-abcdef1234567890_xyz'
    const res1 = parseImportedClaudeCookie(rawKey)
    expect(res1.ok).toBe(true)
    expect(res1.credential?.cookieHeader).toBe(`sessionKey=${rawKey}`)

    const curl = `curl 'https://claude.ai/api/organizations' -H 'cookie: cf_clearance=1; sessionKey=${rawKey}; lastActiveOrg=org1'`
    const res2 = parseImportedClaudeCookie(curl)
    expect(res2.ok).toBe(true)
    expect(res2.credential?.cookieHeader).toContain(`sessionKey=${rawKey}`)

    const curlCmd = `curl ^"https://claude.ai/api/organizations^" ^
  -H ^"cookie: cf_clearance=1^; sessionKey=${rawKey}^; lastActiveOrg=org1^"`
    const res3 = parseImportedClaudeCookie(curlCmd)
    expect(res3.ok).toBe(true)
    expect(res3.credential?.cookieHeader).toContain(`sessionKey=${rawKey}`)

    expect(parseImportedClaudeCookie('foo=bar').ok).toBe(false)
  })
})

describe('parseClaudeUsageJson', () => {
  it('parses five_hour and seven_day utilization counters into remaining %', () => {
    const payload = {
      five_hour: {
        utilization: 52,
        resets_at: '2026-11-25T05:18:00Z'
      },
      seven_day: {
        utilization: 1,
        resets_at: '2026-12-01T11:18:00Z'
      }
    }

    const parsed = parseClaudeUsageJson(payload)
    expect(parsed).not.toBeNull()
    expect(parsed?.sessionRemainingPct).toBe(48)
    expect(parsed?.sessionResetAt).toBe('2026-11-25T05:18:00.000Z')
    expect(parsed?.weeklyRemainingPct).toBe(99)
    expect(parsed?.weeklyResetAt).toBe('2026-12-01T11:18:00.000Z')

    const usage = buildClaudeProviderUsage(parsed!, 1_780_000_000_000, 'Max 5x')
    expect(usage.id).toBe('claude')
    expect(usage.status).toBe('ok')
    expect(usage.planName).toBe('Max 5x')
  })

  it('handles weekly-only limits[] array (Ultra accounts without five_hour)', () => {
    const payload = {
      five_hour: null,
      limits: [
        {
          kind: 'weekly_all',
          percent: 15,
          resets_at: '2026-12-01T11:18:00Z'
        }
      ]
    }
    const parsed = parseClaudeUsageJson(payload)
    expect(parsed?.sessionRemainingPct).toBe(85)
    expect(parsed?.weeklyRemainingPct).toBe(85)
  })

  it('extracts organization UUID and subscription plan name cleanly', () => {
    expect(extractClaudeOrgId([{ uuid: 'org-uuid-123', name: 'Personal' }])).toBe('org-uuid-123')
    expect(
      extractClaudeOrgInfo([
        {
          uuid: 'org-uuid-123',
          name: 'Personal',
          rate_limit_tier: 'default_claude_max_20x',
          capabilities: ['chat', 'claude_max']
        }
      ])
    ).toEqual({ orgId: 'org-uuid-123', planName: 'Max 20x' })
    expect(extractClaudeOrgId([])).toBeNull()
  })
})

describe('parseClaudeUsageDomText', () => {
  it('parses Korean and English claude.ai/settings/usage text', () => {
    const ko = `
      현재 세션
      52% 사용됨
      오전 12:18 초기화

      주간 한도
      1% 사용됨
      12/1 오후 8:18 초기화
    `
    const parsed = parseClaudeUsageDomText(ko, 1_780_000_000_000)
    expect(parsed?.sessionRemainingPct).toBe(48)
    expect(parsed?.sessionResetAt).toBe('오전 12:18')
    expect(parsed?.weeklyRemainingPct).toBe(99)
    expect(parsed?.weeklyResetAt).toBe('12/1 오후 8:18')
  })
})
