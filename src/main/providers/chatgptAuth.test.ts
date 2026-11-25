import { describe, expect, it } from 'vitest'
import {
  extractAccountIdFromJwt,
  extractExpiryFromJwt,
  parseCodexAuthJson,
  parseImportedChatGptSession
} from './chatgptAuth'

function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.fake_signature_0123456789`
}

describe('chatgptAuth parsers', () => {
  const sampleJwt = makeFakeJwt({
    exp: 1_800_000_000,
    'https://api.openai.com/auth': {
      chatgpt_account_id: 'acct_from_jwt_999'
    }
  })

  it('extracts account id and expiry from JWT claims', () => {
    expect(extractAccountIdFromJwt(sampleJwt)).toBe('acct_from_jwt_999')
    expect(extractExpiryFromJwt(sampleJwt)).toBe(new Date(1_800_000_000 * 1000).toISOString())
  })

  it('parses /api/auth/session JSON pasted from Chrome/Safari', () => {
    const raw = JSON.stringify({
      user: { id: 'user-1', email: 'test@gmail.com' },
      expires: '2026-12-30T00:00:00.000Z',
      accessToken: sampleJwt,
      account: { id: 'acct_direct_123' }
    })

    const res = parseImportedChatGptSession(raw)
    expect(res.ok).toBe(true)
    expect(res.credential?.accessToken).toBe(sampleJwt)
    expect(res.credential?.accountId).toBe('acct_direct_123')
    expect(res.credential?.expiresAt).toBe('2026-12-30T00:00:00.000Z')
    expect(res.credential?.source).toBe('imported_session')
  })

  it('falls back to JWT account_id when account field is omitted and accepts raw Bearer token', () => {
    const rawJson = JSON.stringify({ accessToken: sampleJwt })
    const res1 = parseImportedChatGptSession(rawJson)
    expect(res1.ok).toBe(true)
    expect(res1.credential?.accountId).toBe('acct_from_jwt_999')

    const res2 = parseImportedChatGptSession(`Bearer ${sampleJwt}`)
    expect(res2.ok).toBe(true)
    expect(res2.credential?.accessToken).toBe(sampleJwt)
    expect(res2.credential?.accountId).toBe('acct_from_jwt_999')
  })

  it('rejects empty {} session JSON with helpful Korean guidance', () => {
    const res = parseImportedChatGptSession('{}')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('accessToken')

    const invalid = parseImportedChatGptSession('not-json')
    expect(invalid.ok).toBe(false)
    expect(invalid.error).toContain('JSON')
  })

  it('parses official ~/.codex/auth.json format', () => {
    const codexRaw = JSON.stringify({
      tokens: {
        id_token: sampleJwt,
        access_token: sampleJwt,
        refresh_token: 'rt_123456',
        account_id: 'acct_codex_777'
      },
      last_refresh: '2026-11-24T12:00:00Z'
    })

    const cred = parseCodexAuthJson(codexRaw)
    expect(cred).not.toBeNull()
    expect(cred?.source).toBe('codex_cli')
    expect(cred?.accessToken).toBe(sampleJwt)
    expect(cred?.accountId).toBe('acct_codex_777')
  })
})
