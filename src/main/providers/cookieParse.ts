function unescapeBashString(value: string): string {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Unescapes Windows `cmd.exe` caret-escaped strings copied from Chrome/Edge DevTools
 * "Copy as cURL (cmd)" (e.g., `^"`, `^;`, `^%`, `^&`, `^^`, and `^` line continuations).
 */
function unescapeWindowsCmdString(value: string): string {
  return value
    .replace(/\^\r?\n\s*/g, '')
    .replace(/\^([";%&|<>^=])/g, '$1')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/**
 * Extracts a `Cookie` header string from Chrome/Edge/Safari DevTools clipboard output:
 * - Copy as cURL (bash): `-b '...'`, `--cookie '...'`, `-H 'cookie: ...'`
 * - Copy as cURL (cmd) [Windows]: `-b ^"...^"`, `-H ^"cookie: ...^"`, `-b "..."`
 * - Copy as PowerShell [Windows]: `$session.Cookies.Add((New-Object System.Net.Cookie("k", "v", ...)))`
 * - Copy as fetch: `"cookie": "..."`
 */
export function extractCookieFromDevToolsText(raw: string): string | null {
  // 1. Windows "Copy as cURL (cmd)" caret-quoted forms: -b ^"...^" / -H ^"cookie: ...^"
  const collapsedCmd = raw.replace(/\^\r?\n\s*/g, ' ')
  const cmdPatterns = [
    /(?:^|\s)(?:-b|--cookie)\s+\^"((?:(?!\^")[\s\S])+)\^"/i,
    /(?:^|\s)(?:-H|--header)\s+\^"cookie:\s*((?:(?!\^")[\s\S])+)\^"/i
  ]
  for (const pattern of cmdPatterns) {
    const match = collapsedCmd.match(pattern)
    if (match?.[1]) {
      return unescapeWindowsCmdString(match[1])
    }
  }

  // 2. Standard bash / POSIX "Copy as cURL" forms
  const bashPatterns = [
    /(?:^|\s)(?:-b|--cookie)\s+'([^']+)'/i,
    /(?:^|\s)(?:-b|--cookie)\s+"([^"]+)"/i,
    /(?:^|\s)(?:-H|--header)\s+'cookie:\s*([^']+)'/i,
    /(?:^|\s)(?:-H|--header)\s+"cookie:\s*([^"]+)"/i
  ]
  for (const pattern of bashPatterns) {
    const match = raw.match(pattern)
    if (match?.[1]) {
      return unescapeBashString(match[1])
    }
  }

  // 3. Windows Chrome/Edge "Copy as PowerShell":
  // $session.Cookies.Add((New-Object System.Net.Cookie("NAME", "VALUE", "/", ".domain")))
  const psCookies: string[] = []
  const psRegex = /System\.Net\.Cookie\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']/gi
  let psMatch: RegExpExecArray | null
  while ((psMatch = psRegex.exec(raw)) !== null) {
    if (psMatch[1]) {
      psCookies.push(`${psMatch[1]}=${psMatch[2] ?? ''}`)
    }
  }
  if (psCookies.length > 0) {
    return psCookies.join('; ')
  }

  // 4. "Copy as fetch" / PowerShell header hashtable: "cookie": "..." or "cookie"="..."
  const fetchMatch = raw.match(/["']cookie["']\s*[:=]\s*["']([^"']+)["']/i)
  if (fetchMatch?.[1]) {
    return unescapeBashString(fetchMatch[1])
  }

  return null
}

export function normalizeRawCookieHeader(raw: string): string {
  return raw
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/^\^"|"\^$/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}
