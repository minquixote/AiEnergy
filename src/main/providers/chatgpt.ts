import { net, session } from 'electron'
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
import { readCodexCliCredential, type ChatGptCredential } from './chatgptAuth'
import {
  buildChatGptProviderUsage,
  parseChatGptUsageDomText,
  parseChatGptUsageJson
} from './chatgptParser'
import { formatNetworkError } from './netHttp'

const CHATGPT_WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
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
    strategy: 'session_fetch',
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
 * Queries `https://chatgpt.com/backend-api/wham/usage` directly using Electron's `net.fetch`
 * with a Bearer token from `~/.codex/auth.json` or an imported Chrome/Safari browser session.
 * No hidden BrowserWindow is created, so collection completes in ~0.3s and avoids Google webview blocks.
 */
async function collectWithDirectToken(
  credential: ChatGptCredential
): Promise<ProviderCollectResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${credential.accessToken}`
    }
    if (credential.accountId) {
      headers['ChatGPT-Account-Id'] = credential.accountId
    }

    const res = await net.fetch(CHATGPT_WHAM_USAGE_URL, {
      method: 'GET',
      headers,
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      const msg =
        credential.source === 'codex_cli'
          ? 'Codex CLI 세션(~/.codex/auth.json)이 만료되었습니다. 터미널에서 codex login을 실행하거나 설정에서 브라우저 세션을 붙여넣어 주세요.'
          : '가져온 ChatGPT 브라우저 세션이 만료되었습니다. 설정에서 세션을 다시 붙여넣어 주세요.'
      return makeAuthRequiredResult(msg, res.status)
    }

    if (res.status === 429) {
      return makeErrorResult(
        'ChatGPT 요청 제한(429)이 감지되었습니다. 잠시 후 자동으로 다시 시도합니다.',
        { httpStatus: 429, rateLimited: true }
      )
    }

    if (!res.ok) {
      return makeErrorResult(`ChatGPT 사용량 조회에 실패했습니다 (HTTP ${res.status}).`, {
        httpStatus: res.status
      })
    }

    const payload = (await res.json().catch(() => null)) as unknown
    const parsed = parseChatGptUsageJson(payload)
    if (!parsed) {
      return makeErrorResult(
        'ChatGPT 사용량 응답 형식을 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        { httpStatus: res.status }
      )
    }

    return {
      usage: buildChatGptProviderUsage(parsed),
      strategy: 'session_fetch',
      httpStatus: res.status,
      diagnostic: `${credential.source} 직접 조회 완료 (${parsed.planType ?? 'unknown'})`
    }
  } catch (err) {
    const msg = formatNetworkError(err)
    return makeErrorResult(`ChatGPT 직접 조회 중 네트워크 오류: ${msg}`, { diagnostic: msg })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWhamUsageInPage(win: Electron.BrowserWindow): Promise<InPageFetchOutcome> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return { kind: 'error', message: '수집 창이 종료되었습니다.' }
  }

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
  if (win.isDestroyed() || win.webContents.isDestroyed()) {
    return { url: '', title: '', text: '' }
  }
  const url = win.webContents.getURL()
  const title = win.getTitle()
  const text = (await win.webContents
    .executeJavaScript(`document.body ? (document.body.innerText || '') : ''`, true)
    .catch(() => '')) as string
  return { url, title, text }
}

export async function resolveChatGptAuthSource(
  getImportedSession: () => ChatGptCredential | null
): Promise<ProviderAuthSource> {
  if (getImportedSession()) return 'imported_session'
  if (readCodexCliCredential()) return 'codex_cli'
  if (await hasAnyChatGptCookie()) return 'browser_partition'
  return 'none'
}

export function createChatGptAdapter(
  getImportedSession: () => ChatGptCredential | null
): ProviderAdapter {
  return {
    id: 'chatgpt',

    collect(): Promise<ProviderCollectResult> {
      return runSingleFlightCollection('chatgpt', async () => {
        // Tier 1: Explicit user-imported Chrome/Safari browser session (encrypted locally via safeStorage)
        // Must take precedence over auto-detected ~/.codex/auth.json so users can switch accounts via Settings.
        const importedCred = getImportedSession()
        if (importedCred) {
          return collectWithDirectToken(importedCred)
        }

        // Tier 2: Official Codex CLI local credentials (~/.codex/auth.json)
        const codexCred = readCodexCliCredential()
        if (codexCred) {
          return collectWithDirectToken(codexCred)
        }

        // Tier 3: Embedded persist:chatgpt partition fallback (for direct email-code login users)
        if (!(await hasAnyChatGptCookie())) {
          return makeAuthRequiredResult(
            'ChatGPT 연결이 필요합니다. 카드를 클릭해 브라우저 세션 붙여넣기 또는 로그인을 진행해 주세요.'
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
                await loadPageUntilReady(win, CHATGPT_USAGE_URLS[0], 12_000)
                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('사용량 수집이 중단되었습니다.')
                }

                await delay(900)
                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('사용량 수집이 중단되었습니다.')
                }

                const pageInfo = await readPageDiagnostics(win)
                const authCheck = inspectAuthOrChallengeText(
                  pageInfo.url,
                  pageInfo.title,
                  pageInfo.text
                )

                if (authCheck.blockedOrUnauthenticated) {
                  const msg =
                    authCheck.reason === 'bot_challenge'
                      ? '보안 확인이 필요합니다. 설정에서 브라우저 세션 붙여넣기를 사용하거나 로그인 창에서 확인해 주세요.'
                      : 'ChatGPT 로그인 세션이 만료되었습니다. 설정에서 브라우저 세션 붙여넣기 또는 다시 로그인해 주세요.'
                  return makeAuthRequiredResult(msg)
                }

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
                    'ChatGPT 로그인 세션이 만료되었습니다. 설정에서 다시 연결해 주세요.',
                    cdpAuth.status
                  )
                }

                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('사용량 수집이 중단되었습니다.')
                }

                const fetchOutcome = await fetchWhamUsageInPage(win)
                if (fetchOutcome.kind === 'auth_required') {
                  return makeAuthRequiredResult(
                    'ChatGPT 로그인 세션이 만료되었습니다. 설정에서 브라우저 세션을 붙여넣거나 다시 로그인해 주세요.',
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

                await delay(1_000)
                if (signal.aborted || win.isDestroyed()) {
                  return makeErrorResult('사용량 수집이 중단되었습니다.')
                }

                const refreshedPage = await readPageDiagnostics(win)
                const domParsed = parseChatGptUsageDomText(refreshedPage.text)
                if (domParsed) {
                  return {
                    usage: buildChatGptProviderUsage(domParsed),
                    strategy: 'dom_fallback',
                    diagnostic: 'DOM 텍스트 파싱으로 수집 완료'
                  }
                }

                const detailSuffix = fetchOutcome.status ? ` (HTTP ${fetchOutcome.status})` : ''
                return makeErrorResult(
                  `ChatGPT 사용량 정보를 찾지 못했습니다${detailSuffix}. 설정에서 브라우저 세션 붙여넣기를 사용해 보세요.`,
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
}
