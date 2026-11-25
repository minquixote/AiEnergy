import type { FloatingBarPosition } from '../shared/types'
import type { Rect } from './popoverBounds'

export const FLOATING_BAR_DEFAULTS = {
  WIDTH: 244,
  HEIGHT: 36,
  MIN_WIDTH: 68,
  MAX_WIDTH: 380,
  MIN_HEIGHT: 28,
  MAX_HEIGHT: 48,
  EDGE_MARGIN: 16,
  CLAMP_INSET: 4
} as const

export function getDefaultFloatingBarPosition(
  width: number,
  height: number,
  workArea: Rect
): FloatingBarPosition {
  const x = Math.round(workArea.x + workArea.width - width - FLOATING_BAR_DEFAULTS.EDGE_MARGIN)
  const y = Math.round(workArea.y + workArea.height - height - FLOATING_BAR_DEFAULTS.EDGE_MARGIN)
  return clampFloatingBarPosition({ x, y }, width, height, workArea)
}

export function clampFloatingBarPosition(
  pos: FloatingBarPosition,
  width: number,
  height: number,
  workArea: Rect
): FloatingBarPosition {
  const inset = FLOATING_BAR_DEFAULTS.CLAMP_INSET
  const minX = workArea.x + inset
  const maxX = Math.max(minX, workArea.x + workArea.width - width - inset)
  const minY = workArea.y + inset
  const maxY = Math.max(minY, workArea.y + workArea.height - height - inset)

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, pos.y)))
  }
}

/**
 * Checks whether a persisted floating bar rect still overlaps meaningfully (>= 50% of its area)
 * with at least one connected display's workArea. Prevents disconnected external monitors or
 * DPI-change artifacts from stranding the floating bar off-screen.
 */
export function isFloatingBarVisibleOnWorkAreas(
  pos: FloatingBarPosition,
  width: number,
  height: number,
  workAreas: readonly Rect[]
): boolean {
  const barArea = Math.max(1, width * height)
  const right = pos.x + width
  const bottom = pos.y + height

  for (const wa of workAreas) {
    const overlapW = Math.max(0, Math.min(right, wa.x + wa.width) - Math.max(pos.x, wa.x))
    const overlapH = Math.max(0, Math.min(bottom, wa.y + wa.height) - Math.max(pos.y, wa.y))
    if (overlapW * overlapH >= barArea * 0.5) {
      return true
    }
  }
  return false
}
