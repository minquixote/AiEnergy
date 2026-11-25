import { extractCookieFromDevToolsText, normalizeRawCookieHeader } from './cookieParse'

export interface GeminiCookieCredential {
  cookieHeader: string
  source: 'imported_cookie'
}

export interface GeminiCookieParseResult {
  ok: boolean
  credential?: GeminiCookieCredential
  error?: string
}

const GOOGLE_AUTH_COOKIE_NAMES = [
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PSIDCC',
  'SID',
  'SAPISID',
  'HSID',
  'SSID',
  'OSID'
]

/**
 * Parses a Gemini browser Cookie header pasted directly OR copied via DevTools
 * "Copy as cURL (bash/cmd)" / "Copy as PowerShell" / "Copy as fetch" on `https://gemini.google.com/usage`.
 */
export function parseImportedGeminiCookie(rawInput: string): GeminiCookieParseResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: 'Copy as cURL 또는 Cookie 헤더 값을 붙여넣어 주세요.'
    }
  }

  const extracted = extractCookieFromDevToolsText(trimmed) ?? normalizeRawCookieHeader(trimmed)
  if (!extracted || !extracted.includes('=')) {
    return {
      ok: false,
      error:
        'Cookie 값을 찾지 못했습니다. gemini.google.com/usage의 개발자 도구(Network)에서 executeQuery 요청을 Copy as cURL로 복사해 붙여넣어 주세요.'
    }
  }

  const cookieNames = new Set(
    extracted
      .split(';')
      .map((part) => part.split('=')[0]?.trim())
      .filter((name): name is string => Boolean(name))
  )

  const hasGoogleSessionCookie = GOOGLE_AUTH_COOKIE_NAMES.some((name) => cookieNames.has(name))
  if (!hasGoogleSessionCookie) {
    return {
      ok: false,
      error:
        'Google 로그인 쿠키(__Secure-1PSID / SID 등)가 포함되어 있지 않습니다. 브라우저에서 Gemini에 로그인된 상태인지 확인 후 다시 복사해 주세요.'
    }
  }

  return {
    ok: true,
    credential: {
      cookieHeader: extracted,
      source: 'imported_cookie'
    }
  }
}
