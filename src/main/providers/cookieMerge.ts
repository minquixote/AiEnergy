/**
 * Pure Cookie header merging utilities for persisting refreshed `Set-Cookie` values
 * (e.g. Google's short-lived `__Secure-1PSIDTS` / `__Secure-3PSIDTS` / `SIDCC` rotation).
 */

export interface CookieMergeResult {
  cookieHeader: string
  updatedNames: string[]
}

const ASCII_PRINTABLE_RE = /^[\x20-\x7E]+$/

export function parseCookieHeaderPairs(cookieHeader: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (const rawPart of cookieHeader.split(';')) {
    const part = rawPart.trim()
    if (!part) continue
    const eqIdx = part.indexOf('=')
    if (eqIdx <= 0) continue
    const name = part.slice(0, eqIdx).trim()
    const value = part.slice(eqIdx + 1).trim()
    if (!name) continue
    pairs.push([name, value])
  }
  return pairs
}

export function parseSetCookieNameValue(
  setCookieLine: string
): { name: string; value: string; expired: boolean } | null {
  const segments = setCookieLine.split(';').map((s) => s.trim())
  const first = segments[0]
  if (!first) return null

  const eqIdx = first.indexOf('=')
  if (eqIdx <= 0) return null

  const name = first.slice(0, eqIdx).trim()
  const value = first.slice(eqIdx + 1).trim()
  if (!name) return null

  let expired = value === '' || value.toLowerCase() === 'deleted' || value.toLowerCase() === 'expired'

  for (let i = 1; i < segments.length; i += 1) {
    const attr = segments[i]
    const attrEq = attr.indexOf('=')
    if (attrEq <= 0) continue
    const attrName = attr.slice(0, attrEq).trim().toLowerCase()
    const attrValue = attr.slice(attrEq + 1).trim()

    if (attrName === 'max-age') {
      const secs = Number.parseInt(attrValue, 10)
      if (Number.isFinite(secs) && secs <= 0) {
        expired = true
      }
    } else if (attrName === 'expires') {
      const ts = Date.parse(attrValue)
      if (!Number.isNaN(ts) && ts <= Date.now()) {
        expired = true
      }
    }
  }

  return { name, value, expired }
}

/**
 * Merges incoming `Set-Cookie` response headers into an existing `Cookie` request header string,
 * preserving cookie order and skipping deleted/expired cookies.
 */
export function mergeSetCookieHeaders(
  cookieHeader: string,
  setCookieHeaders: string[] | string | undefined
): CookieMergeResult {
  if (!setCookieHeaders) {
    return { cookieHeader, updatedNames: [] }
  }

  const lines = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]
  if (lines.length === 0) {
    return { cookieHeader, updatedNames: [] }
  }

  const cookieMap = new Map<string, string>()
  for (const [name, value] of parseCookieHeaderPairs(cookieHeader)) {
    cookieMap.set(name, value)
  }

  const updatedNames: string[] = []
  for (const line of lines) {
    if (typeof line !== 'string' || !line.trim()) continue
    const parsed = parseSetCookieNameValue(line)
    if (!parsed || parsed.expired) continue
    if (!ASCII_PRINTABLE_RE.test(parsed.name) || !ASCII_PRINTABLE_RE.test(parsed.value)) {
      continue
    }
    if (cookieMap.get(parsed.name) !== parsed.value) {
      cookieMap.set(parsed.name, parsed.value)
      if (!updatedNames.includes(parsed.name)) {
        updatedNames.push(parsed.name)
      }
    }
  }

  if (updatedNames.length === 0) {
    return { cookieHeader, updatedNames }
  }

  const rebuilt = Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

  return { cookieHeader: rebuilt, updatedNames }
}
