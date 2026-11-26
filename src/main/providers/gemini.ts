import type { ProviderAuthSource, ProviderUsage } from '../../shared/types'
import { runSingleFlightCollection, type ProviderAdapter, type ProviderCollectResult } from './base'
import type { GeminiCookieCredential } from './geminiAuth'
import { buildGeminiProviderUsage, parseGeminiGraphqlResponse } from './geminiParser'

// Public UsagePageQuery persisted query used by https://gemini.google.com/usage
const GEMINI_USAGE_QUERY_SIGNATURE = '2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g='
const GEMINI_USAGE_QUERY_VARIABLES = JSON.stringify({
  g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] },
  workspaceRequest: { recommendationsForSurfaceRequests: [] }
})

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

export function resolveGeminiAuthSource(
  getImportedCookie: () => GeminiCookieCredential | null
): ProviderAuthSource {
  return getImportedCookie() ? 'imported_cookie' : 'none'
}

export function createGeminiAdapter(
  getImportedCookie: () => GeminiCookieCredential | null
): ProviderAdapter {
  return {
    id: 'gemini',

    collect(): Promise<ProviderCollectResult> {
      return runSingleFlightCollection('gemini', async () => {
        const cred = getImportedCookie()
        if (!cred) {
          return makeAuthRequiredResult(
            'Gemini 연결이 필요합니다. 카드를 클릭해 브라우저에서 쿠키(Copy as cURL)를 붙여넣어 주세요.'
          )
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 12_000)

        try {
          const authUserLabel = cred.authUserIndex ? `u/${cred.authUserIndex}` : 'u/0'
          const refererUrl = cred.authUserIndex
            ? `https://gemini.google.com/u/${cred.authUserIndex}/usage`
            : 'https://gemini.google.com/usage'

          const response = await globalThis.fetch(buildGeminiUsageGraphqlUrl(cred.authUserIndex), {
            method: 'GET',
            redirect: 'manual',
            headers: {
              Accept: 'application/json',
              Referer: refererUrl,
              Cookie: cred.cookieHeader
            },
            signal: controller.signal
          })

          // Redirects (3xx -> accounts.google.com) or 401/403 mean expired/invalid Google cookies
          if (
            (response.status >= 300 && response.status < 400) ||
            response.status === 401 ||
            response.status === 403
          ) {
            let redirectHost = ''
            const location = response.headers.get('location')
            if (location) {
              try {
                redirectHost = ` -> ${new URL(location, 'https://gemini.google.com').host}`
              } catch {
                redirectHost = ''
              }
            }
            return makeAuthRequiredResult(
              'Gemini 브라우저 쿠키가 만료되었거나 유효하지 않습니다. 설정에서 gemini.google.com/usage 쿠키를 다시 붙여넣어 주세요.',
              response.status,
              `Gemini 인증 실패 (HTTP ${response.status}, ${authUserLabel}${redirectHost})`
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

          if (!response.ok) {
            return makeErrorResult(`Gemini 사용량 조회 실패 (HTTP ${response.status}).`, {
              httpStatus: response.status
            })
          }

          const bodyText = await response.text()
          const outcome = parseGeminiGraphqlResponse(bodyText)

          if (outcome.kind === 'auth_required') {
            return makeAuthRequiredResult(
              'Gemini 로그인 세션이 만료되었습니다. 설정에서 쿠키를 다시 복사해 붙여넣어 주세요.',
              response.status
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

          return {
            usage: buildGeminiProviderUsage(outcome.parsed),
            strategy: 'session_fetch',
            httpStatus: response.status,
            diagnostic: `Gemini GraphQL 직접 조회 완료 (${outcome.parsed.subscriptionTier ?? 'unknown'})`
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return makeErrorResult(`Gemini 조회 중 네트워크 오류: ${msg}`, { diagnostic: msg })
        } finally {
          clearTimeout(timer)
        }
      })
    }
  }
}
