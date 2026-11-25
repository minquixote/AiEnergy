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
  area: Rect,
  inset: number = FLOATING_BAR_DEFAULTS.CLAMP_INSET
): FloatingBarPosition {
  const minX = area.x + inset
  const maxX = Math.max(minX, area.x + area.width - width - inset)
  const minY = area.y + inset
  const maxY = Math.max(minY, area.y + area.height - height - inset)

  return {
    x: Math.round(Math.max(minX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(minY, Math.min(maxY, pos.y)))
  }
}

/**
 * Checks whether a persisted floating bar rect still overlaps meaningfully (>= 50% of its area)
 * with at least one connected display's full bounds (including taskbar strips so users can dock
 * the floating bar directly onto the Windows 11 taskbar and keep that position across restarts).
 */
export function isFloatingBarVisibleOnWorkAreas(
  pos: FloatingBarPosition,
  width: number,
  height: number,
  areas: readonly Rect[]
): boolean {
  const barArea = Math.max(1, width * height)
  const right = pos.x + width
  const bottom = pos.y + height

  for (const area of areas) {
    const overlapW = Math.max(0, Math.min(right, area.x + area.width) - Math.max(pos.x, area.x))
    const overlapH = Math.max(0, Math.min(bottom, area.y + area.height) - Math.max(pos.y, area.y))
    if (overlapW * overlapH >= barArea * 0.5) {
      return true
    }
  }
  return false
}

/**
 * Returns true when the floating bar extends outside the display's `workArea` into the OS
 * taskbar/dock band (e.g., user dragged the pill onto the Windows 11 bottom taskbar).
 */
export function isFloatingBarOverlappingTaskbar(
  barBounds: Rect,
  displayBounds: Rect,
  displayWorkArea: Rect
): boolean {
  const barRight = barBounds.x + barBounds.width
  const barBottom = barBounds.y + barBounds.height
  const waRight = displayWorkArea.x + displayWorkArea.width
  const waBottom = displayWorkArea.y + displayWorkArea.height
  const dbRight = displayBounds.x + displayBounds.width
  const dbBottom = displayBounds.y + displayBounds.height

  const hasBottomTaskbar = dbBottom > waBottom
  if (hasBottomTaskbar && barBottom > waBottom) return true

  const hasTopTaskbar = displayWorkArea.y > displayBounds.y
  if (hasTopTaskbar && barBounds.y < displayWorkArea.y) return true

  const hasLeftTaskbar = displayWorkArea.x > displayBounds.x
  if (hasLeftTaskbar && barBounds.x < displayWorkArea.x) return true

  const hasRightTaskbar = dbRight > waRight
  if (hasRightTaskbar && barRight > waRight) return true

  return false
}
