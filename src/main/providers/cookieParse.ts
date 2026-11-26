function sanitizeCookieHeader(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]+/g, '')
    .trim()
}

/**
 * Unescapes Windows `cmd.exe` caret-escaped strings produced by Chrome/Edge DevTools
 * `escapeStringWin` ("Copy as cURL (cmd)"):
 *   1) `\` -> `\\`
 *   2) `"` -> `\"`
 *   3) non-allowlisted chars -> `^<char>` (including `%`, `!`, `$`, `&`, `^`, `\`, `"`, `(`, `)`, etc.)
 *   4) `%(?=[a-zA-Z0-9_])` -> `%^` (so `%3D` becomes `^%^3D`)
 */
function unescapeWindowsCmdString(value: string): string {
  return sanitizeCookieHeader(
    value
      .replace(/\^\r?\n\s*/g, '')
      .replace(/\^%\^(?=[a-zA-Z0-9_])/g, '^%')
      .replace(/\^([\s\S])/g, '$1')
      .replace(/\\([\\"])/g, '$1')
  )
}

function unescapeDoubleQuotedString(value: string): string {
  try {
    const parsed = JSON.parse(`"${value}"`) as unknown
    if (typeof parsed === 'string') {
      return sanitizeCookieHeader(parsed)
    }
  } catch {
    // Fall back to shell-style backslash unescaping
  }
  return sanitizeCookieHeader(value.replace(/\\([\\"'])/g, '$1'))
}

function unescapeAnsiCString(value: string): string {
  return sanitizeCookieHeader(
    value.replace(/\\(x[0-9a-fA-F]{2}|[\\'"nrt])/g, (full, esc: string) => {
      if (esc === '\\') return '\\'
      if (esc === "'") return "'"
      if (esc === '"') return '"'
      if (esc === 'n' || esc === 'r' || esc === 't') return ' '
      if (esc.startsWith('x')) {
        const code = Number.parseInt(esc.slice(1), 16)
        return Number.isFinite(code) && code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : ''
      }
      return full
    })
  )
}

/**
 * Extracts a Windows cmd `^"..."^"` argument starting right at `^"`.
 * Skips escaped literal quotes (`^\^"`) while properly closing on trailing escaped backslashes (`^\^\^"`).
 */
function parseWindowsCmdCaretQuoted(text: string, start: number): { value: string; end: number } | null {
  if (!text.startsWith('^"', start)) return null
  const contentStart = start + 2

  for (let i = contentStart; i < text.length - 1; i += 1) {
    if (text[i] === '^' && text[i + 1] === '"') {
      let precedingBackslashPairs = 0
      let j = i
      while (j >= contentStart + 2 && text[j - 2] === '^' && text[j - 1] === '\\') {
        precedingBackslashPairs += 1
        j -= 2
      }
      if (precedingBackslashPairs % 2 === 1) {
        i += 1
        continue
      }
      return {
        value: unescapeWindowsCmdString(text.slice(contentStart, i)),
        end: i + 2
      }
    }
  }
  return null
}

/**
 * Extracts a POSIX shell quoted argument (`$'...'`, `'...'`, or `"..."`) starting at `start`.
 */
function parseShellQuotedArg(text: string, start: number): { value: string; end: number } | null {
  if (text.startsWith("$'", start)) {
    let raw = ''
    for (let i = start + 2; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '\\' && i + 1 < text.length) {
        raw += ch + text[i + 1]
        i += 1
        continue
      }
      if (ch === "'") {
        return { value: unescapeAnsiCString(raw), end: i + 1 }
      }
      raw += ch
    }
    return null
  }

  if (text[start] === "'") {
    let out = ''
    for (let i = start + 1; i < text.length; i += 1) {
      if (text.startsWith("'\\''", i)) {
        out += "'"
        i += 3
        continue
      }
      if (text[i] === "'") {
        return { value: sanitizeCookieHeader(out), end: i + 1 }
      }
      out += text[i]
    }
    return null
  }

  if (text[start] === '"') {
    let raw = ''
    for (let i = start + 1; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '\\' && i + 1 < text.length) {
        raw += ch + text[i + 1]
        i += 1
        continue
      }
      if (ch === '"') {
        return { value: unescapeDoubleQuotedString(raw), end: i + 1 }
      }
      raw += ch
    }
    return null
  }

  return null
}

function parseCurlArgAt(text: string, start: number): { value: string; end: number } | null {
  return parseWindowsCmdCaretQuoted(text, start) ?? parseShellQuotedArg(text, start)
}

/**
 * Extracts a `Cookie` header string from Chrome/Edge/Safari/Firefox DevTools clipboard output:
 * - Copy as cURL (cmd) [Windows]: `-b ^"...^"`, `-H ^"cookie: ...^"`, `-b "..."`
 * - Copy as cURL (bash): `-b '...'`, `-b $'...'`, `--cookie '...'`, `-H 'cookie: ...'`
 * - Copy as PowerShell [Windows]: `$session.Cookies.Add((New-Object System.Net.Cookie("k", "v", ...)))`
 * - Copy as fetch / fetch (Node.js): `"cookie": "..."`
 * - Copy request headers / DevTools Headers panel: standalone `Cookie: ...` line
 */
export function extractCookieFromDevToolsText(raw: string): string | null {
  // Collapse both Windows cmd (`^\n`) and POSIX bash (`\\\n`) line continuations
  const collapsed = raw.replace(/\s*\^\r?\n\s*/g, ' ').replace(/\s*\\\r?\n\s*/g, ' ')

  // 1. Scan cURL `-b` / `--cookie` flags first (Chrome/Edge emit `-b` for cookies)
  const cookieFlagRegex = /(?:^|\s)(?:-b|--cookie)\s+/g
  let flagMatch: RegExpExecArray | null
  while ((flagMatch = cookieFlagRegex.exec(collapsed)) !== null) {
    const arg = parseCurlArgAt(collapsed, flagMatch.index + flagMatch[0].length)
    if (arg?.value && arg.value.includes('=')) {
      return arg.value
    }
  }

  // 2. Scan cURL `-H` / `--header` flags for `cookie: ...`
  const headerFlagRegex = /(?:^|\s)(?:-H|--header)\s+/g
  while ((flagMatch = headerFlagRegex.exec(collapsed)) !== null) {
    const arg = parseCurlArgAt(collapsed, flagMatch.index + flagMatch[0].length)
    if (arg && /^cookie\s*:/i.test(arg.value)) {
      const stripped = sanitizeCookieHeader(arg.value.replace(/^cookie\s*:\s*/i, ''))
      if (stripped && stripped.includes('=')) return stripped
    }
  }

  // 3. Windows Chrome/Edge "Copy as PowerShell":
  // $session.Cookies.Add((New-Object System.Net.Cookie("NAME", "VALUE", "/", ".domain")))
  const psCookies: string[] = []
  const psDoubleRegex = /System\.Net\.Cookie\(\s*"((?:`[\s\S]|[^"])+)"\s*,\s*"((?:`[\s\S]|[^"])*)"/gi
  let psMatch: RegExpExecArray | null
  while ((psMatch = psDoubleRegex.exec(raw)) !== null) {
    if (psMatch[1]) {
      const name = psMatch[1].replace(/`([\s\S])/g, '$1')
      const val = (psMatch[2] ?? '').replace(/`([\s\S])/g, '$1')
      psCookies.push(`${name}=${val}`)
    }
  }
  if (psCookies.length === 0) {
    const psSingleRegex = /System\.Net\.Cookie\(\s*'((?:''|[^'])+)'\s*,\s*'((?:''|[^'])*)'/gi
    while ((psMatch = psSingleRegex.exec(raw)) !== null) {
      if (psMatch[1]) {
        const name = psMatch[1].replace(/''/g, "'")
        const val = (psMatch[2] ?? '').replace(/''/g, "'")
        psCookies.push(`${name}=${val}`)
      }
    }
  }
  if (psCookies.length > 0) {
    return sanitizeCookieHeader(psCookies.join('; '))
  }

  // 4. "Copy as fetch" / "Copy as fetch (Node.js)" / PowerShell hashtable: "cookie": "..." or "cookie"="..."
  const fetchKeyRegex = /["']cookie["']\s*[:=]\s*/gi
  let fetchKeyMatch: RegExpExecArray | null
  while ((fetchKeyMatch = fetchKeyRegex.exec(raw)) !== null) {
    const arg = parseShellQuotedArg(raw, fetchKeyMatch.index + fetchKeyMatch[0].length)
    if (arg?.value && arg.value.includes('=')) {
      return arg.value
    }
  }

  // 5. DevTools "Copy request headers" / raw multi-line HTTP headers with a standalone `Cookie:` line
  const headerLineMatch = raw.match(/^\s*cookie\s*:\s*(.+)$/im)
  if (headerLineMatch?.[1]) {
    const cleaned = sanitizeCookieHeader(headerLineMatch[1])
    if (cleaned && cleaned.includes('=')) return cleaned
  }

  return null
}

export function normalizeRawCookieHeader(raw: string): string {
  const trimmed = raw.trim()
  const caretParsed = parseWindowsCmdCaretQuoted(trimmed, 0)
  if (caretParsed && caretParsed.end === trimmed.length) {
    return sanitizeCookieHeader(caretParsed.value.replace(/^\s*cookie\s*:\s*/i, ''))
  }
  const stripped = trimmed
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/^\^"|\^"$/g, '')
    .replace(/^['"]|['"]$/g, '')
  return sanitizeCookieHeader(stripped)
}
