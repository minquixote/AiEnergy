import { describe, expect, it } from 'vitest'
import { parseImportedGeminiCookie } from './geminiAuth'
import {
  buildGeminiProviderUsage,
  parseGeminiGraphqlResponse,
  parseGeminiUsageDomText
} from './geminiParser'

describe('parseImportedGeminiCookie', () => {
  it('extracts Cookie header from Chrome DevTools Copy as cURL (-b and -H variants)', () => {
    const curlB = `curl 'https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery' \\
      -H 'accept: application/json' \\
      -b '__Secure-1PSID=abc123; __Secure-1PSIDTS=def456; NID=789'`

    const res1 = parseImportedGeminiCookie(curlB)
    expect(res1.ok).toBe(true)
    expect(res1.credential?.cookieHeader).toBe('__Secure-1PSID=abc123; __Secure-1PSIDTS=def456; NID=789')

    const curlH = `curl "https://gemini.google.com/usage" -H "cookie: SID=xyz; SAPISID=999"`
    const res2 = parseImportedGeminiCookie(curlH)
    expect(res2.ok).toBe(true)
    expect(res2.credential?.cookieHeader).toBe('SID=xyz; SAPISID=999')
  })

  it('accepts raw Cookie header and rejects unrelated text without Google session cookies', () => {
    const raw = 'Cookie: __Secure-1PSID=token_val; HSID=abc'
    expect(parseImportedGeminiCookie(raw).ok).toBe(true)
    expect(parseImportedGeminiCookie(raw).credential?.cookieHeader).toBe(
      '__Secure-1PSID=token_val; HSID=abc'
    )

    expect(parseImportedGeminiCookie('foo=bar; baz=1').ok).toBe(false)
    expect(parseImportedGeminiCookie('').ok).toBe(false)
  })
})

describe('parseGeminiGraphqlResponse', () => {
  it('strips Google XSSI prefix and converts 0..1 percentageUsed fractions into remaining %', () => {
    const body = `)]}'\n${JSON.stringify([
      {
        data: {
          viewer: {
            rpcs: {
              getUsageInfo: {
                subscriptionTier: 'TIER1',
                pools: [
                  {
                    poolType: 'GXU_FIVE_HOURLY',
                    percentageUsed: 0.71,
                    gxu: { windowRefreshesAt: '2026-11-25T05:43:00Z' }
                  },
                  {
                    poolType: 'GXU_WEEKLY',
                    percentageUsed: 0.04,
                    gxu: { windowRefreshesAt: '2026-12-01T12:43:00Z' }
                  }
                ]
              }
            }
          }
        }
      }
    ])}`

    const outcome = parseGeminiGraphqlResponse(body)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.parsed.sessionRemainingPct).toBe(29)
      expect(outcome.parsed.sessionResetAt).toBe('2026-11-25T05:43:00.000Z')
      expect(outcome.parsed.weeklyRemainingPct).toBe(96)
      expect(outcome.parsed.weeklyResetAt).toBe('2026-12-01T12:43:00.000Z')
      expect(outcome.parsed.subscriptionTier).toBe('TIER1')

      const usage = buildGeminiProviderUsage(outcome.parsed, 1_780_000_000_000)
      expect(usage.id).toBe('gemini')
      expect(usage.status).toBe('ok')
    }
  })

  it('handles 0% used cleanly as 100% remaining and flags viewer=null or HTML as auth_required', () => {
    const zeroBody = JSON.stringify([
      {
        data: {
          viewer: {
            rpcs: {
              getUsageInfo: {
                pools: [
                  {
                    poolType: 'GXU_FIVE_HOURLY',
                    percentageUsed: 0,
                    gxu: { windowRefreshesAt: '2026-11-25T05:00:00Z' }
                  }
                ]
              }
            }
          }
        }
      }
    ])
    const zeroOutcome = parseGeminiGraphqlResponse(zeroBody)
    expect(zeroOutcome.kind).toBe('ok')
    if (zeroOutcome.kind === 'ok') {
      expect(zeroOutcome.parsed.sessionRemainingPct).toBe(100)
    }

    expect(parseGeminiGraphqlResponse('[{"data":{"viewer":null}}]').kind).toBe('auth_required')
    expect(parseGeminiGraphqlResponse('<!doctype html><html>Sign in</html>').kind).toBe('auth_required')
  })
})

describe('parseGeminiUsageDomText', () => {
  it('parses English and Korean gemini.google.com/usage page copy', () => {
    const enText = `
      Usage limits — PRO
      Current usage
      29% used
      Resets at 1:43 PM

      Weekly limit
      4% used
      Resets Oct 21 at 12:43 PM
    `
    const parsedEn = parseGeminiUsageDomText(enText)
    expect(parsedEn?.sessionRemainingPct).toBe(71)
    expect(parsedEn?.sessionResetAt).toBe('1:43 PM')
    expect(parsedEn?.weeklyRemainingPct).toBe(96)
    expect(parsedEn?.weeklyResetAt).toBe('Oct 21 at 12:43 PM')
  })
})
