import { useEffect, useRef, useState } from 'react'
import { Power } from 'lucide-react'
import { PROVIDER_META, PROVIDER_ORDER } from '@shared/constants'
import type { EnergyLevel } from '@shared/types'
import { Header } from './components/Header'
import { ProviderCard } from './components/ProviderCard'
import { SettingsView } from './components/SettingsView'
import { useEnergyApp } from './hooks/useEnergyApp'
import { getEnergyBridge } from './lib/bridge'

const SUMMARY_DOT_COLOR: Record<EnergyLevel, string> = {
  high: 'var(--energy-high)',
  medium: 'var(--energy-medium)',
  low: 'var(--energy-low)',
  unknown: 'var(--energy-unknown)'
}

export function App() {
  const [view, setView] = useState<'main' | 'settings'>('main')
  const shellRef = useRef<HTMLDivElement | null>(null)
  const {
    snapshot,
    now,
    toastMessage,
    refreshNow,
    updateSettings,
    setMockScenario,
    openProviderLogin,
    disconnectProvider,
    quitApp
  } = useEnergyApp()

  // Keep Electron popover window height tightly matched to rendered content
  useEffect(() => {
    const el = shellRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const syncHeight = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.height > 0) {
        void getEnergyBridge().resizePopover(Math.ceil(rect.height))
      }
    }

    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [view, snapshot])

  if (!snapshot) {
    return (
      <div ref={shellRef} className="popover-shell p-4 text-center text-[12px]">
        <span style={{ color: 'var(--text-secondary)' }}>불러오는 중...</span>
      </div>
    )
  }

  const enabledIds = PROVIDER_ORDER.filter((id) => snapshot.settings.enabledProviders[id])
  const hiddenCount = PROVIDER_ORDER.length - enabledIds.length
  const { traySummary } = snapshot

  return (
    <div ref={shellRef} className="popover-shell flex flex-col">
      <Header
        view={view}
        lastUpdatedAt={snapshot.lastUpdatedAt}
        cooldownUntil={snapshot.cooldownUntil}
        isRefreshing={snapshot.isRefreshing}
        dataSourceMode={snapshot.settings.dataSourceMode}
        now={now}
        onRefresh={() => void refreshNow()}
        onToggleView={() => setView((prev) => (prev === 'main' ? 'settings' : 'main'))}
      />

      {toastMessage && (
        <div
          role="status"
          className="mx-3 mt-2.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-hairline)'
          }}
        >
          {toastMessage}
        </div>
      )}

      {view === 'main' ? (
        <main className="flex flex-col gap-2.5 p-3">
          {enabledIds.length > 0 ? (
            enabledIds.map((id) => (
              <ProviderCard
                key={id}
                usage={snapshot.usages[id]}
                now={now}
                onOpenLogin={(providerId) => void openProviderLogin(providerId)}
              />
            ))
          ) : (
            <div className="surface-card p-5 text-center">
              <p className="text-[12px] font-medium">표시 중인 플랫폼이 없습니다.</p>
              <button
                type="button"
                onClick={() => setView('settings')}
                className="mt-2.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium cursor-pointer"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                설정에서 플랫폼 켜기
              </button>
            </div>
          )}
        </main>
      ) : (
        <SettingsView
          settings={snapshot.settings}
          usages={snapshot.usages}
          platform={snapshot.platform}
          onUpdateSettings={(patch) => void updateSettings(patch)}
          onSelectMockScenario={(scenario) => void setMockScenario(scenario)}
          onOpenLogin={(providerId) => void openProviderLogin(providerId)}
          onDisconnect={(providerId) => void disconnectProvider(providerId)}
        />
      )}

      <footer
        className="flex items-center justify-between px-3.5 py-2 text-[11px]"
        style={{
          borderTop: '1px solid var(--border-hairline)',
          color: 'var(--text-secondary)'
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 tabular-nums">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: SUMMARY_DOT_COLOR[traySummary.level] }}
          />
          {traySummary.lowestRemainingPct !== null && traySummary.lowestProviderId !== null ? (
            <span className="truncate">
              최저 {PROVIDER_META[traySummary.lowestProviderId].name}{' '}
              <strong style={{ color: 'var(--text-primary)' }}>
                {traySummary.lowestRemainingPct}%
              </strong>
            </span>
          ) : (
            <span className="truncate">연동된 플랫폼 없음</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {view === 'main' && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setView('settings')}
              className="text-[10.5px] hover:underline cursor-pointer"
              style={{ color: 'var(--text-muted)' }}
            >
              +{hiddenCount} 숨김
            </button>
          )}

          <button
            id="btn-quit-app"
            type="button"
            onClick={() => void quitApp()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] transition-colors cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            title="AI Energy Bar 종료"
          >
            <Power className="h-3 w-3" />
            종료
          </button>
        </div>
      </footer>
    </div>
  )
}
