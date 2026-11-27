import type { ProviderAuthSource, ProviderUsage } from '../../shared/types'
import { delay, runSingleFlightCollection, type ProviderAdapter, type ProviderCollectResult } from './base'
import { mergeSetCookieHeaders } from './cookieMerge'
import type { GeminiCookieCredential } from './geminiAuth'
import { buildGeminiProviderUsage, parseGeminiGraphqlResponse } from './geminiParser'
import {
  formatNetworkError,
  getHeaderValue,
  getSetCookieHeaders,
  netHttpRequest,
  type NetHttpResponse,
  type NetHttpTransport
} from './netHttp'

// Public UsagePageQuery persisted query used by https://gemini.google.com/usage
const GEMINI_USAGE_QUERY_SIGNATURE = '2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g='
const GEMINI_USAGE_QUERY_VARIABLES = JSON.stringify({
  g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] },
  workspaceRequest: { recommendationsForSurfaceRequests: [] }
})
const GOOGLE_ROTATE_COOKIES_URL = 'https://accounts.google.com/RotateCookies'
const GOOGLE_ROTATE_COOKIES_BODY = '[000,"-0000000000000000000"]'

export function buildGeminiUsageGraphqlUrl(authUserIndex?: number): string {
  const userPrefix =
    typeof authUserIndex === 'number' && Number.isInteger(authUserIndex) && authUserIndex > 0
      ? `/u/${authUserIndex}`
      : ''
  return (
    `https://gemini.google.com${userPrefix}/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery` +
    `?query_signature=${encodeURIComponent(GEMINI_USAGE_QUERY_SIGNATURE)}` +
    `&variables=${encodeURIComponent(GEMINI_USAGE_QUERY_VARIABLES)}`
  )
}

function makeAuthRequiredResult(
  message: string,
  httpStatus?: number,
  diagnostic?: string
): ProviderCollectResult {
  const usage: ProviderUsage = {
    id: 'gemini',
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
    diagnostic: diagnostic ?? message
  }
}

function makeErrorResult(
  message: string,
  options?: { httpStatus?: number; rateLimited?: boolean; diagnostic?: string }
): ProviderCollectResult {
  const usage: ProviderUsage = {
    id: 'gemini',
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

function isHttpAuthFailure(status: number): boolean {
  return (status >= 300 && status < 400) || status === 401 || status === 403
}

function formatRedirectHost(response: NetHttpResponse): string {
  const location = response.redirectUrl ?? getHeaderValue(response.headers, 'location')
  if (!location) return ''
  try {
    return ` -> ${new URL(location, 'https://gemini.google.com').host}`
  } catch {
    return ''
  }
}

export function resolveGeminiAuthSource(
  getImportedCookie: () => GeminiCookieCredential | null
): ProviderAuthSource {
  return getImportedCookie() ? 'imported_cookie' : 'none'
}

export function createGeminiAdapter(
  getImportedCookie: () => GeminiCookieCredential | null,
  saveImportedCookie?: (credential: GeminiCookieCredential) => void,
  transport: NetHttpTransport = netHttpRequest
): ProviderAdapter {
  const persistMergedCookies = (
    cred: GeminiCookieCredential,
    response: NetHttpResponse
  ): { cred: GeminiCookieCredential; updatedNames: string[] } => {
    const merged = mergeSetCookieHeaders(cred.cookieHeader, getSetCookieHeaders(response.headers))
    if (merged.updatedNames.length === 0) {
      return { cred, updatedNames: [] }
    }
    const updatedCred: GeminiCookieCredential = {
      ...cred,
      cookieHeader: merged.cookieHeader
    }
    saveImportedCookie?.(updatedCred)
    return { cred: updatedCred, updatedNames: merged.updatedNames }
  }

  const executeUsageQuery = async (cred: GeminiCookieCredential): Promise<NetHttpResponse> => {
    const refererUrl = cred.authUserIndex
      ? `https://gemini.google.com/u/${cred.authUserIndex}/usage`
      : 'https://gemini.google.com/usage'

    const requestOptions = {
      url: buildGeminiUsageGraphqlUrl(cred.authUserIndex),
      method: 'GET' as const,
      redirect: 'manual' as const,
      headers: {
        Accept: 'application/json',
        Referer: refererUrl,
        Cookie: cred.cookieHeader
      },
      timeoutMs: 12_000
    }

    try {
      return await transport(requestOptions)
    } catch (firstErr) {
      // Retry once after a brief pause for transient Windows socket / DNS blips
      await delay(300)
      try {
        return await transport(requestOptions)
      } catch {
        throw firstErr
      }
    }
  }

  /**
   * Attempts to renew Google's short-lived `__Secure-1PSIDTS` / `__Secure-3PSIDTS` cookies
   * via `accounts.google.com/RotateCookies` so imported sessions self-heal instead of expiring.
   */
  const tryRotateGoogleCookies = async (
    cred: GeminiCookieCredential
  ): Promise<{ rotated: boolean; cred: GeminiCookieCredential; updatedNames: string[]; status?: number }> => {
    try {
      const rotateRes = await transport({
        url: GOOGLE_ROTATE_COOKIES_URL,
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://gemini.google.com',
          Referer: 'https://gemini.google.com/',
          Cookie: cred.cookieHeader
        },
        body: GOOGLE_ROTATE_COOKIES_BODY,
        timeoutMs: 10_000
      })

      if (rotateRes.status >= 200 && rotateRes.status < 300) {
        const merged = persistMergedCookies(cred, rotateRes)
        return {
          rotated: merged.updatedNames.length > 0,
          cred: merged.cred,
          updatedNames: merged.updatedNames,
          status: rotateRes.status
        }
      }
      return { rotated: false, cred, updatedNames: [], status: rotateRes.status }
    } catch {
      return { rotated: false, cred, updatedNames: [] }
    }
  }

  return {
    id: 'gemini',

    collect(): Promise<ProviderCollectResult> {
      return runSingleFlightCollection('gemini', async () => {
        let activeCred = getImportedCookie()
        if (!activeCred) {
          return makeAuthRequiredResult(
            'Gemini 연결이 필요합니다. 카드를 클릭해 브라우저에서 쿠키(Copy as cURL)를 붙여넣어 주세요.'
          )
        }

        try {
          const authUserLabel = activeCred.authUserIndex ? `u/${activeCred.authUserIndex}` : 'u/0'
          let response = await executeUsageQuery(activeCred)
          activeCred = persistMergedCookies(activeCred, response).cred

          let parsedOutcome =
            response.status >= 200 && response.status < 300
              ? parseGeminiGraphqlResponse(response.body)
              : null

          const needsCookieRescue =
            isHttpAuthFailure(response.status) || parsedOutcome?.kind === 'auth_required'

          let rotatedNames: string[] = []
          let rotateNote = ''

          if (needsCookieRescue) {
            const rotation = await tryRotateGoogleCookies(activeCred)
            if (rotation.rotated) {
              activeCred = rotation.cred
              rotatedNames = rotation.updatedNames
              response = await executeUsageQuery(activeCred)
              activeCred = persistMergedCookies(activeCred, response).cred
              parsedOutcome =
                response.status >= 200 && response.status < 300
                  ? parseGeminiGraphqlResponse(response.body)
                  : null
            } else if (rotation.status !== undefined) {
              rotateNote = `, rotate=${rotation.status}`
            }
          }

          // Redirects (3xx -> accounts.google.com) or 401/403 mean expired/invalid Google cookies
          if (isHttpAuthFailure(response.status)) {
            const redirectHost = formatRedirectHost(response)
            return makeAuthRequiredResult(
              'Gemini 브라우저 쿠키가 만료되었거나 유효하지 않습니다. 설정에서 gemini.google.com/usage 쿠키를 다시 붙여넣어 주세요.',
              response.status,
              `Gemini 인증 실패 (HTTP ${response.status}, ${authUserLabel}${redirectHost}${rotateNote})`
            )
          }

          if (response.status === 429) {
            return makeErrorResult(
              'Gemini 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
              { httpStatus: 429, rateLimited: true }
            )
          }

          if (response.status >= 500) {
            return makeErrorResult(
              `Gemini 서버가 일시적으로 응답하지 않습니다 (HTTP ${response.status}).`,
              { httpStatus: response.status }
            )
          }

          if (response.status < 200 || response.status >= 300) {
            return makeErrorResult(`Gemini 사용량 조회 실패 (HTTP ${response.status}).`, {
              httpStatus: response.status
            })
          }

          const outcome = parsedOutcome ?? parseGeminiGraphqlResponse(response.body)

          if (outcome.kind === 'auth_required') {
            return makeAuthRequiredResult(
              'Gemini 로그인 세션이 만료되었습니다. 설정에서 쿠키를 다시 복사해 붙여넣어 주세요.',
              response.status,
              `Gemini 세션 만료 (viewer=null, ${authUserLabel}${rotateNote})`
            )
          }

          if (outcome.kind === 'no_windows') {
            return makeErrorResult(
              '이 Google 계정에서 표시할 Gemini 사용량 한도 구간을 찾지 못했습니다. (AI Pro/Ultra 구독 계정인지 확인해 주세요.)',
              { httpStatus: response.status }
            )
          }

          if (outcome.kind === 'invalid') {
            return makeErrorResult(
              'Gemini 사용량 응답 형식이 변경되었거나 해석에 실패했습니다.',
              { httpStatus: response.status }
            )
          }

          const rotationSuffix =
            rotatedNames.length > 0 ? ` · 쿠키 자동 갱신(${rotatedNames.join(', ')})` : ''

          return {
            usage: buildGeminiProviderUsage(outcome.parsed),
            strategy: 'session_fetch',
            httpStatus: response.status,
            diagnostic: `Gemini GraphQL 직접 조회 완료 (${outcome.parsed.subscriptionTier ?? 'unknown'})${rotationSuffix}`
          }
        } catch (err) {
          const msg = formatNetworkError(err)
          return makeErrorResult(`Gemini 조회 중 네트워크 오류: ${msg}`, { diagnostic: msg })
        }
      })
    }
  }
}
