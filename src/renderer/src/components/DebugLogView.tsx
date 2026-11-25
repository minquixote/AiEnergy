import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { PROVIDER_META } from '@shared/constants'
import type { DebugLogEntry, DebugLogLevel, ProviderId } from '@shared/types'

interface DebugLogViewProps {
  appVersion: string
  isPackaged: boolean
  onLoadLogs: () => Promise<DebugLogEntry[]>
  onClearLogs: () => Promise<DebugLogEntry[]>
  onCopyLogs: () => Promise<boolean>
}

type LogFilter = 'all' | ProviderId | 'errors'

const LEVEL_STYLE: Record<DebugLogLevel, { dot: string; bg: string; text: string; label: string }> =
  {
    info: {
      dot: 'var(--energy-high)',
      bg: 'var(--energy-high-soft)',
      text: 'var(--energy-high-text)',
      label: 'INFO'
    },
    warn: {
      dot: 'var(--energy-medium)',
      bg: 'var(--energy-medium-soft)',
      text: 'var(--energy-medium-text)',
      label: 'WARN'
    },
    error: {
      dot: 'var(--energy-low)',
      bg: 'var(--energy-low-soft)',
      text: 'var(--energy-low-text)',
      label: 'ERR'
    }
  }

function formatLogClock(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function getProviderLabel(id: ProviderId | 'system'): string {
  if (id === 'system') return 'System'
  return PROVIDER_META[id].name
}

export function DebugLogView({
  appVersion,
  isPackaged,
  onLoadLogs,
  onClearLogs,
  onCopyLogs
}: DebugLogViewProps) {
  const [logs, setLogs] = useState<DebugLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [copied, setCopied] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await onLoadLogs()
      setLogs(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs
    if (filter === 'errors') {
      return logs.filter((entry) => entry.level === 'error' || entry.level === 'warn')
    }
    return logs.filter((entry) => entry.providerId === filter)
  }, [logs, filter])

  const handleCopy = async (): Promise<void> => {
    const ok = await onCopyLogs()
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const handleClear = async (): Promise<void> => {
    const next = await onClearLogs()
    setLogs(next)
  }

  const filterButtons: ReadonlyArray<{ id: LogFilter; label: string }> = [
    { id: 'all', label: '전체' },
    { id: 'chatgpt', label: 'ChatGPT' },
    { id: 'gemini', label: 'Gemini' },
    { id: 'claude', label: 'Claude' },
    { id: 'errors', label: '주의/오류' }
  ]

  return (
    <div className="settings-scroll flex flex-col gap-2.5 p-3">
      {/* Top toolbar */}
      <section className="surface-card flex flex-col gap-2 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--text-secondary)' }}>
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--energy-high-text)' }} />
            <span>
              v{appVersion} · {isPackaged ? '설치 앱' : '개발 모드'} · {logs.length}건
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              id="btn-reload-debug-logs"
              type="button"
              onClick={() => void reload()}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text-secondary)'
              }}
              title="로그 새로고침"
              aria-label="로그 새로고침"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              id="btn-copy-debug-logs"
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10.5px] font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text-primary)'
              }}
              title="민감 정보가 마스킹된 진단 리포트 복사"
            >
              {copied ? (
                <Check className="h-3 w-3" style={{ color: 'var(--energy-high-text)' }} />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? '복사됨' : '복사'}
            </button>

            <button
              id="btn-clear-debug-logs"
              type="button"
              disabled={logs.length === 0}
              onClick={() => void handleClear()}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--energy-low-text)'
              }}
              title="디버그 로그 비우기"
              aria-label="디버그 로그 비우기"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-1">
          {filterButtons.map((btn) => {
            const active = filter === btn.id
            return (
              <button
                key={btn.id}
                id={`btn-log-filter-${btn.id}`}
                type="button"
                onClick={() => setFilter(btn.id)}
                className="rounded-md px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--text-primary)' : 'var(--surface-subtle)',
                  color: active ? 'var(--surface-shell)' : 'var(--text-secondary)'
                }}
              >
                {btn.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Log entries */}
      <section className="surface-card flex flex-col divide-y overflow-hidden" style={{ borderColor: 'var(--border-hairline)' }}>
        {loading && logs.length === 0 ? (
          <div className="p-6 text-center text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            로그 불러오는 중...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[11.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              표시할 로그가 없습니다.
            </p>
            <p className="mt-1 text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
              실연동(LIVE) 새로고침 시 수집 전략과 상태가 기록됩니다.
            </p>
          </div>
        ) : (
          <div className="max-h-[330px] overflow-y-auto">
            {filteredLogs.map((entry, idx) => {
              const lvl = LEVEL_STYLE[entry.level]
              return (
                <div
                  key={entry.id}
                  className="px-2.5 py-2"
                  style={{
                    borderTop: idx > 0 ? '1px solid var(--border-hairline)' : undefined
                  }}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: lvl.dot }}
                      />
                      <span className="text-[11px] font-semibold">
                        {getProviderLabel(entry.providerId)}
                      </span>
                      {entry.strategy && (
                        <span
                          className="truncate rounded px-1 py-[0.5px] font-mono text-[9.5px]"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--text-secondary)'
                          }}
                        >
                          {entry.strategy}
                        </span>
                      )}
                      {typeof entry.httpStatus === 'number' && (
                        <span
                          className="rounded px-1 py-[0.5px] font-mono text-[9.5px] tabular-nums"
                          style={{
                            backgroundColor: lvl.bg,
                            color: lvl.text
                          }}
                        >
                          {entry.httpStatus}
                        </span>
                      )}
                    </div>
                    <span
                      className="shrink-0 font-mono text-[9.5px] tabular-nums"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatLogClock(entry.timestamp)}
                    </span>
                  </div>

                  <p
                    className="mt-1 text-[11px] leading-snug break-words"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {entry.message}
                  </p>

                  {entry.snippet && entry.snippet !== entry.message && (
                    <p
                      className="mt-0.5 font-mono text-[9.5px] leading-snug break-all"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {entry.snippet}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <p className="px-1 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
        쿠키·토큰·이메일 등 민감 정보는 저장 및 복사 전 자동 마스킹됩니다.
      </p>
    </div>
  )
}
