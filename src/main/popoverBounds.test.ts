import { describe, expect, it } from 'vitest'
import { computePopoverBounds } from './popoverBounds'

describe('computePopoverBounds', () => {
  const macWorkArea = { x: 0, y: 25, width: 1512, height: 957 }

  it('anchors popover centered beneath macOS menu bar tray icon and clamps near right edge', () => {
    const centerTray = { x: 1100, y: 0, width: 52, height: 24 }
    const centered = computePopoverBounds(centerTray, macWorkArea, 340, 460, 'darwin')
    expect(centered.x).toBe(1100 + 26 - 170)
    expect(centered.y).toBe(31)

    // Near the right edge of screen
    const edgeTray = { x: 1460, y: 0, width: 40, height: 24 }
    const clamped = computePopoverBounds(edgeTray, macWorkArea, 340, 460, 'darwin')
    expect(clamped.x).toBe(1512 - 340 - 8)
    expect(clamped.y).toBe(31)
  })

  it('anchors popover above bottom Windows taskbar tray icon', () => {
    const winWorkArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const bottomTray = { x: 1750, y: 1040, width: 32, height: 40 }
    const bounds = computePopoverBounds(bottomTray, winWorkArea, 340, 460, 'win32')

    expect(bounds.x).toBe(1920 - 340 - 8)
    expect(bounds.y).toBe(1040 - 460 - 8)
  })

  it('handles notched macOS displays and left-side multi-monitor negative coordinates cleanly', () => {
    // MacBook Pro notch display: taller menu bar (workArea.y = 37)
    const notchedWorkArea = { x: 0, y: 37, width: 1512, height: 945 }
    const wideTray = { x: 980, y: 0, width: 210, height: 37 }
    const notchBounds = computePopoverBounds(wideTray, notchedWorkArea, 340, 480, 'darwin')
    expect(notchBounds.x).toBe(980 + 105 - 170)
    expect(notchBounds.y).toBe(37 + 6)

    // Secondary monitor placed to the left of primary (negative X coordinates)
    const leftMonitorWorkArea = { x: -1920, y: 25, width: 1920, height: 1055 }
    const leftEdgeTray = { x: -1910, y: 0, width: 140, height: 24 }
    const leftBounds = computePopoverBounds(leftEdgeTray, leftMonitorWorkArea, 340, 480, 'darwin')
    expect(leftBounds.x).toBe(-1920 + 8)
    expect(leftBounds.y).toBe(25 + 6)
  })
})
