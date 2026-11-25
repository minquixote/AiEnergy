import { useEffect, useState } from 'react'
import {
  Check,
  ExternalLink,
  KeyRound,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Terminal
} from 'lucide-react'
import {
  LIVE_SUPPORTED_PROVIDERS,
  MOCK_SCENARIOS,
  PROVIDER_META,
  PROVIDER_ORDER,
  REFRESH_INTERVAL_OPTIONS
} from '@shared/constants'
import type {
  AppSettings,
  ChatGptAuthSource,
  DataSourceMode,
  HostPlatform,
  ImportSessionResult,
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
  chatGptAuthSource: ChatGptAuthSource
  initialExpandChatGptConnect: boolean
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  onSelectMockScenario: (scenario: MockScenarioId) => void
  onOpenLogin: (providerId: ProviderId) => void
  onImportChatGptSession: (rawJson: string) => Promise<ImportSessionResult>
  onOpenChatGptSessionPage: () => void
  onDetectCodexCli: () => void
  onDisconnect: (providerId: ProviderId) => void
  onConnectSuccess: () => void
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

function getAuthSourceLabel(source: ChatGptAuthSource): string {
  switch (source) {
    case 'codex_cli':
      return 'Codex CLI 자동 연동 (~/.codex/auth.json)'
    case 'imported_session':
      return '브라우저 세션 연동됨 (로컬 키체인 암호화)'
    case 'browser_partition':
      return '앱 내 이메일 로그인 세션'
    default:
      return '미연결'
  }
}

export function SettingsView({
  settings,
  usages,
  platform,
  chatGptAuthSource,
  initialExpandChatGptConnect,
  onUpdateSettings,
  onSelectMockScenario,
  onOpenLogin,
  onImportChatGptSession,
  onOpenChatGptSessionPage,
  onDetectCodexCli,
  onDisconnect,
  onConnectSuccess
}: SettingsViewProps) {
  const [showChatGptConnect, setShowChatGptConnect] = useState(initialExpandChatGptConnect)
  const [sessionInput, setSessionInput] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (initialExpandChatGptConnect) {
      setShowChatGptConnect(true)
    }
  }, [initialExpandChatGptConnect])

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

  const handleImportSubmit = async (): Promise<void> => {
    setImportError(null)
    setIsSubmitting(true)
    try {
      const result = await onImportChatGptSession(sessionInput)
      if (!result.ok) {
        setImportError(result.error ?? '세션 연결에 실패했습니다.')
        return
      }
      setSessionInput('')
      setShowChatGptConnect(false)
      onConnectSuccess()
    } finally {
      setIsSubmitting(false)
    }
  }

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
            const isLiveChatGpt = settings.dataSourceMode === 'live' && id === 'chatgpt'

            const subLabel = !enabled
              ? '숨김'
              : isPhase3Pending
                ? 'Phase 3 예정'
                : isLiveChatGpt
                  ? isConnected
                    ? chatGptAuthSource === 'codex_cli'
                      ? 'Codex CLI 자동 연동'
                      : chatGptAuthSource === 'imported_session'
                        ? '브라우저 세션 연동됨'
                        : '연동됨'
                    : '연결 필요'
                  : isConnected
                    ? '연동됨'
                    : '로그인 필요'

            return (
              <div key={id} className="flex flex-col gap-1.5">
                <div
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
                        {isLiveChatGpt ? (
                          <button
                            id="btn-toggle-chatgpt-connect"
                            type="button"
                            onClick={() => setShowChatGptConnect((prev) => !prev)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors cursor-pointer"
                            style={{
                              backgroundColor: showChatGptConnect
                                ? 'var(--text-primary)'
                                : 'var(--surface-card)',
                              color: showChatGptConnect
                                ? 'var(--surface-shell)'
                                : 'var(--text-primary)',
                              border: '1px solid var(--border-hairline)'
                            }}
                          >
                            <KeyRound className="h-3 w-3" />
                            {isConnected ? '세션 관리' : '연결'}
                          </button>
                        ) : (
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
                        )}

                        {(isConnected || (isLiveChatGpt && chatGptAuthSource !== 'none')) && (
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

                {/* Inline ChatGPT dual connection panel (Codex CLI auto-detect + Browser session paste) */}
                {isLiveChatGpt && enabled && showChatGptConnect && (
                  <div
                    id="panel-chatgpt-connect"
                    className="flex flex-col gap-2 rounded-lg p-2.5"
                    style={{
                      backgroundColor: 'var(--surface-shell)',
                      border: '1px solid var(--border-hairline)'
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 text-[10.5px]">
                      <span style={{ color: 'var(--text-secondary)' }}>현재 연결 방식</span>
                      <span
                        className="truncate font-medium"
                        style={{
                          color:
                            chatGptAuthSource !== 'none'
                              ? 'var(--energy-high-text)'
                              : 'var(--text-muted)'
                        }}
                      >
                        {getAuthSourceLabel(chatGptAuthSource)}
                      </span>
                    </div>

                    <div
                      className="flex flex-col gap-1.5 pt-2"
                      style={{ borderTop: '1px solid var(--border-hairline)' }}
                    >
                      <div className="text-[11px] font-semibold">
                        방법 1. 브라우저 세션 붙여넣기 (Google 로그인 계정 권장)
                      </div>
                      <button
                        id="btn-open-chatgpt-session-url"
                        type="button"
                        onClick={onOpenChatGptSessionPage}
                        className="flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-hairline)'
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                        1. 기본 브라우저에서 세션 열기
                      </button>

                      <textarea
                        id="input-chatgpt-session-json"
                        rows={3}
                        value={sessionInput}
                        onChange={(e) => {
                          setSessionInput(e.target.value)
                          if (importError) setImportError(null)
                        }}
                        placeholder='2. 열린 페이지 전체 복사(Cmd+A, Cmd+C) 후 여기에 붙여넣기(Cmd+V)'
                        className="w-full resize-none rounded-md p-2 text-[10.5px] leading-relaxed outline-none"
                        style={{
                          backgroundColor: 'var(--surface-card)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-strong)'
                        }}
                      />

                      {importError && (
                        <p
                          className="text-[10.5px] leading-snug"
                          style={{ color: 'var(--energy-low-text)' }}
                        >
                          {importError}
                        </p>
                      )}

                      <button
                        id="btn-submit-chatgpt-session"
                        type="button"
                        disabled={isSubmitting || !sessionInput.trim()}
                        onClick={() => void handleImportSubmit()}
                        className="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                        style={{
                          backgroundColor: 'var(--text-primary)',
                          color: 'var(--surface-shell)'
                        }}
                      >
                        {isSubmitting ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        {isSubmitting ? '연결 확인 중...' : '세션 연결 (로컬 암호화 저장)'}
                      </button>
                    </div>

                    <div
                      className="flex flex-col gap-1.5 pt-2"
                      style={{ borderTop: '1px solid var(--border-hairline)' }}
                    >
                      <div className="text-[11px] font-semibold">
                        방법 2. Codex CLI 자동 연동 / 이메일 직접 로그인
                      </div>
                      <p
                        className="text-[10px] leading-snug"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        터미널에서 <code className="font-mono">codex login</code>을 실행해 두면{' '}
                        <code className="font-mono">~/.codex/auth.json</code>을 자동 인식합니다.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          id="btn-detect-codex-cli"
                          type="button"
                          onClick={onDetectCodexCli}
                          className="flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-medium cursor-pointer"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          <Terminal className="h-3 w-3" />
                          Codex 세션 감지
                        </button>
                        <button
                          id="btn-login-chatgpt"
                          type="button"
                          onClick={() => onOpenLogin('chatgpt')}
                          className="flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-medium cursor-pointer"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          <LogIn className="h-3 w-3" />
                          이메일 로그인 창
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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
