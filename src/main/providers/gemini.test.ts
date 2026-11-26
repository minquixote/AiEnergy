import { describe, expect, it } from 'vitest'
import { buildGeminiUsageGraphqlUrl } from './gemini'
import { parseImportedGeminiCookie } from './geminiAuth'
import {
  buildGeminiProviderUsage,
  parseGeminiGraphqlResponse,
  parseGeminiUsageDomText
} from './geminiParser'

/**
 * Exact replica of Chromium DevTools `escapeStringWin` in NetworkLogView.ts
 * used by Windows Chrome/Edge "Copy as cURL (cmd)".
 */
function chromiumEscapeStringWin(str: string): string {
  return (
    '^"' +
    str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[^a-zA-Z0-9\s_\-:=+~'/.,?;]/g, '^$&')
      .replace(/%(?=[a-zA-Z0-9_])/g, '%^') +
    '^"'
  )
}

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

  it('extracts cookies from Windows Chrome/Edge Copy as cURL (cmd) and Copy as PowerShell', () => {
    const winCmd = `curl ^"https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery^" ^
  -H ^"accept: application/json^" ^
  -b ^"__Secure-1PSID=win_abc^; __Secure-1PSIDTS=win_def^; NID=511^"`

    const cmdRes = parseImportedGeminiCookie(winCmd)
    expect(cmdRes.ok).toBe(true)
    expect(cmdRes.credential?.cookieHeader).toBe(
      '__Secure-1PSID=win_abc; __Secure-1PSIDTS=win_def; NID=511'
    )

    const winPs = `$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies.Add((New-Object System.Net.Cookie("__Secure-1PSID", "ps_token1", "/", ".google.com")))
$session.Cookies.Add((New-Object System.Net.Cookie("SAPISID", "ps_\`"quoted\`"", "/", ".google.com")))
Invoke-WebRequest -UseBasicParsing -Uri "https://gemini.google.com/usage" -WebSession $session`

    const psRes = parseImportedGeminiCookie(winPs)
    expect(psRes.ok).toBe(true)
    expect(psRes.credential?.cookieHeader).toBe('__Secure-1PSID=ps_token1; SAPISID=ps_"quoted"')
  })

  it('roundtrips real Chromium escapeStringWin cookies containing %XX (^%^3D), quotes (^\\^"), carets, and symbols', () => {
    const originalCookie =
      'PREF="f6=400&tz=Asia.Seoul"; NID=520=abc%3Ddef%2Fghi; AEC=AQTF6!#$@[]{}()~; ' +
      '__Secure-1PSID=g.a000^caret; __Secure-1PSIDTS=sidts-%%3D-%^3; ' +
      'COMPASS=a\\b; ESC=foo\\"bar; TAIL=end\\'

    const winCurl = [
      `curl ${chromiumEscapeStringWin('https://gemini.google.com/usage')} ^`,
      `  -H ${chromiumEscapeStringWin('sec-ch-ua: "Google Chrome";v="142"')} ^`,
      `  -b ${chromiumEscapeStringWin(originalCookie)} ^`,
      `  -H ${chromiumEscapeStringWin('user-agent: Mozilla/5.0')}`
    ].join('\r\n')

    const res = parseImportedGeminiCookie(winCurl)
    expect(res.ok).toBe(true)
    expect(res.credential?.cookieHeader).toBe(originalCookie)
  })

  it('supports Chrome Copy as cURL (bash) ANSI-C $\'...\' quoting, Copy as fetch, and multi-line Request Headers', () => {
    const bashAnsiC = `curl 'https://gemini.google.com/usage' \\
  -b $'__Secure-1PSID=tok_1; NOTE=it\\'s_ok; SID=sid_2'`
    const ansiRes = parseImportedGeminiCookie(bashAnsiC)
    expect(ansiRes.ok).toBe(true)
    expect(ansiRes.credential?.cookieHeader).toBe("__Secure-1PSID=tok_1; NOTE=it's_ok; SID=sid_2")

    const fetchNode = `fetch("https://gemini.google.com/usage", {
  "headers": {
    "accept": "text/html",
    "cookie": "__Secure-1PSID=f_1; PREF=\\"tz=Seoul\\"; SAPISID=f_2"
  },
  "method": "GET"
});`
    const fetchRes = parseImportedGeminiCookie(fetchNode)
    expect(fetchRes.ok).toBe(true)
    expect(fetchRes.credential?.cookieHeader).toBe(
      '__Secure-1PSID=f_1; PREF="tz=Seoul"; SAPISID=f_2'
    )

    const rawHeaders = [
      ':authority: gemini.google.com',
      ':method: GET',
      ':path: /usage',
      ':scheme: https',
      'accept: text/html',
      'cookie: __Secure-1PSID=hdr_1; __Secure-1PSIDTS=hdr_2; NID=520=abc%3D',
      'user-agent: Mozilla/5.0'
    ].join('\r\n')
    const headersRes = parseImportedGeminiCookie(rawHeaders)
    expect(headersRes.ok).toBe(true)
    expect(headersRes.credential?.cookieHeader).toBe(
      '__Secure-1PSID=hdr_1; __Secure-1PSIDTS=hdr_2; NID=520=abc%3D'
    )
  })

  it('detects Google multi-account /u/N/ index from copied Gemini requests and builds matching GraphQL URL', () => {
    const multiAccountCurl = `curl ^"https://gemini.google.com/u/1/usage^" ^
  -b ^"__Secure-1PSID=acct1_tok; __Secure-1PSIDTS=acct1_ts^"`
    const res = parseImportedGeminiCookie(multiAccountCurl)
    expect(res.ok).toBe(true)
    expect(res.credential?.authUserIndex).toBe(1)

    expect(buildGeminiUsageGraphqlUrl()).toContain(
      'https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery'
    )
    expect(buildGeminiUsageGraphqlUrl(1)).toContain(
      'https://gemini.google.com/u/1/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery'
    )
  })

  it('rejects non-ASCII garbage inside Cookie header before fetch throws ByteString errors', () => {
    const invalid = '__Secure-1PSID=abc; 한글쿠키=값'
    const res = parseImportedGeminiCookie(invalid)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('지원되지 않는 문자')
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
      expect(usage.planName).toBe('Pro')
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
    expect(parsedEn?.subscriptionTier).toBe('PRO')
    expect(buildGeminiProviderUsage(parsedEn!, 1_780_000_000_000).planName).toBe('Pro')
  })
})
