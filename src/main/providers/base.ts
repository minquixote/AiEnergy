import { BrowserWindow, session } from 'electron'
import { PROVIDER_META } from '../../shared/constants'
import type { ProviderId, ProviderUsage } from '../../shared/types'

export type CollectionStrategy =
  | 'cdp_json'
  | 'session_fetch'
  | 'dom_fallback'
  | 'auth_check'
  | 'unimplemented'

export interface ProviderCollectResult {
  usage: ProviderUsage
  strategy: CollectionStrategy
  httpStatus?: number
  rateLimited?: boolean
  diagnostic?: string
}

export interface ProviderAdapter {
  readonly id: ProviderId
  collect(): Promise<ProviderCollectResult>
}

export interface CapturedNetworkJson {
  url: string
  status: number
  body: unknown
  receivedAt: number
}

export interface NetworkCaptureHandle {
  readonly captured: CapturedNetworkJson[]
  readonly errorStatuses: Array<{ url: string; status: number }>
  waitForMatch: (predicate: (entry: CapturedNetworkJson) => boolean, timeoutMs: number) => Promise<CapturedNetworkJson | null>
  dispose: () => void
}

export function buildCleanUserAgent(rawUa: string): string {
  return rawUa.replace(/\s*Electron\/[^\s]+/i, '').replace(/\s*ai-energy-bar\/[^\s]+/i, '')
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const inFlightCollections = new Map<ProviderId, Promise<ProviderCollectResult>>()

/**
 * Serializes/deduplicates concurrent background collections per provider so hidden windows
 * never pile up when auto-refresh overlaps with manual refresh or login-window close.
 */
export function runSingleFlightCollection(
  providerId: ProviderId,
  task: () => Promise<ProviderCollectResult>
): Promise<ProviderCollectResult> {
  const existing = inFlightCollections.get(providerId)
  if (existing) return existing

  const promise = task().finally(() => {
    inFlightCollections.delete(providerId)
  })
  inFlightCollections.set(providerId, promise)
  return promise
}

export interface HiddenCollectorOptions {
  providerId: ProviderId
  timeoutMs?: number
}

/**
 * Creates a short-lived hidden BrowserWindow bound to the provider's persistent session
 * partition and guarantees complete teardown (debugger detach + window destroy) on completion
 * or timeout.
 */
export async function withHiddenCollectorWindow<T>(
  options: HiddenCollectorOptions,
  runner: (win: BrowserWindow, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const { providerId, timeoutMs = 20_000 } = options
  const meta = PROVIDER_META[providerId]
  const providerSession = session.fromPartition(meta.partition)
  providerSession.setUserAgent(buildCleanUserAgent(providerSession.getUserAgent()))

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition: meta.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  // Prevent hidden collector pages from opening popups or alerts
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const controller = new AbortController()
  let timeoutHandle: NodeJS.Timeout | null = null

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error(`수집 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([runner(win, controller.signal), timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (!win.isDestroyed()) {
      try {
        if (win.webContents.debugger.isAttached()) {
          win.webContents.debugger.detach()
        }
      } catch {
        // Ignore debugger detach errors during teardown
      }
      win.destroy()
    }
  }
}

/**
 * Attaches Chrome DevTools Protocol (CDP) Network listeners to intercept JSON responses
 * matching a URL pattern without modifying page scripts or encountering CORS issues.
 */
export async function attachNetworkJsonCapture(
  win: BrowserWindow,
  urlMatcher: (url: string) => boolean
): Promise<NetworkCaptureHandle> {
  const captured: CapturedNetworkJson[] = []
  const errorStatuses: Array<{ url: string; status: number }> = []
  const pendingMeta = new Map<string, { url: string; status: number }>()
  const waiters = new Set<() => void>()

  const notifyWaiters = (): void => {
    for (const wake of waiters) wake()
  }

  const dbg = win.webContents.debugger
  let attached = false

  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3')
    }
    attached = true
    await dbg.sendCommand('Network.enable', { maxPostDataSize: 0 })
  } catch {
    // If CDP attach fails on a given platform/build, return a no-op handle so fallback paths still run
    return {
      captured,
      errorStatuses,
      waitForMatch: async () => null,
      dispose: () => undefined
    }
  }

  const onMessage = async (
    _event: Electron.Event,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> => {
    if (method === 'Network.responseReceived') {
      const requestId = typeof params['requestId'] === 'string' ? params['requestId'] : ''
      const response = params['response'] as Record<string, unknown> | undefined
      const url = typeof response?.['url'] === 'string' ? response['url'] : ''
      const status = typeof response?.['status'] === 'number' ? response['status'] : 0
      if (!requestId || !url || !urlMatcher(url)) return

      if (status >= 400) {
        errorStatuses.push({ url, status })
        notifyWaiters()
      }
      pendingMeta.set(requestId, { url, status })
      return
    }

    if (method === 'Network.loadingFinished') {
      const requestId = typeof params['requestId'] === 'string' ? params['requestId'] : ''
      const meta = pendingMeta.get(requestId)
      if (!meta) return
      pendingMeta.delete(requestId)

      if (meta.status < 200 || meta.status >= 300) return
      if (win.isDestroyed() || !dbg.isAttached()) return

      try {
        const res = (await dbg.sendCommand('Network.getResponseBody', { requestId })) as {
          body?: string
          base64Encoded?: boolean
        }
        if (!res?.body) return
        const text = res.base64Encoded
          ? Buffer.from(res.body, 'base64').toString('utf8')
          : res.body
        const parsed = JSON.parse(text) as unknown
        captured.push({
          url: meta.url,
          status: meta.status,
          body: parsed,
          receivedAt: Date.now()
        })
        notifyWaiters()
      } catch {
        // Ignore non-JSON or evicted body buffers
      }
    }
  }

  dbg.on('message', onMessage)

  return {
    captured,
    errorStatuses,
    waitForMatch: (predicate, timeoutMs) => {
      const existing = captured.find(predicate)
      if (existing) return Promise.resolve(existing)

      return new Promise((resolve) => {
        let done = false
        const finish = (entry: CapturedNetworkJson | null): void => {
          if (done) return
          done = true
          waiters.delete(check)
          clearTimeout(timer)
          resolve(entry)
        }
        const check = (): void => {
          const match = captured.find(predicate)
          if (match) finish(match)
        }
        const timer = setTimeout(() => finish(null), timeoutMs)
        waiters.add(check)
      })
    },
    dispose: () => {
      waiters.clear()
      pendingMeta.clear()
      if (!win.isDestroyed() && attached) {
        dbg.removeListener('message', onMessage)
        try {
          if (dbg.isAttached()) dbg.detach()
        } catch {
          // Ignore detach race
        }
      }
    }
  }
}

export interface PageAuthInspection {
  blockedOrUnauthenticated: boolean
  reason?: 'login_redirect' | 'bot_challenge'
}

const LOGIN_URL_PATTERNS = [
  /auth\.openai\.com/i,
  /\/auth\/login/i,
  /\/u\/login/i,
  /accounts\.google\.com\/(?:v3\/signin|ServiceLogin)/i,
  /claude\.ai\/login/i
]

const CHALLENGE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /verify you are human/i,
  /checking your browser/i,
  /cf-turnstile/i,
  /enable javascript and cookies to continue/i
]

/**
 * Pure detector for login redirects and anti-bot / human-verification gates.
 * When detected, adapters must stop immediately and prompt user login rather than bypassing.
 */
export function inspectAuthOrChallengeText(
  url: string,
  title: string,
  bodySnippet: string
): PageAuthInspection {
  if (LOGIN_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return { blockedOrUnauthenticated: true, reason: 'login_redirect' }
  }

  const combined = `${title}\n${bodySnippet.slice(0, 1500)}`
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { blockedOrUnauthenticated: true, reason: 'bot_challenge' }
  }

  return { blockedOrUnauthenticated: false }
}

export async function loadPageUntilReady(
  win: BrowserWindow,
  url: string,
  timeoutMs = 12_000
): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (err?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!win.isDestroyed()) {
        win.removeListener('closed', onClosed)
        if (!win.webContents.isDestroyed()) {
          win.webContents.removeListener('dom-ready', onReady)
          win.webContents.removeListener('did-fail-load', onFail)
        }
      }
      if (err) reject(err)
      else resolve()
    }

    const onReady = (): void => finish()
    const onClosed = (): void => finish()
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean
    ): void => {
      // Ignore sub-frame cancellations or ERR_ABORTED (-3) caused by SPA redirects
      if (!isMainFrame || errorCode === -3) return
      finish(new Error(`페이지 로드 실패 (${errorCode}: ${errorDescription})`))
    }

    const timer = setTimeout(() => finish(), timeoutMs)
    win.once('closed', onClosed)
    win.webContents.once('dom-ready', onReady)
    win.webContents.on('did-fail-load', onFail)
    void win.loadURL(url).catch((err: unknown) => {
      const code = (err as { code?: string })?.code
      if (code === 'ERR_ABORTED' || win.isDestroyed()) {
        finish()
        return
      }
      finish(err instanceof Error ? err : new Error(String(err)))
    })
  })
}
