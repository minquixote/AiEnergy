import { ChevronLeft, RefreshCw, SlidersHorizontal, Zap } from 'lucide-react'
import { APP_NAME } from '@shared/constants'
import type { DataSourceMode } from '@shared/types'
import { formatRelativeTime, getCooldownRemainingMs } from '@shared/usage'

interface HeaderProps {
  view: 'main' | 'settings' | 'debug'
  lastUpdatedAt: number | null
  cooldownUntil: number
  isRefreshing: boolean
  dataSourceMode: DataSourceMode
  now: number
  onRefresh: () => void
  onToggleView: () => void
}

export function Header({
  view,
  lastUpdatedAt,
  cooldownUntil,
  isRefreshing,
  dataSourceMode,
  now,
  onRefresh,
  onToggleView
}: HeaderProps) {
  const cooldownMs = getCooldownRemainingMs(cooldownUntil, now)
  const cooldownSec = Math.ceil(cooldownMs / 1000)
  const isCoolingDown = cooldownSec > 0 && !isRefreshing

  return (
    <header
      className="flex items-center justify-between px-3.5 py-3"
      style={{ borderBottom: '1px solid var(--border-hairline)' }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {view !== 'main' ? (
          <button
            id="btn-back-main"
            type="button"
            onClick={onToggleView}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--text-primary)'
            }}
            title={view === 'debug' ? '설정으로 돌아가기' : '메인으로 돌아가기'}
            aria-label={view === 'debug' ? '설정으로 돌아가기' : '메인으로 돌아가기'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--energy-high-text)'
            }}
          >
            <Zap className="h-3.5 w-3.5 fill-current" />
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[13px] font-semibold tracking-[-0.015em] leading-tight">
              {view === 'settings'
                ? '설정 및 로그인 관리'
                : view === 'debug'
                  ? '진단 및 디버그 로그'
                  : APP_NAME}
            </h1>
            {view === 'main' && (
              <span
                className="rounded px-1.5 py-[1px] text-[9px] font-semibold tracking-wider uppercase"
                style={{
                  backgroundColor:
                    dataSourceMode === 'live' ? 'var(--energy-high-soft)' : 'var(--surface-subtle)',
                  color:
                    dataSourceMode === 'live' ? 'var(--energy-high-text)' : 'var(--text-secondary)'
                }}
              >
                {dataSourceMode === 'live' ? 'LIVE' : 'MOCK'}
              </span>
            )}
          </div>
          <p
            className="mt-0.5 truncate text-[11px] leading-tight tabular-nums"
            style={{ color: 'var(--text-secondary)' }}
          >
            {view === 'settings'
              ? '로컬 전용 세션 · 외부 전송 없음'
              : view === 'debug'
                ? '민감 정보 자동 마스킹 · 최근 60건'
                : isRefreshing
                  ? '사용량 확인 중...'
                  : formatRelativeTime(lastUpdatedAt, now)}
          </p>
        </div>
      </div>

      {view === 'main' && (
        <div className="flex items-center gap-1.5">
          <button
            id="btn-refresh-usage"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing || isCoolingDown}
            className="flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors disabled:opacity-55 cursor-pointer disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--text-primary)'
            }}
            title={
              isCoolingDown
                ? `연속 요청 방지 쿨다운 (${cooldownSec}초 남음)`
                : '수동 새로고침 (30초 쿨다운)'
            }
            aria-label="수동 새로고침"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isCoolingDown && <span className="tabular-nums text-[10px]">{cooldownSec}s</span>}
          </button>

          <button
            id="btn-open-settings"
            type="button"
            onClick={onToggleView}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              color: 'var(--text-primary)'
            }}
            title="설정 및 로그인 관리"
            aria-label="설정 열기"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </header>
  )
}
