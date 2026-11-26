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
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function parseJsonObjectAt(
  text: string,
  startIndex: number
): { value: Record<string, unknown>; endIndex: number } | null {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(startIndex, i + 1)) as unknown
          if (isObject(parsed)) {
            return { value: parsed, endIndex: i }
          }
        } catch {
          return null
        }
        return null
      }
    }
  }

  return null
}

function hasChatGptTokenField(obj: Record<string, unknown>): boolean {
  if (typeof obj['accessToken'] === 'string' && obj['accessToken'].trim().length > 0) return true
  if (typeof obj['access_token'] === 'string' && obj['access_token'].trim().length > 0) return true
  if (isObject(obj['tokens'])) {
    const tokens = obj['tokens']
    if (typeof tokens['access_token'] === 'string' && tokens['access_token'].trim().length > 0) {
      return true
    }
    if (typeof tokens['accessToken'] === 'string' && tokens['accessToken'].trim().length > 0) {
      return true
    }
  }
  return false
}

/**
 * Extracts a JSON object even when Chrome's "pretty print" bar or browser extensions
 * inject extra lines before/after `{...}` on Ctrl+A / Cmd+A.
 */
function extractJsonObjectFromText(raw: string): Record<string, unknown> | null {
  try {
    const direct = JSON.parse(raw) as unknown
    if (isObject(direct)) {
      return direct
    }
  } catch {
    // Fall through to balanced-brace extraction
  }

  let fallbackObject: Record<string, unknown> | null = null
  let cursor = 0
  let attempts = 0
  const maxBraceAttempts = 64

  while (cursor < raw.length && attempts < maxBraceAttempts) {
    const start = raw.indexOf('{', cursor)
    if (start === -1) break
    attempts += 1

    const candidate = parseJsonObjectAt(raw, start)
    if (candidate) {
      if (hasChatGptTokenField(candidate.value)) {
        return candidate.value
      }
      if (!fallbackObject) {
        fallbackObject = candidate.value
      }
      cursor = candidate.endIndex + 1
    } else {
      cursor = start + 1
    }
  }

  return fallbackObject
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
  const strippedBearer = trimmed
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()
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

  const parsed = extractJsonObjectFromText(trimmed)
  if (!parsed) {
    // Final fallback when a partial selection or extension noise truncates the JSON closing brace
    const fallbackTokenMatch = trimmed.match(
      /"(?:accessToken|access_token)"\s*:\s*"(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/
    )
    if (fallbackTokenMatch?.[1]) {
      const token = fallbackTokenMatch[1]
      const expiresMatch = trimmed.match(/"expires"\s*:\s*"([^"]+)"/)
      const accountIdMatch =
        trimmed.match(/"account"\s*:\s*\{[^{}]*"id"\s*:\s*"([^"]+)"/) ??
        trimmed.match(/"account_id"\s*:\s*"([^"]+)"/)
      return {
        ok: true,
        credential: {
          accessToken: token,
          accountId: accountIdMatch?.[1]?.trim() || extractAccountIdFromJwt(token),
          expiresAt: expiresMatch?.[1]?.trim() || extractExpiryFromJwt(token),
          source: 'imported_session'
        }
      }
    }

    return {
      ok: false,
      error:
        '올바른 JSON 형식이 아닙니다. chatgpt.com/api/auth/session 페이지 전체 텍스트를 복사해 붙여넣어 주세요.'
    }
  }

  // Support both `/api/auth/session` shape and `~/.codex/auth.json` shape if pasted directly
  const tokensObj = isObject(parsed['tokens']) ? parsed['tokens'] : null
  const accessToken =
    (typeof parsed['accessToken'] === 'string' && parsed['accessToken'].trim()) ||
    (typeof parsed['access_token'] === 'string' && parsed['access_token'].trim()) ||
    (tokensObj && typeof tokensObj['access_token'] === 'string' && tokensObj['access_token'].trim()) ||
    (tokensObj && typeof tokensObj['accessToken'] === 'string' && tokensObj['accessToken'].trim()) ||
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
