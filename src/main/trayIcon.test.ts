import { describe, expect, it } from 'vitest'
import { formatMacTrayTitle, renderBatteryIconPng } from './trayIcon'

describe('trayIcon PNG generator', () => {
  it('renders valid 1x and 2x Retina PNG buffers with exact dimensions', () => {
    const png1x = renderBatteryIconPng({
      percentage: 72,
      level: 'high',
      isDarkTheme: true,
      scale: 1
    })
    const png2x = renderBatteryIconPng({
      percentage: 14,
      level: 'low',
      isDarkTheme: false,
      scale: 2
    })

    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png1x.subarray(0, 8).equals(pngSig)).toBe(true)
    expect(png1x.readUInt32BE(16)).toBe(24)
    expect(png1x.readUInt32BE(20)).toBe(16)

    expect(png2x.subarray(0, 8).equals(pngSig)).toBe(true)
    expect(png2x.readUInt32BE(16)).toBe(48)
    expect(png2x.readUInt32BE(20)).toBe(32)
  })

  it('formats macOS menu bar percentage title according to toggle state', () => {
    const summary = {
      lowestRemainingPct: 38,
      lowestProviderId: 'gemini' as const,
      level: 'medium' as const,
      connectedCount: 2,
      enabledCount: 2
    }

    expect(formatMacTrayTitle(summary, true)).toBe(' 38%')
    expect(formatMacTrayTitle(summary, false)).toBe('')
    expect(
      formatMacTrayTitle(
        {
          lowestRemainingPct: null,
          lowestProviderId: null,
          level: 'unknown',
          connectedCount: 0,
          enabledCount: 2
        },
        true
      )
    ).toBe(' --%')
  })
})
