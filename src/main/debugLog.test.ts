import { describe, expect, it } from 'vitest'
import {
  appendDebugLog,
  createDebugLogEntry,
  formatDebugLogsReport,
  sanitizeDiagnosticText
} from './debugLog'

describe('sanitizeDiagnosticText', () => {
  it('redacts Bearer tokens, JWTs, session keys, Google cookies, JSON secrets, and emails', () => {
    const dirty = [
      'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart12345',
      'sessionKey=sk-ant-sid01-abcdef1234567890_secret',
      '__Secure-1PSID=g.a000secretvalue123; SAPISID=abc987/xyz',
      '{"accessToken":"super_secret_token_value","email":"alice@example.com"}',
      'sk-proj-1234567890abcdef1234567890'
    ].join(' | ')

    const clean = sanitizeDiagnosticText(dirty, 800)
    expect(clean).not.toContain('eyJhbGci')
    expect(clean).not.toContain('signaturepart12345')
    expect(clean).not.toContain('sk-ant-sid01')
    expect(clean).not.toContain('g.a000secretvalue123')
    expect(clean).not.toContain('abc987/xyz')
    expect(clean).not.toContain('super_secret_token_value')
    expect(clean).not.toContain('alice@example.com')
    expect(clean).not.toContain('sk-proj-1234567890')
    expect(clean).toContain('[REDACTED]')
    expect(clean).toContain('[EMAIL_REDACTED]')
  })

  it('redacts raw Cookie header lines and caps overly long snippets', () => {
    const cookieLine = 'Cookie: SID=secret123; HSID=secret456; NID=secret789'
    const clean = sanitizeDiagnosticText(cookieLine)
    expect(clean).toBe('Cookie: [COOKIE_REDACTED]')

    const longText = 'x'.repeat(500)
    const truncated = sanitizeDiagnosticText(longText, 120)
    expect(truncated.length).toBe(120)
    expect(truncated.endsWith('…')).toBe(true)
  })
})

describe('debug log ring buffer and report formatting', () => {
  it('keeps newest entries first and enforces max capacity', () => {
    let logs = [] as ReturnType<typeof createDebugLogEntry>[]
    for (let i = 1; i <= 5; i += 1) {
      logs = appendDebugLog(
        logs,
        createDebugLogEntry({
          providerId: 'chatgpt',
          level: 'info',
          message: `entry-${i}`,
          timestamp: 1_780_000_000_000 + i * 1000
        }),
        3
      )
    }

    expect(logs.map((e) => e.message)).toEqual(['entry-5', 'entry-4', 'entry-3'])
  })

  it('formats sanitized plain-text diagnostics report', () => {
    const entry = createDebugLogEntry({
      providerId: 'gemini',
      level: 'warn',
      strategy: 'session_fetch',
      httpStatus: 429,
      message: '요청 제한 감지',
      snippet: 'cookie: __Secure-1PSID=should_not_leak',
      timestamp: Date.UTC(2026, 10, 25, 12, 0, 0)
    })

    const report = formatDebugLogsReport([entry], {
      appVersion: '0.1.0',
      platform: 'darwin',
      dataSourceMode: 'live',
      isPackaged: true
    })

    expect(report).toContain('AI Energy Bar Diagnostics Report')
    expect(report).toContain('Version: 0.1.0 (packaged)')
    expect(report).toContain('[WARN] [gemini] strategy=session_fetch http=429')
    expect(report).not.toContain('should_not_leak')
  })
})
