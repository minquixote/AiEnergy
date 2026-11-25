import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { PROVIDER_META } from '@shared/constants'
import type { AppSnapshot, EnergyLevel, TrayItemSummary } from '@shared/types'
import { ProviderIcon } from './components/ProviderIcon'
import { getEnergyBridge } from './lib/bridge'

const FILL_GRADIENT: Record<EnergyLevel, string> = {
  high: 'linear-gradient(180deg, rgba(34, 197, 94, 0.78), rgba(21, 160, 72, 0.68))',
  medium: 'linear-gradient(180deg, rgba(245, 158, 11, 0.80), rgba(217, 119, 6, 0.70))',
  low: 'linear-gradient(180deg, rgba(239, 68, 68, 0.84), rgba(220, 38, 38, 0.74))',
  unknown: 'linear-gradient(180deg, rgba(148, 163, 184, 0.45), rgba(100, 116, 139, 0.38))'
}

const DRAG_STYLE = { WebkitAppRegion: 'drag' } as CSSProperties
const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as CSSProperties

function FloatingBattery({
  item,
  showPercentage,
  isDark
}: {
  item: TrayItemSummary
  showPercentage: boolean
  isDark: boolean
}) {
  const pct =
    item.status === 'ok' && item.remainingPct !== null
      ? Math.max(0, Math.min(100, Math.round(item.remainingPct)))
      : null
  const isUnavailable =
    item.badgeKind === 'unavailable' ||
    (item.badgeKind === undefined && item.status === 'ok' && pct === null)

  const label = pct !== null ? `${pct}%` : isUnavailable ? 'N/A' : '!'

  const borderColor = isUnavailable
    ? isDark
      ? 'rgba(255, 255, 255, 0.56)'
      : 'rgba(24, 26, 31, 0.55)'
    : isDark
      ? 'rgba(255, 255, 255, 0.86)'
      : 'rgba(24, 26, 31, 0.84)'

  const trackBg = isUnavailable
    ? isDark
      ? 'rgba(12, 16, 24, 0.48)'
      : 'rgba(22, 27, 36, 0.54)'
    : isDark
      ? 'rgba(12, 16, 24, 0.66)'
      : 'rgba(18, 23, 32, 0.72)'

  const batteryW = showPercentage ? 41 : 22
  const batteryH = showPercentage ? 16 : 13
  const fillWidthPct = pct !== null && pct > 0 ? Math.max(8, pct) : 0

  return (
    <span className="inline-flex items-center">
      <span
        className="relative inline-flex items-center justify-center overflow-hidden"
        style={{
          width: `${batteryW}px`,
          height: `${batteryH}px`,
          borderRadius: showPercentage ? '4px' : '3px',
          border: `1.25px solid ${borderColor}`,
          backgroundColor: trackBg
        }}
      >
        {fillWidthPct > 0 && (
          <span
            className="absolute inset-y-0 left-0"
            style={{
              width: `${fillWidthPct}%`,
              background: FILL_GRADIENT[item.level]
            }}
          />
        )}
        {showPercentage && (
          <span
            className="relative z-10 font-bold leading-none tracking-[-0.02em] tabular-nums"
            style={{
              fontSize: label === 'N/A' ? '9.25px' : label.length >= 4 ? '9.75px' : '10.5px',
              color: isUnavailable ? 'rgba(255, 255, 255, 0.86)' : '#ffffff',
              textShadow: '0 0.5px 1.5px rgba(0, 0, 0, 0.58)'
            }}
          >
            {label}
          </span>
        )}
      </span>
      <span
        className="ml-[1px] inline-block"
        style={{
          width: '2px',
          height: showPercentage ? '6px' : '5px',
          borderRadius: '0.5px 1.2px 1.2px 0.5px',
          backgroundColor: borderColor
        }}
      />
    </span>
  )
}

export function FloatingBarApp() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const bridge = getEnergyBridge()
    let active = true

    void bridge.getSnapshot().then((initial) => {
      if (active) setSnapshot(initial)
    })

    const unsub = bridge.onSnapshotUpdated((next) => {
      if (active) setSnapshot(next)
    })

    return () => {
      active = false
      unsub()
    }
  }, [])

  useEffect(() => {
    const el = wrapperRef.current
    if (!snapshot || !el || typeof ResizeObserver === 'undefined') return

    const syncSize = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        void getEnergyBridge().resizeFloatingBar(Math.ceil(rect.width), Math.ceil(rect.height))
      }
    }

    syncSize()
    const observer = new ResizeObserver(syncSize)
    observer.observe(el)
    return () => observer.disconnect()
  }, [snapshot])

  const pref = snapshot?.settings.theme ?? 'dark'
  const resolvedTheme =
    pref === 'system' ? (snapshot?.systemTheme ?? 'dark') : pref
  const isDark = resolvedTheme === 'dark'
  const items = snapshot?.traySummary.items ?? []
  const showPercentage = snapshot?.settings.showTrayPercentage ?? true

  return (
    <div ref={wrapperRef} className="inline-flex p-[1px]">
      <div
        onContextMenu={(e) => {
          e.preventDefault()
          void getEnergyBridge().openFloatingBarMenu()
        }}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] pl-1.5 pr-2.5 select-none whitespace-nowrap"
        style={{
          ...DRAG_STYLE,
          backgroundColor: isDark ? 'rgba(20, 23, 30, 0.94)' : 'rgba(248, 249, 252, 0.96)',
          border: isDark
            ? '1px solid rgba(255, 255, 255, 0.18)'
            : '1px solid rgba(15, 23, 42, 0.16)',
          color: isDark ? 'rgba(255, 255, 255, 0.96)' : 'rgba(20, 22, 26, 0.92)'
        }}
      >
        {/* Drag grip handle */}
        <span
          style={{
            ...DRAG_STYLE,
            color: isDark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(20, 22, 26, 0.38)'
          }}
          className="inline-flex h-full cursor-grab items-center pr-0.5 active:cursor-grabbing"
          title="드래그하여 미니 바 위치 이동"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {/* Clickable provider strip */}
        {items.length > 0 ? (
          <button
            id="btn-floating-bar-toggle"
            type="button"
            style={NO_DRAG_STYLE}
            onClick={() => void getEnergyBridge().togglePopoverFromFloatingBar()}
            className="inline-flex items-center gap-2 bg-transparent p-0 cursor-pointer"
            title="클릭하여 AI Energy Bar 열기 (우클릭으로 메뉴)"
          >
            {items.map((item) => {
              const isUnavailable =
                item.badgeKind === 'unavailable' ||
                (item.badgeKind === undefined && item.status === 'ok' && item.remainingPct === null)
              return (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1"
                  aria-label={PROVIDER_META[item.id].name}
                >
                  <span
                    className="inline-flex items-center justify-center"
                    style={{ opacity: isUnavailable ? 0.72 : 1 }}
                  >
                    <ProviderIcon id={item.id} className="h-[14px] w-[14px]" />
                  </span>
                  <FloatingBattery
                    item={item}
                    showPercentage={showPercentage}
                    isDark={isDark}
                  />
                </span>
              )
            })}
          </button>
        ) : (
          <button
            id="btn-floating-bar-toggle"
            type="button"
            style={NO_DRAG_STYLE}
            onClick={() => void getEnergyBridge().togglePopoverFromFloatingBar()}
            className="inline-flex items-center gap-1.5 bg-transparent px-1 text-[11px] font-semibold cursor-pointer"
            title="클릭하여 AI Energy Bar 열기"
          >
            <span>AI Energy</span>
          </button>
        )}
      </div>
    </div>
  )
}
