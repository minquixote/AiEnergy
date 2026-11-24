import { session } from 'electron'
import { PROVIDER_META } from '../../shared/constants'
import type { ProviderUsage } from '../../shared/types'
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
import {
  buildChatGptProviderUsage,
  parseChatGptUsageDomText,
  parseChatGptUsageJson
} from './chatgptParser'

const CHATGPT_USAGE_URLS = [
  'https://chatgpt.com/codex/settings/usage',
  'https://chatgpt.com/#settings/Usage'
] as const

interface InPageFetchOutcome {
  kind: 'ok' | 'auth_required' | 'rate_limited' | 'error'
  status?: number
  payload?: unknown
  message?: string
}

function makeAuthRequiredResult(message: string, httpStatus?: number): ProviderCollectResult {
  const usage: ProviderUsage = {
    id: 'chatgpt',
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
    id: 'chatgpt',
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
    strategy: 'dom_fallback',
    httpStatus: options?.httpStatus,
    rateLimited: options?.rateLimited,
    diagnostic: options?.diagnostic ?? message
  }
}

async function hasAnyChatGptCookie(): Promise<boolean> {
  const providerSession = session.fromPartition(PROVIDER_META.chatgpt.partition)
  const cookies = await providerSession.cookies.get({ domain: 'chatgpt.com' })
  return cookies.length > 0
}

/**
 * Fetches `/api/auth/session` and `/backend-api/wham/usage` from inside the logged-in
 * `chatgpt.com` window context so cookies and origin headers match a standard browser tab.
 */
async function fetchWhamUsageInPage(win: Electron.BrowserWindow): Promise<InPageFetchOutcome> {
  const script = `(async () => {
    try {
      const sessionRes = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (sessionRes.status === 401 || sessionRes.status === 403) {
        return { kind: 'auth_required', status: sessionRes.status, message: '세션 인증이 만료되었습니다.' };
      }
      if (sessionRes.status === 429) {
        return { kind: 'rate_limited', status: 429, message: '요청이 많아 일시 제한(429)되었습니다.' };
      }
      if (!sessionRes.ok) {
        return { kind: 'error', status: sessionRes.status, message: '세션 확인 실패 (HTTP ' + sessionRes.status + ')' };
      }

      const sessionData = await sessionRes.json().catch(() => null);
      const token = sessionData && typeof sessionData.accessToken === 'string' ? sessionData.accessToken : null;
      if (!token) {
        return { kind: 'auth_required', status: 200, message: '로그인된 ChatGPT 세션을 찾을 수 없습니다.' };
      }

      let jwtAccountId = null;
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const claims = JSON.parse(atob(padded));
          const authClaim = claims && claims['https://api.openai.com/auth'];
          if (authClaim && typeof authClaim.chatgpt_account_id === 'string') {
            jwtAccountId = authClaim.chatgpt_account_id;
          }
        }
      } catch {}

      const accountId =
        (sessionData.account && typeof sessionData.account.id === 'string' && sessionData.account.id) ||
        (sessionData.user && typeof sessionData.user.account_id === 'string' && sessionData.user.account_id) ||
        jwtAccountId ||
        null;

      const headers = {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token
      };
      if (accountId) {
        headers['ChatGPT-Account-Id'] = accountId;
      }

      const usageRes = await fetch('/backend-api/wham/usage', {
        method: 'GET',
        credentials: 'include',
        headers
      });

      if (usageRes.status === 401 || usageRes.status === 403) {
        return { kind: 'auth_required', status: usageRes.status, message: '사용량 조회 권한이 만료되었습니다.' };
      }
      if (usageRes.status === 429) {
        return { kind: 'rate_limited', status: 429, message: 'ChatGPT 요청 제한(429)이 감지되어 잠시 대기합니다.' };
      }
      if (!usageRes.ok) {
        return { kind: 'error', status: usageRes.status, message: '사용량 API 응답 오류 (HTTP ' + usageRes.status + ')' };
      }

      const payload = await usageRes.json().catch(() => null);
      return { kind: 'ok', status: usageRes.status, payload };
    } catch (err) {
      return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  })()`

  return (await win.webContents.executeJavaScript(script, true)) as InPageFetchOutcome
}

async function readPageDiagnostics(win: Electron.BrowserWindow): Promise<{
  url: string
  title: string
  text: string
}> {
  const url = win.webContents.getURL()
  const title = win.getTitle()
  const text = (await win.webContents
    .executeJavaScript(`document.body ? (document.body.innerText || '') : ''`, true)
    .catch(() => '')) as string
  return { url, title, text }
}

export const chatgptAdapter: ProviderAdapter = {
  id: 'chatgpt',

  collect(): Promise<ProviderCollectResult> {
    return runSingleFlightCollection('chatgpt', async () => {
      if (!(await hasAnyChatGptCookie())) {
        return makeAuthRequiredResult(
          'ChatGPT 로그인이 필요합니다. 카드를 클릭해 공식 페이지에서 로그인해 주세요.'
        )
      }

      try {
        return await withHiddenCollectorWindow(
          { providerId: 'chatgpt', timeoutMs: 22_000 },
          async (win, signal) => {
            const capture = await attachNetworkJsonCapture(win, (url) =>
              /chatgpt\.com\/backend-api\/(?:wham\/)?usage/i.test(url)
            )

            try {
              // Navigate to the ChatGPT usage page so SPA triggers official usage requests
              await loadPageUntilReady(win, CHATGPT_USAGE_URLS[0], 12_000)
              if (signal.aborted) {
                return makeErrorResult('사용량 수집이 중단되었습니다.')
              }

              // Brief settle for redirects or Cloudflare/login gates
              await delay(900)
              const pageInfo = await readPageDiagnostics(win)
              const authCheck = inspectAuthOrChallengeText(
                pageInfo.url,
                pageInfo.title,
                pageInfo.text
              )

              if (authCheck.blockedOrUnauthenticated) {
                const msg =
                  authCheck.reason === 'bot_challenge'
                    ? '보안 확인이 필요합니다. 카드를 클릭해 로그인 창에서 직접 확인해 주세요.'
                    : 'ChatGPT 로그인 세션이 만료되었습니다. 카드를 클릭해 다시 로그인해 주세요.'
                return makeAuthRequiredResult(msg)
              }

              // Priority 1: Check if CDP already intercepted the official JSON usage response
              const intercepted = await capture.waitForMatch(
                (entry) => parseChatGptUsageJson(entry.body) !== null,
                2_800
              )
              if (intercepted) {
                const parsed = parseChatGptUsageJson(intercepted.body)
                if (parsed) {
                  return {
                    usage: buildChatGptProviderUsage(parsed),
                    strategy: 'cdp_json',
                    httpStatus: intercepted.status,
                    diagnostic: `CDP JSON 수집 완료 (${parsed.planType ?? 'unknown'})`
                  }
                }
              }

              // Check if CDP observed 401/403 or 429 on usage endpoint
              const cdp429 = capture.errorStatuses.find((e) => e.status === 429)
              if (cdp429) {
                return makeErrorResult(
                  'ChatGPT 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
                  { httpStatus: 429, rateLimited: true }
                )
              }
              const cdpAuth = capture.errorStatuses.find(
                (e) => e.status === 401 || e.status === 403
              )
              if (cdpAuth) {
                return makeAuthRequiredResult(
                  'ChatGPT 로그인 세션이 만료되었습니다. 카드를 클릭해 다시 로그인해 주세요.',
                  cdpAuth.status
                )
              }

              // Priority 2: Direct same-origin session + wham/usage JSON fetch inside logged-in chatgpt.com origin
              const fetchOutcome = await fetchWhamUsageInPage(win)
              if (fetchOutcome.kind === 'auth_required') {
                return makeAuthRequiredResult(
                  'ChatGPT 로그인 세션이 만료되었습니다. 카드를 클릭해 다시 로그인해 주세요.',
                  fetchOutcome.status
                )
              }
              if (fetchOutcome.kind === 'rate_limited') {
                return makeErrorResult(
                  'ChatGPT 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
                  { httpStatus: 429, rateLimited: true }
                )
              }
              if (fetchOutcome.kind === 'ok') {
                const parsed = parseChatGptUsageJson(fetchOutcome.payload)
                if (parsed) {
                  return {
                    usage: buildChatGptProviderUsage(parsed),
                    strategy: 'session_fetch',
                    httpStatus: fetchOutcome.status,
                    diagnostic: `Session JSON 수집 완료 (${parsed.planType ?? 'unknown'})`
                  }
                }
              }

              // Priority 3: DOM text fallback on rendered usage page (codex usage -> unified Settings > Usage)
              await delay(1_200)
              const refreshedPage = await readPageDiagnostics(win)
              const domParsed = parseChatGptUsageDomText(refreshedPage.text)
              if (domParsed) {
                return {
                  usage: buildChatGptProviderUsage(domParsed),
                  strategy: 'dom_fallback',
                  diagnostic: 'DOM 텍스트 파싱으로 수집 완료'
                }
              }

              if (!signal.aborted) {
                await loadPageUntilReady(win, CHATGPT_USAGE_URLS[1], 8_000)
                await delay(1_200)
                const settingsIntercepted = await capture.waitForMatch(
                  (entry) => parseChatGptUsageJson(entry.body) !== null,
                  1_500
                )
                if (settingsIntercepted) {
                  const parsed = parseChatGptUsageJson(settingsIntercepted.body)
                  if (parsed) {
                    return {
                      usage: buildChatGptProviderUsage(parsed),
                      strategy: 'cdp_json',
                      httpStatus: settingsIntercepted.status,
                      diagnostic: `Settings CDP JSON 수집 완료 (${parsed.planType ?? 'unknown'})`
                    }
                  }
                }

                const settingsPage = await readPageDiagnostics(win)
                const settingsDomParsed = parseChatGptUsageDomText(settingsPage.text)
                if (settingsDomParsed) {
                  return {
                    usage: buildChatGptProviderUsage(settingsDomParsed),
                    strategy: 'dom_fallback',
                    diagnostic: 'Settings > Usage DOM 파싱으로 수집 완료'
                  }
                }
              }

              const detailSuffix = fetchOutcome.status ? ` (HTTP ${fetchOutcome.status})` : ''
              return makeErrorResult(
                `ChatGPT 사용량 정보를 찾지 못했습니다${detailSuffix}. 로그인 상태를 확인하거나 잠시 후 다시 시도해 주세요.`,
                {
                  httpStatus: fetchOutcome.status,
                  diagnostic: fetchOutcome.message ?? `URL: ${refreshedPage.url}`
                }
              )
            } finally {
              capture.dispose()
            }
          }
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return makeErrorResult(`ChatGPT 조회 중 오류가 발생했습니다: ${msg}`, {
          diagnostic: msg
        })
      }
    })
  }
}
