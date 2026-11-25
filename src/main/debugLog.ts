import type { DataSourceMode, DebugLogEntry, DebugLogLevel, HostPlatform, ProviderId } from '../shared/types'

export const MAX_DEBUG_LOG_ENTRIES = 60
const MAX_MESSAGE_LENGTH = 220
const MAX_SNIPPET_LENGTH = 280

/**
 * Redacts cookies, OAuth/JWT tokens, API/session keys, and email addresses
 * BEFORE any diagnostic message or snippet is persisted or copied to clipboard.
 */
export function sanitizeDiagnosticText(raw: string, maxLength = MAX_SNIPPET_LENGTH): string {
  if (!raw) return ''

  let text = raw
    // Redact Bearer / Authorization headers
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(authorization\s*[:=]\s*['"]?)[^'"\r\n]+/gi, '$1[REDACTED]')
    // Redact Cookie header lines
    .replace(/\b(cookie\s*:\s*)[^\r\n]+/gi, '$1[COOKIE_REDACTED]')
    // Redact JWTs (three base64url segments starting with eyJ)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT_REDACTED]')
    // Redact Anthropic session keys & OpenAI secret keys
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/gi, '[SESSION_KEY_REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[KEY_REDACTED]')
    // Redact common auth cookie key=value pairs
    .replace(
      /\b((?:__Secure-|__Host-)[A-Za-z0-9_.-]+|sessionKey|SAPISID|APISID|HSID|SSID|SIDCC|SID|NID|cf_clearance|oai-did)\s*=\s*[^;\s,'"]+/gi,
      '$1=[REDACTED]'
    )
    // Redact sensitive JSON string values
    .replace(
      /("(?:access_token|refresh_token|id_token|accessToken|refreshToken|sessionKey|cookie|authorization|password|secret)"\s*:\s*")[^"]+(")/gi,
      '$1[REDACTED]$2'
    )
    // Redact email addresses
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1)}…`
  }

  return text
}

export interface CreateDebugLogInput {
  providerId: ProviderId | 'system'
  level: DebugLogLevel
  message: string
  strategy?: string
  httpStatus?: number
  snippet?: string
  timestamp?: number
}

let entryCounter = 0

export function createDebugLogEntry(input: CreateDebugLogInput): DebugLogEntry {
  const ts = input.timestamp ?? Date.now()
  entryCounter = (entryCounter + 1) % 100_000
  const sanitizedSnippet = input.snippet
    ? sanitizeDiagnosticText(input.snippet, MAX_SNIPPET_LENGTH)
    : undefined

  return {
    id: `${ts}-${entryCounter}`,
    timestamp: ts,
    providerId: input.providerId,
    level: input.level,
    strategy: input.strategy,
    httpStatus: input.httpStatus,
    message: sanitizeDiagnosticText(input.message, MAX_MESSAGE_LENGTH),
    snippet: sanitizedSnippet && sanitizedSnippet.length > 0 ? sanitizedSnippet : undefined
  }
}

export function appendDebugLog(
  existing: DebugLogEntry[],
  entry: DebugLogEntry,
  maxEntries = MAX_DEBUG_LOG_ENTRIES
): DebugLogEntry[] {
  return [entry, ...existing].slice(0, Math.max(1, maxEntries))
}

export interface DebugReportMetadata {
  appVersion: string
  platform: HostPlatform
  dataSourceMode: DataSourceMode
  isPackaged: boolean
}

export function formatDebugLogsReport(
  entries: DebugLogEntry[],
  meta: DebugReportMetadata
): string {
  const header = [
    `AI Energy Bar Diagnostics Report`,
    `Version: ${meta.appVersion} (${meta.isPackaged ? 'packaged' : 'dev'})`,
    `Platform: ${meta.platform}`,
    `Mode: ${meta.dataSourceMode}`,
    `Exported: ${new Date().toISOString()}`,
    `Entries: ${entries.length}`,
    '---'
  ]

  if (entries.length === 0) {
    return [...header, '(수집된 디버그 로그 없음)'].join('\n')
  }

  const lines = entries.map((entry) => {
    const iso = new Date(entry.timestamp).toISOString()
    const parts = [
      `[${iso}]`,
      `[${entry.level.toUpperCase()}]`,
      `[${entry.providerId}]`
    ]
    if (entry.strategy) parts.push(`strategy=${entry.strategy}`)
    if (typeof entry.httpStatus === 'number') parts.push(`http=${entry.httpStatus}`)
    parts.push(entry.message)
    if (entry.snippet) parts.push(`| ${entry.snippet}`)
    return parts.join(' ')
  })

  return [...header, ...lines].join('\n')
}
