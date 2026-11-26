import { extractCookieFromDevToolsText, normalizeRawCookieHeader } from './cookieParse'

export interface ClaudeCookieCredential {
  cookieHeader: string
  source: 'imported_cookie'
}

export interface ClaudeCookieParseResult {
  ok: boolean
  credential?: ClaudeCookieCredential
  error?: string
}

/**
 * Parses a pasted Claude `sessionKey` value (`sk-ant-sid...`), raw `Cookie` header,
 * or Chrome/Edge/Safari DevTools `Copy as cURL (bash/cmd)` / `Copy as PowerShell` output.
 */
export function parseImportedClaudeCookie(rawInput: string): ClaudeCookieParseResult {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return {
      ok: false,
      error: 'sessionKey 쿠키 값 또는 Copy as cURL 내용을 붙여넣어 주세요.'
    }
  }

  // Raw sessionKey value (e.g. "sk-ant-sid01-...")
  const unquoted = trimmed.replace(/^['"]|['"]$/g, '').trim()
  if (/^sk-ant-sid[A-Za-z0-9_-]{12,}$/.test(unquoted)) {
    return {
      ok: true,
      credential: {
        cookieHeader: `sessionKey=${unquoted}`,
        source: 'imported_cookie'
      }
    }
  }

  const extracted = extractCookieFromDevToolsText(trimmed) ?? normalizeRawCookieHeader(trimmed)

  if (!extracted || !/\bsessionKey\s*=\s*[^;\s]+/i.test(extracted)) {
    return {
      ok: false,
      error:
        'sessionKey 쿠키를 찾지 못했습니다. claude.ai 개발자 도구에서 sessionKey 값(sk-ant-sid...)이나 Copy as cURL 전체를 붙여넣어 주세요.'
    }
  }

  if (/[^\x20-\x7E]/.test(extracted)) {
    return {
      ok: false,
      error:
        'Cookie 값에 지원되지 않는 문자(한글/특수 제어문자 등)가 포함되어 있습니다. sessionKey 값 또는 Copy as cURL을 다시 복사해 주세요.'
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
