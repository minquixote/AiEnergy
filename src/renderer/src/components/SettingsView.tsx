import { LogIn, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import {
  LIVE_SUPPORTED_PROVIDERS,
  MOCK_SCENARIOS,
  PROVIDER_META,
  PROVIDER_ORDER,
  REFRESH_INTERVAL_OPTIONS
} from '@shared/constants'
import type {
  AppSettings,
  DataSourceMode,
  HostPlatform,
  MockScenarioId,
  ProviderId,
  ProviderUsage,
  ThemePreference
} from '@shared/types'
import { ProviderIcon } from './ProviderIcon'

interface SettingsViewProps {
  settings: AppSettings
  usages: Record<ProviderId, ProviderUsage>
  platform: HostPlatform
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  onSelectMockScenario: (scenario: MockScenarioId) => void
  onOpenLogin: (providerId: ProviderId) => void
  onDisconnect: (providerId: ProviderId) => void
}

function ToggleSwitch({
  id,
  checked,
  onChange,
  label
}: {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer"
      style={{
        backgroundColor: checked ? 'var(--energy-high)' : 'var(--surface-subtle)'
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{
          transform: checked ? 'translateX(19px)' : 'translateX(3px)'
        }}
      />
    </button>
  )
}

export function SettingsView({
  settings,
  usages,
  platform,
  onUpdateSettings,
  onSelectMockScenario,
  onOpenLogin,
  onDisconnect
}: SettingsViewProps) {
  const themeOptions: ReadonlyArray<{
    id: ThemePreference
    label: string
    Icon: typeof Moon
  }> = [
    { id: 'dark', label: '다크', Icon: Moon },
    { id: 'light', label: '라이트', Icon: Sun },
    { id: 'system', label: '시스템', Icon: Monitor }
  ]

  const sourceOptions: ReadonlyArray<{ id: DataSourceMode; label: string }> = [
    { id: 'live', label: '실연동 (LIVE)' },
    { id: 'mock', label: 'Mock 테스트' }
  ]

  return (
    <div className="settings-scroll flex flex-col gap-3 p-3">
      {/* Section 0: Data source mode */}
      <section className="surface-card p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-[11.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            데이터 소스
          </h2>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            ChatGPT 실연동 지원
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {sourceOptions.map((opt) => {
            const active = settings.dataSourceMode === opt.id
            return (
              <button
                key={opt.id}
                id={`btn-source-${opt.id}`}
                type="button"
                onClick={() => onUpdateSettings({ dataSourceMode: opt.id })}
                className="rounded-lg py-1.5 text-[11.5px] font-medium transition-colors cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--text-primary)' : 'var(--surface-subtle)',
                  color: active ? 'var(--surface-shell)' : 'var(--text-secondary)'
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Section 1: Provider login & visibility */}
      <section className="surface-card p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[11.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            플랫폼 연결 및 표시
          </h2>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            미구독 플랫폼 숨김 가능
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {PROVIDER_ORDER.map((id) => {
            const meta = PROVIDER_META[id]
            const enabled = settings.enabledProviders[id]
            const usage = usages[id]
            const isConnected = usage.status === 'ok'
            const isLiveSupported = LIVE_SUPPORTED_PROVIDERS.includes(id)
            const isPhase3Pending = settings.dataSourceMode === 'live' && !isLiveSupported

            const subLabel = !enabled
              ? '숨김'
              : isPhase3Pending
                ? 'Phase 3 예정'
                : isConnected
                  ? '연동됨'
                  : '로그인 필요'

            return (
              <div
                key={id}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  opacity: enabled ? 1 : 0.62
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderIcon id={id} className="h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium leading-tight">
                      {meta.name}
                    </div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {subLabel}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {enabled && !isPhase3Pending && (
                    <>
                      <button
                        id={`btn-login-${id}`}
                        type="button"
                        onClick={() => onOpenLogin(id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors cursor-pointer"
                        style={{
                          backgroundColor: 'var(--surface-card)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-hairline)'
                        }}
                      >
                        <LogIn className="h-3 w-3" />
                        {isConnected ? '재로그인' : '로그인'}
                      </button>

                      {isConnected && (
                        <button
                          id={`btn-disconnect-${id}`}
                          type="button"
                          onClick={() => onDisconnect(id)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer"
                          style={{
                            backgroundColor: 'var(--surface-card)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-hairline)'
                          }}
                          title={`${meta.name} 로컬 세션 초기화`}
                          aria-label={`${meta.name} 연결 해제`}
                        >
                          <LogOut className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}

                  <ToggleSwitch
                    id={`toggle-provider-${id}`}
                    checked={enabled}
                    label={`${meta.name} 표시 토글`}
                    onChange={(next) =>
                      onUpdateSettings({
                        enabledProviders: {
                          ...settings.enabledProviders,
                          [id]: next
                        }
                      })
                    }
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Section 2: Refresh interval, theme, tray options, notifications */}
      <section className="surface-card flex flex-col gap-3 p-3">
        <div>
          <span
            className="mb-1.5 block text-[11.5px] font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            자동 갱신 주기
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {REFRESH_INTERVAL_OPTIONS.map((minutes) => {
              const active = settings.refreshIntervalMinutes === minutes
              return (
                <button
                  key={minutes}
                  id={`btn-interval-${minutes}`}
                  type="button"
                  onClick={() => onUpdateSettings({ refreshIntervalMinutes: minutes })}
                  className="rounded-lg py-1.5 text-[11.5px] font-medium tabular-nums transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--text-primary)' : 'var(--surface-subtle)',
                    color: active ? 'var(--surface-shell)' : 'var(--text-secondary)'
                  }}
                >
                  {minutes}분
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <span
            className="mb-1.5 block text-[11.5px] font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            테마
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {themeOptions.map(({ id, label, Icon }) => {
              const active = settings.theme === id
              return (
                <button
                  key={id}
                  id={`btn-theme-${id}`}
                  type="button"
                  onClick={() => onUpdateSettings({ theme: id })}
                  className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11.5px] font-medium transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--text-primary)' : 'var(--surface-subtle)',
                    color: active ? 'var(--surface-shell)' : 'var(--text-secondary)'
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          className="flex flex-col gap-2.5 pt-2.5"
          style={{ borderTop: '1px solid var(--border-hairline)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-medium">
                {platform === 'darwin' ? '메뉴바 그래픽 안에 % 표시' : '메뉴바 % 표시 (macOS)'}
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                활성화된 플랫폼별 배터리 내부에 잔여 % 숫자 표시
              </div>
            </div>
            <ToggleSwitch
              id="toggle-tray-percentage"
              checked={settings.showTrayPercentage}
              label="메뉴바 배터리 그래픽 내부 퍼센트 표시"
              onChange={(next) => onUpdateSettings({ showTrayPercentage: next })}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-medium">데스크톱 알림</div>
              <div className="text-[10.5px]" style={{ color: 'var(--text-muted)' }}>
                20% 이하 진입 또는 100% 초기화 시 1회 알림
              </div>
            </div>
            <ToggleSwitch
              id="toggle-notifications"
              checked={settings.notificationsEnabled}
              label="OS 데스크톱 알림"
              onChange={(next) => onUpdateSettings({ notificationsEnabled: next })}
            />
          </div>
        </div>
      </section>

      {/* Section 3: Phase 1 Mock scenario switcher */}
      {settings.dataSourceMode === 'mock' && (
        <section className="surface-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11.5px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Mock 테스트 시나리오
            </h2>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Phase 1 UI 검증
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {MOCK_SCENARIOS.map((item) => {
              const active = settings.mockScenario === item.id
              return (
                <button
                  key={item.id}
                  id={`btn-mock-${item.id}`}
                  type="button"
                  onClick={() => onSelectMockScenario(item.id)}
                  className="rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--text-primary)' : 'var(--surface-subtle)',
                    color: active ? 'var(--surface-shell)' : 'var(--text-primary)'
                  }}
                >
                  <div className="text-[11px] font-semibold leading-tight">{item.label}</div>
                  <div
                    className="mt-0.5 text-[9.5px] leading-snug"
                    style={{
                      opacity: active ? 0.78 : 0.65
                    }}
                  >
                    {item.description}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
