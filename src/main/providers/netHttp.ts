import type { ClientRequest } from 'electron'

export interface NetHttpRequestOptions {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  redirect?: 'manual' | 'follow'
}

export interface NetHttpResponse {
  status: number
  headers: Record<string, string | string[]>
  body: string
  redirectUrl?: string
}

export type NetHttpTransport = (options: NetHttpRequestOptions) => Promise<NetHttpResponse>

interface ElectronNetLike {
  request: (options: {
    method?: string
    url?: string
    redirect?: 'follow' | 'error' | 'manual'
    credentials?: 'include' | 'omit' | 'same-origin'
  }) => ClientRequest
}

let cachedElectronNet: ElectronNetLike | null | undefined

async function getElectronNet(): Promise<ElectronNetLike | null> {
  if (cachedElectronNet !== undefined) {
    return cachedElectronNet
  }
  try {
    const mod = (await import('electron')) as unknown as {
      net?: ElectronNetLike
      default?: { net?: ElectronNetLike }
    }
    const candidate = mod?.net ?? mod?.default?.net
    if (candidate && typeof candidate.request === 'function') {
      cachedElectronNet = candidate
      return cachedElectronNet
    }
  } catch {
    // Running outside Electron (e.g. unit tests)
  }
  cachedElectronNet = null
  return null
}

function normalizeHeaders(
  rawHeaders: Record<string, string | string[] | undefined> | undefined
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  if (!rawHeaders) return out
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = value
  }
  return out
}

export function getHeaderValue(
  headers: Record<string, string | string[]>,
  name: string
): string | null {
  const val = headers[name.toLowerCase()]
  if (typeof val === 'string') return val
  if (Array.isArray(val) && val.length > 0) return val[0] ?? null
  return null
}

export function getSetCookieHeaders(headers: Record<string, string | string[]>): string[] {
  const val = headers['set-cookie']
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

export function formatNetworkError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const causeObj = cause as { code?: unknown; message?: unknown }
    const code = typeof causeObj.code === 'string' ? causeObj.code : ''
    const causeMsg = typeof causeObj.message === 'string' ? causeObj.message : ''
    if (code && causeMsg && !causeMsg.includes(code)) {
      return `${err.message} (${code}: ${causeMsg})`
    }
    if (code) return `${err.message} (${code})`
    if (causeMsg) return `${err.message} (${causeMsg})`
  }
  return err.message
}

async function fallbackNodeFetch(options: NetHttpRequestOptions): Promise<NetHttpResponse> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 12_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await globalThis.fetch(options.url, {
      method: options.method ?? 'GET',
      redirect: options.redirect ?? 'manual',
      headers: options.headers,
      body: options.body,
      signal: controller.signal
    })

    const headers: Record<string, string | string[]> = {}
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower !== 'set-cookie') {
        headers[lower] = value
      }
    })
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
    if (typeof getSetCookie === 'function') {
      const setCookies = getSetCookie.call(res.headers)
      if (setCookies.length > 0) {
        headers['set-cookie'] = setCookies
      }
    } else {
      const single = res.headers.get('set-cookie')
      if (single) headers['set-cookie'] = [single]
    }

    const body = res.status >= 300 && res.status < 400 ? '' : await res.text()
    const location = res.headers.get('location') ?? undefined

    return {
      status: res.status,
      headers,
      body,
      redirectUrl: location
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Issues an HTTP/HTTPS request using Electron's Chromium `net.request` stack
 * (respecting Windows/macOS system proxy, VPN, and OS Root CA certificate store)
 * while allowing explicit `Cookie` headers without touching Electron's session jar.
 * Falls back to `globalThis.fetch` only when running outside Electron (e.g. unit tests).
 */
export async function netHttpRequest(options: NetHttpRequestOptions): Promise<NetHttpResponse> {
  const electronNet = await getElectronNet()
  if (!electronNet) {
    return fallbackNodeFetch(options)
  }

  const timeoutMs = options.timeoutMs ?? 12_000
  const redirectMode = options.redirect ?? 'manual'

  return new Promise<NetHttpResponse>((resolve, reject) => {
    let settled = false
    let req: ClientRequest

    const finishResolve = (value: NetHttpResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const finishReject = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    }

    try {
      req = electronNet.request({
        method: options.method ?? 'GET',
        url: options.url,
        redirect: redirectMode,
        credentials: 'omit'
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const timer = setTimeout(() => {
      finishReject(new Error(`요청 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초)`))
      try {
        req.abort()
      } catch {
        // Ignore abort cleanup error
      }
    }, timeoutMs)

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        if (value !== undefined && value !== '') {
          req.setHeader(key, value)
        }
      }
    }

    req.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
      if (redirectMode === 'manual') {
        const headers = normalizeHeaders(responseHeaders)
        if (redirectUrl && !headers['location']) {
          headers['location'] = redirectUrl
        }
        finishResolve({
          status: statusCode,
          headers,
          body: '',
          redirectUrl
        })
        try {
          req.abort()
        } catch {
          // Expected when stopping manual redirect
        }
        return
      }
      req.followRedirect()
    })

    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        finishResolve({
          status: res.statusCode,
          headers: normalizeHeaders(res.headers),
          body: Buffer.concat(chunks).toString('utf8')
        })
      })
      res.on('error', (err) => {
        finishReject(err instanceof Error ? err : new Error(String(err)))
      })
    })

    req.on('error', (err) => {
      finishReject(err instanceof Error ? err : new Error(String(err)))
    })

    req.on('abort', () => {
      finishReject(new Error('네트워크 요청이 중단되었습니다.'))
    })

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}
