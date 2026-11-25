import { describe, expect, it } from 'vitest'
import {
  FLOATING_BAR_DEFAULTS,
  clampFloatingBarPosition,
  getDefaultFloatingBarPosition,
  isFloatingBarOverlappingTaskbar,
  isFloatingBarVisibleOnWorkAreas
} from './floatingBarBounds'

describe('floatingBarBounds', () => {
  const win11WorkArea = { x: 0, y: 0, width: 2560, height: 1392 }
  const win11FullBounds = { x: 0, y: 0, width: 2560, height: 1440 }
  const leftMonitorBounds = { x: -1920, y: 0, width: 1920, height: 1080 }

  it('places default floating bar in bottom-right above the Windows taskbar', () => {
    const pos = getDefaultFloatingBarPosition(
      FLOATING_BAR_DEFAULTS.WIDTH,
      FLOATING_BAR_DEFAULTS.HEIGHT,
      win11WorkArea
    )
    expect(pos).toEqual({
      x: 2560 - FLOATING_BAR_DEFAULTS.WIDTH - FLOATING_BAR_DEFAULTS.EDGE_MARGIN,
      y: 1392 - FLOATING_BAR_DEFAULTS.HEIGHT - FLOATING_BAR_DEFAULTS.EDGE_MARGIN
    })
  })

  it('clamps out-of-bounds coordinates cleanly inside full display bounds including taskbar', () => {
    expect(clampFloatingBarPosition({ x: -500, y: -100 }, 244, 36, win11FullBounds, 0)).toEqual({
      x: 0,
      y: 0
    })
    // Docked onto the Windows 11 taskbar at y=1398 stays preserved without getting pushed back up
    expect(clampFloatingBarPosition({ x: 2050, y: 1398 }, 244, 36, win11FullBounds, 0)).toEqual({
      x: 2050,
      y: 1398
    })
    expect(clampFloatingBarPosition({ x: 3000, y: 2000 }, 244, 36, win11FullBounds, 0)).toEqual({
      x: 2560 - 244,
      y: 1440 - 36
    })
  })

  it('accepts taskbar-docked positions and secondary monitors including negative X coordinates', () => {
    // Docked on bottom taskbar of primary display (y=1398 inside 1440px screen)
    expect(
      isFloatingBarVisibleOnWorkAreas({ x: 2050, y: 1398 }, 244, 36, [win11FullBounds])
    ).toBe(true)

    const posOnLeft = { x: -400, y: 950 }
    expect(
      isFloatingBarVisibleOnWorkAreas(posOnLeft, 244, 36, [win11FullBounds, leftMonitorBounds])
    ).toBe(true)
  })

  it('rejects stale positions from disconnected external monitors so auto-rescue triggers', () => {
    const staleRightMonitor = { x: 2800, y: 980 }
    expect(isFloatingBarVisibleOnWorkAreas(staleRightMonitor, 244, 36, [win11FullBounds])).toBe(
      false
    )

    const staleNegativeLeftMonitor = { x: -400, y: 950 }
    expect(
      isFloatingBarVisibleOnWorkAreas(staleNegativeLeftMonitor, 244, 36, [win11FullBounds])
    ).toBe(false)
  })

  it('requires at least 50% visible area inside display bounds', () => {
    // Only 60px of a 244px bar is on-screen (< 50%)
    expect(isFloatingBarVisibleOnWorkAreas({ x: 2500, y: 980 }, 244, 36, [win11FullBounds])).toBe(
      false
    )
    // 160px of a 244px bar is on-screen (>= 50%)
    expect(isFloatingBarVisibleOnWorkAreas({ x: 2400, y: 980 }, 244, 36, [win11FullBounds])).toBe(
      true
    )
  })

  it('detects when floating bar overlaps the Windows taskbar strip', () => {
    // Sitting safely above taskbar in workArea
    expect(
      isFloatingBarOverlappingTaskbar(
        { x: 2300, y: 1340, width: 244, height: 36 },
        win11FullBounds,
        win11WorkArea
      )
    ).toBe(false)

    // Dragged onto the Windows 11 bottom taskbar (y=1398..1434 > workArea bottom 1392)
    expect(
      isFloatingBarOverlappingTaskbar(
        { x: 2050, y: 1398, width: 244, height: 36 },
        win11FullBounds,
        win11WorkArea
      )
    ).toBe(true)

    // Partially crossing into bottom taskbar
    expect(
      isFloatingBarOverlappingTaskbar(
        { x: 2050, y: 1380, width: 244, height: 36 },
        win11FullBounds,
        win11WorkArea
      )
    ).toBe(true)
  })
})
