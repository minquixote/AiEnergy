import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ChatGptCredential {
  accessToken: string
  accountId: string | null
  expiresAt: string | null
  source: 'codex_cli' | 'imported_session'
}

export interface SessionParseResult {
  ok: boolean
  credential?: ChatGptCredential
  error?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json) as unknown
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function extractAccountIdFromJwt(token: string): string | null {
  const claims = decodeJwtPayload(token)
  if (!claims) return null

  const openAiAuth = claims['https://api.openai.com/auth']
  if (isObject(openAiAuth)) {
    if (typeof openAiAuth['chatgpt_account_id'] === 'string' && openAiAuth['chatgpt_account_id']) {
      return openAiAuth['chatgpt_account_id']
    }
    if (typeof openAiAuth['account_id'] === 'string' && openAiAuth['account_id']) {
      return openAiAuth['account_id']
    }
  }

  if (typeof claims['chatgpt_account_id'] === 'string' && claims['chatgpt_account_id']) {
    return claims['chatgpt_account_id']
  }

  return null
}

export function extractExpiryFromJwt(token: string): string | null {
  const claims = decodeJwtPayload(token)
  if (!claims) return null
  const exp = claims['exp']
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    const ms = exp < 1_000_000_000_000 ? exp * 1000 : exp
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

/**
 * Parses JSON copied from `https://chatgpt.com/api/auth/session` (or a pasted raw JWT/Bearer token)
 * into a validated local ChatGPT credential.
 */
export function parseImportedChatGptSession(rawInput: string): SessionParseResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: '세션 JSON을 붙여넣어 주세요.'
    }
  }

  // Allow users who paste a raw "Bearer eyJ..." or "eyJ..." token directly
  const strippedBearer = trimmed.replace(/^Bearer\s+/i, '').trim()
  if (!strippedBearer.startsWith('{') && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(strippedBearer)) {
    return {
      ok: true,
      credential: {
        accessToken: strippedBearer,
        accountId: extractAccountIdFromJwt(strippedBearer),
        expiresAt: extractExpiryFromJwt(strippedBearer),
        source: 'imported_session'
      }
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return {
      ok: false,
      error:
        '올바른 JSON 형식이 아닙니다. chatgpt.com/api/auth/session 페이지 전체 텍스트를 복사해 붙여넣어 주세요.'
    }
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      error: '세션 JSON 객체가 비어 있습니다.'
    }
  }

  // Support both `/api/auth/session` shape and `~/.codex/auth.json` shape if pasted directly
  const tokensObj = isObject(parsed['tokens']) ? parsed['tokens'] : null
  const accessToken =
    (typeof parsed['accessToken'] === 'string' && parsed['accessToken'].trim()) ||
    (typeof parsed['access_token'] === 'string' && parsed['access_token'].trim()) ||
    (tokensObj && typeof tokensObj['access_token'] === 'string' && tokensObj['access_token'].trim()) ||
    ''

  if (!accessToken || accessToken.length < 20) {
    return {
      ok: false,
      error:
        'accessToken을 찾지 못했습니다. 기본 브라우저에서 ChatGPT에 먼저 로그인한 뒤 세션 페이지를 새로고침해 복사해 주세요.'
    }
  }

  const accountObj = isObject(parsed['account']) ? parsed['account'] : null
  const userObj = isObject(parsed['user']) ? parsed['user'] : null
  const idToken =
    (tokensObj && typeof tokensObj['id_token'] === 'string' && tokensObj['id_token']) || ''

  const accountId =
    (accountObj && typeof accountObj['id'] === 'string' && accountObj['id'].trim()) ||
    (userObj && typeof userObj['account_id'] === 'string' && userObj['account_id'].trim()) ||
    (tokensObj && typeof tokensObj['account_id'] === 'string' && tokensObj['account_id'].trim()) ||
    (typeof parsed['account_id'] === 'string' && parsed['account_id'].trim()) ||
    extractAccountIdFromJwt(accessToken) ||
    (idToken ? extractAccountIdFromJwt(idToken) : null) ||
    null

  const expiresRaw = typeof parsed['expires'] === 'string' ? parsed['expires'] : null
  const expiresAt = expiresRaw ?? extractExpiryFromJwt(accessToken)

  return {
    ok: true,
    credential: {
      accessToken,
      accountId,
      expiresAt,
      source: 'imported_session'
    }
  }
}

export function getCodexAuthFilePath(): string {
  const codexHome = process.env['CODEX_HOME']?.trim()
  if (codexHome) {
    return join(codexHome, 'auth.json')
  }
  return join(homedir(), '.codex', 'auth.json')
}

export function parseCodexAuthJson(rawText: string): ChatGptCredential | null {
  try {
    const parsed = JSON.parse(rawText) as unknown
    if (!isObject(parsed)) return null

    const tokens = isObject(parsed['tokens']) ? parsed['tokens'] : parsed
    const accessToken =
      (typeof tokens['access_token'] === 'string' && tokens['access_token'].trim()) ||
      (typeof tokens['accessToken'] === 'string' && tokens['accessToken'].trim()) ||
      ''
    if (!accessToken || accessToken.length < 20) return null

    const idToken = typeof tokens['id_token'] === 'string' ? tokens['id_token'] : ''
    const accountId =
      (typeof tokens['account_id'] === 'string' && tokens['account_id'].trim()) ||
      (typeof tokens['accountId'] === 'string' && tokens['accountId'].trim()) ||
      extractAccountIdFromJwt(accessToken) ||
      (idToken ? extractAccountIdFromJwt(idToken) : null) ||
      null

    return {
      accessToken,
      accountId,
      expiresAt: extractExpiryFromJwt(accessToken),
      source: 'codex_cli'
    }
  } catch {
    return null
  }
}

/**
 * Reads local OpenAI Codex CLI credentials (`~/.codex/auth.json` or `$CODEX_HOME/auth.json`)
 * when available on the user's machine.
 */
export function readCodexCliCredential(filePath: string = getCodexAuthFilePath()): ChatGptCredential | null {
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf8')
    return parseCodexAuthJson(raw)
  } catch {
    return null
  }
}
