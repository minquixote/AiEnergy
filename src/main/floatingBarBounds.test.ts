import { describe, expect, it } from 'vitest'
import {
  FLOATING_BAR_DEFAULTS,
  clampFloatingBarPosition,
  getDefaultFloatingBarPosition,
  isFloatingBarVisibleOnWorkAreas
} from './floatingBarBounds'

describe('floatingBarBounds', () => {
  const win11Primary = { x: 0, y: 0, width: 1920, height: 1032 }
  const leftMonitor = { x: -1920, y: 0, width: 1920, height: 1040 }

  it('places default floating bar in bottom-right above the Windows taskbar', () => {
    const pos = getDefaultFloatingBarPosition(
      FLOATING_BAR_DEFAULTS.WIDTH,
      FLOATING_BAR_DEFAULTS.HEIGHT,
      win11Primary
    )
    expect(pos).toEqual({
      x: 1920 - FLOATING_BAR_DEFAULTS.WIDTH - FLOATING_BAR_DEFAULTS.EDGE_MARGIN,
      y: 1032 - FLOATING_BAR_DEFAULTS.HEIGHT - FLOATING_BAR_DEFAULTS.EDGE_MARGIN
    })
  })

  it('clamps out-of-bounds coordinates cleanly inside workArea', () => {
    expect(clampFloatingBarPosition({ x: -500, y: -100 }, 240, 36, win11Primary)).toEqual({
      x: 4,
      y: 4
    })
    expect(clampFloatingBarPosition({ x: 3000, y: 2000 }, 240, 36, win11Primary)).toEqual({
      x: 1920 - 240 - 4,
      y: 1032 - 36 - 4
    })
  })

  it('accepts valid positions on connected secondary monitors including negative X coordinates', () => {
    const posOnLeft = { x: -400, y: 950 }
    expect(
      isFloatingBarVisibleOnWorkAreas(posOnLeft, 240, 36, [win11Primary, leftMonitor])
    ).toBe(true)
  })

  it('rejects stale positions from disconnected external monitors so auto-rescue triggers', () => {
    const staleRightMonitor = { x: 2400, y: 980 }
    expect(isFloatingBarVisibleOnWorkAreas(staleRightMonitor, 240, 36, [win11Primary])).toBe(false)

    const staleNegativeLeftMonitor = { x: -400, y: 950 }
    expect(
      isFloatingBarVisibleOnWorkAreas(staleNegativeLeftMonitor, 240, 36, [win11Primary])
    ).toBe(false)
  })

  it('requires at least 50% visible area inside a display workArea', () => {
    // Only 60px of a 240px bar is on-screen (25% < 50%)
    expect(isFloatingBarVisibleOnWorkAreas({ x: 1860, y: 980 }, 240, 36, [win11Primary])).toBe(
      false
    )
    // 160px of a 240px bar is on-screen (66.7% >= 50%)
    expect(isFloatingBarVisibleOnWorkAreas({ x: 1760, y: 980 }, 240, 36, [win11Primary])).toBe(true)
  })
})
