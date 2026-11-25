export interface ClaudeCookieCredential {
  cookieHeader: string
  source: 'imported_cookie'
}

export interface ClaudeCookieParseResult {
  ok: boolean
  credential?: ClaudeCookieCredential
  error?: string
}

function unescapeShellString(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/[\r\n]+/g, ' ').trim()
}

function extractCookieFromCurlOrFetch(raw: string): string | null {
  const patterns = [
    /(?:^|\s)(?:-b|--cookie)\s+'([^']+)'/i,
    /(?:^|\s)(?:-b|--cookie)\s+"([^"]+)"/i,
    /(?:^|\s)(?:-H|--header)\s+'cookie:\s*([^']+)'/i,
    /(?:^|\s)(?:-H|--header)\s+"cookie:\s*([^"]+)"/i,
    /["']cookie["']\s*:\s*["']([^"']+)["']/i
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match?.[1]) return unescapeShellString(match[1])
  }
  return null
}

/**
 * Parses a pasted Claude `sessionKey` value (`sk-ant-sid...`), raw `Cookie` header,
 * or Chrome/Safari DevTools `Copy as cURL` command from `https://claude.ai/settings/usage`.
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

  const extracted = (extractCookieFromCurlOrFetch(trimmed) ?? trimmed)
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()

  if (!extracted || !/\bsessionKey\s*=\s*[^;\s]+/i.test(extracted)) {
    return {
      ok: false,
      error:
        'sessionKey 쿠키를 찾지 못했습니다. claude.ai 개발자 도구에서 sessionKey 값(sk-ant-sid...)이나 Copy as cURL 전체를 붙여넣어 주세요.'
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
