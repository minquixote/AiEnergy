import { session } from 'electron'
import { PROVIDER_META } from '../../shared/constants'
import type { ProviderAuthSource, ProviderUsage } from '../../shared/types'
import {
  attachNetworkJsonCapture,
  delay,
  inspectAuthOrChallengeText,
  loadPageUntilReady,
  runSingleFlightCollection,
  withHiddenCollectorWindow,
  type ProviderAdapter,
  type ProviderCollectResult
} from './base'
import type { ClaudeCookieCredential } from './claudeAuth'
import {
  buildClaudeProviderUsage,
  extractClaudeOrgInfo,
  parseClaudeUsageDomText,
  parseClaudeUsageJson
} from './claudeParser'
import { formatNetworkError, getHeaderValue, netHttpRequest } from './netHttp'

const CLAUDE_USAGE_URL = 'https://claude.ai/settings/usage'

function makeAuthRequiredResult(message: string, httpStatus?: number): ProviderCollectResult {
  const usage: ProviderUsage = {
    id: 'claude',
    status: 'auth_required',
    sessionRemainingPct: null,
    sessionResetAt: null,
    weeklyRemainingPct: null,
    weeklyResetAt: null,
    updatedAt: Date.now(),
    errorMessage: message
  }
  return {
    usage,
    strategy: 'auth_check',
    httpStatus,
    diagnostic: message
  }
}

function makeErrorResult(
  message: string,
  options?: { httpStatus?: number; rateLimited?: boolean; diagnostic?: string }
): ProviderCollectResult {
  const usage: ProviderUsage = {
    id: 'claude',
    status: 'error',
    sessionRemainingPct: null,
    sessionResetAt: null,
    weeklyRemainingPct: null,
    weeklyResetAt: null,
    updatedAt: Date.now(),
    errorMessage: message
  }
  return {
    usage,
    strategy: 'session_fetch',
    httpStatus: options?.httpStatus,
    rateLimited: options?.rateLimited,
    diagnostic: options?.diagnostic ?? message
  }
}

async function hasAnyClaudeCookie(): Promise<boolean> {
  const providerSession = session.fromPartition(PROVIDER_META.claude.partition)
  const cookies = await providerSession.cookies.get({ domain: 'claude.ai' })
  return cookies.length > 0
}

function parseJsonSafe(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

async function collectWithImportedCookie(
  cred: ClaudeCookieCredential
): Promise<ProviderCollectResult> {
  try {
    const commonHeaders = {
      Accept: 'application/json',
      Referer: CLAUDE_USAGE_URL,
      Cookie: cred.cookieHeader
    }

    const orgRes = await netHttpRequest({
      url: 'https://claude.ai/api/organizations',
      method: 'GET',
      redirect: 'follow',
      headers: commonHeaders,
      timeoutMs: 12_000
    })

    if (orgRes.status === 429) {
      return makeErrorResult(
        'Claude 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
        { httpStatus: 429, rateLimited: true }
      )
    }

    const cfMitigated = getHeaderValue(orgRes.headers, 'cf-mitigated')
    if (orgRes.status === 403 && cfMitigated === 'challenge') {
      return makeAuthRequiredResult(
        'Claude 보안 확인(Cloudflare)이 감지되었습니다. VPN을 끄거나 설정의 앱 내 로그인 창으로 확인해 주세요.',
        403
      )
    }

    if (orgRes.status === 401 || orgRes.status === 403) {
      return makeAuthRequiredResult(
        'Claude 세션 키가 만료되었습니다. 설정에서 sessionKey 또는 로그인을 다시 진행해 주세요.',
        orgRes.status
      )
    }

    if (orgRes.status < 200 || orgRes.status >= 300) {
      return makeErrorResult(`Claude 조직 정보 조회 실패 (HTTP ${orgRes.status}).`, {
        httpStatus: orgRes.status
      })
    }

    const orgPayload = parseJsonSafe(orgRes.body)
    const orgInfo = extractClaudeOrgInfo(orgPayload)
    if (!orgInfo) {
      return makeAuthRequiredResult(
        'Claude 계정 조직 ID를 찾지 못했습니다. 로그인 상태를 확인해 주세요.',
        orgRes.status
      )
    }

    const usageRes = await netHttpRequest({
      url: `https://claude.ai/api/organizations/${encodeURIComponent(orgInfo.orgId)}/usage`,
      method: 'GET',
      redirect: 'follow',
      headers: commonHeaders,
      timeoutMs: 12_000
    })

    if (usageRes.status === 429) {
      return makeErrorResult(
        'Claude 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
        { httpStatus: 429, rateLimited: true }
      )
    }

    if (usageRes.status === 401 || usageRes.status === 403) {
      return makeAuthRequiredResult(
        'Claude 사용량 조회 권한이 만료되었습니다. 설정에서 다시 연결해 주세요.',
        usageRes.status
      )
    }

    if (usageRes.status < 200 || usageRes.status >= 300) {
      return makeErrorResult(`Claude 사용량 API 응답 오류 (HTTP ${usageRes.status}).`, {
        httpStatus: usageRes.status
      })
    }

    const usagePayload = parseJsonSafe(usageRes.body)
    const parsed = parseClaudeUsageJson(usagePayload)
    if (!parsed) {
      const isEmptyQuotaObject =
        typeof usagePayload === 'object' &&
        usagePayload !== null &&
        !Array.isArray(usagePayload) &&
        ('five_hour' in usagePayload || 'seven_day' in usagePayload)

      if (isEmptyQuotaObject || orgInfo.planName === 'Free') {
        return {
          usage: {
            id: 'claude',
            status: 'ok',
            sessionRemainingPct: null,
            sessionResetAt: null,
            weeklyRemainingPct: null,
            weeklyResetAt: null,
            planName: orgInfo.planName ?? 'Free',
            updatedAt: Date.now(),
            errorMessage:
              'Claude 무료(Free) 플랜은 Anthropic에서 실시간 % 사용량 게이지를 제공하지 않습니다.'
          },
          strategy: 'session_fetch',
          httpStatus: usageRes.status,
          diagnostic: 'Claude Free 계정 확인 (사용량 % 미제공)'
        }
      }

      return makeErrorResult('Claude 사용량 응답을 해석하지 못했습니다.', {
        httpStatus: usageRes.status
      })
    }

    return {
      usage: buildClaudeProviderUsage(parsed, Date.now(), orgInfo.planName),
      strategy: 'session_fetch',
      httpStatus: usageRes.status,
      diagnostic: 'Claude 쿠키 직접 조회 완료'
    }
  } catch (err) {
    const msg = formatNetworkError(err)
    return makeErrorResult(`Claude 조회 중 네트워크 오류: ${msg}`, { diagnostic: msg })
  }
}

export async function resolveClaudeAuthSource(
  getImportedCookie: () => ClaudeCookieCredential | null
): Promise<ProviderAuthSource> {
  if (getImportedCookie()) return 'imported_cookie'
  if (await hasAnyClaudeCookie()) return 'browser_partition'
  return 'none'
}

export function createClaudeAdapter(
  getImportedCookie: () => ClaudeCookieCredential | null
): ProviderAdapter {
  return {
    id: 'claude',

    collect(): Promise<ProviderCollectResult> {
      return runSingleFlightCollection('claude', async () => {
        // Tier 1: Imported sessionKey / Cookie header via direct fetch
        const imported = getImportedCookie()
        if (imported) {
          return collectWithImportedCookie(imported)
        }

        // Tier 2: Embedded persist:claude partition (email login supported)
        if (!(await hasAnyClaudeCookie())) {
          return makeAuthRequiredResult(
            'Claude 연결이 필요합니다. 카드를 클릭해 연결하거나 미구독 시 설정에서 숨길 수 있습니다.'
          )
        }

        try {
          return await withHiddenCollectorWindow(
            { providerId: 'claude', timeoutMs: 22_000 },
            async (win, signal) => {
              const capture = await attachNetworkJsonCapture(win, (url) =>
                /claude\.ai\/api\/organizations(?:\/[^/]+\/usage)?(?:\?|$)/i.test(url)
              )

              try {
                await loadPageUntilReady(win, CLAUDE_USAGE_URL, 12_000)
                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('Claude 사용량 수집이 중단되었습니다.')
                }

                await delay(1_000)
                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('Claude 사용량 수집이 중단되었습니다.')
                }

                const url = win.webContents.getURL()
                const title = win.getTitle()
                const bodyText = (await win.webContents
                  .executeJavaScript(`document.body ? (document.body.innerText || '') : ''`, true)
                  .catch(() => '')) as string

                const authCheck = inspectAuthOrChallengeText(url, title, bodyText)
                if (authCheck.blockedOrUnauthenticated) {
                  const msg =
                    authCheck.reason === 'bot_challenge'
                      ? 'Claude 보안 확인이 필요합니다. 로그인 창에서 직접 확인하거나 sessionKey를 붙여넣어 주세요.'
                      : 'Claude 로그인 세션이 만료되었습니다. 카드를 클릭해 다시 로그인해 주세요.'
                  return makeAuthRequiredResult(msg)
                }

                const intercepted = await capture.waitForMatch(
                  (entry) => parseClaudeUsageJson(entry.body) !== null,
                  3_000
                )
                if (intercepted) {
                  const parsed = parseClaudeUsageJson(intercepted.body)
                  if (parsed) {
                    const orgEntry = capture.captured.find(
                      (entry) =>
                        /claude\.ai\/api\/organizations(?:\?|$)/i.test(entry.url) &&
                        extractClaudeOrgInfo(entry.body) !== null
                    )
                    const planName = orgEntry ? extractClaudeOrgInfo(orgEntry.body)?.planName ?? null : null
                    return {
                      usage: buildClaudeProviderUsage(parsed, Date.now(), planName),
                      strategy: 'cdp_json',
                      httpStatus: intercepted.status,
                      diagnostic: 'Claude CDP JSON 수집 완료'
                    }
                  }
                }

                const cdp429 = capture.errorStatuses.find((e) => e.status === 429)
                if (cdp429) {
                  return makeErrorResult(
                    'Claude 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
                    { httpStatus: 429, rateLimited: true }
                  )
                }
                const cdpAuth = capture.errorStatuses.find(
                  (e) => e.status === 401 || e.status === 403
                )
                if (cdpAuth) {
                  return makeAuthRequiredResult(
                    'Claude 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
                    cdpAuth.status
                  )
                }

                // Fallback: DOM text parse on claude.ai/settings/usage
                const domParsed = parseClaudeUsageDomText(bodyText)
                if (domParsed) {
                  return {
                    usage: buildClaudeProviderUsage(domParsed),
                    strategy: 'dom_fallback',
                    diagnostic: 'Claude DOM 텍스트 파싱 완료'
                  }
                }

                return makeErrorResult(
                  'Claude 사용량 정보를 찾지 못했습니다. 로그인 상태를 확인하거나 sessionKey를 붙여넣어 주세요.'
                )
              } finally {
                capture.dispose()
              }
            }
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return makeErrorResult(`Claude 조회 중 오류: ${msg}`, { diagnostic: msg })
        }
      })
    }
  }
}
