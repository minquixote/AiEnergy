import { describe, expect, it } from 'vitest'
import {
  formatTrayTooltip,
  renderBatteryIconPng,
  renderMultiProviderTrayPng,
  renderWindowsSquareTrayPng
} from './trayIcon'

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

describe('trayIcon PNG generator', () => {
  it('renders valid 1x and 2x compact single battery PNG buffers', () => {
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

    expect(png1x.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(png1x.readUInt32BE(16)).toBe(24)
    expect(png1x.readUInt32BE(20)).toBe(16)

    expect(png2x.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(png2x.readUInt32BE(16)).toBe(48)
    expect(png2x.readUInt32BE(20)).toBe(32)
  })

  it('renders true-square 16x16, 24x24, and 32x32 Windows system tray PNGs', () => {
    const items = [
      { id: 'chatgpt' as const, status: 'ok' as const, remainingPct: 5, level: 'low' as const, badgeKind: 'percentage' as const },
      { id: 'gemini' as const, status: 'ok' as const, remainingPct: 100, level: 'high' as const, badgeKind: 'percentage' as const },
      { id: 'claude' as const, status: 'auth_required' as const, remainingPct: null, level: 'unknown' as const, badgeKind: 'unavailable' as const }
    ]

    const png1x = renderWindowsSquareTrayPng({ items, isDarkTheme: true, scale: 1 })
    const png15x = renderWindowsSquareTrayPng({ items, isDarkTheme: true, scale: 1.5 })
    const png2x = renderWindowsSquareTrayPng({ items, isDarkTheme: false, scale: 2 })

    expect(png1x.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(png1x.readUInt32BE(16)).toBe(16)
    expect(png1x.readUInt32BE(20)).toBe(16)

    expect(png15x.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(png15x.readUInt32BE(16)).toBe(24)
    expect(png15x.readUInt32BE(20)).toBe(24)

    expect(png2x.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(png2x.readUInt32BE(16)).toBe(32)
    expect(png2x.readUInt32BE(20)).toBe(32)
  })

  it('renders multi-provider menu bar strip scaling width with enabled platform count', () => {
    const twoProviders = renderMultiProviderTrayPng({
      items: [
        { id: 'chatgpt', status: 'ok', remainingPct: 72, level: 'high' },
        { id: 'gemini', status: 'ok', remainingPct: 38, level: 'medium' }
      ],
      showPercentage: true,
      isDarkTheme: true,
      scale: 2
    })

    const threeProviders = renderMultiProviderTrayPng({
      items: [
        { id: 'chatgpt', status: 'ok', remainingPct: 100, level: 'high' },
        { id: 'gemini', status: 'ok', remainingPct: 38, level: 'medium' },
        { id: 'claude', status: 'ok', remainingPct: 14, level: 'low' }
      ],
      showPercentage: true,
      isDarkTheme: false,
      scale: 2
    })

    const barsOnly = renderMultiProviderTrayPng({
      items: [
        { id: 'chatgpt', status: 'ok', remainingPct: 72, level: 'high' },
        { id: 'gemini', status: 'ok', remainingPct: 38, level: 'medium' }
      ],
      showPercentage: false,
      isDarkTheme: true,
      scale: 2
    })

    expect(twoProviders.png.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(twoProviders.png.readUInt32BE(16)).toBe(twoProviders.pixelWidth)
    expect(twoProviders.png.readUInt32BE(20)).toBe(twoProviders.pixelHeight)
    expect(twoProviders.logicalHeight).toBe(20)
    expect(twoProviders.pixelHeight).toBe(40)

    expect(threeProviders.logicalWidth).toBeGreaterThan(twoProviders.logicalWidth)
    expect(barsOnly.logicalWidth).toBeLessThan(twoProviders.logicalWidth)
  })

  it('falls back to a single compact icon when no providers are enabled', () => {
    const empty = renderMultiProviderTrayPng({
      items: [],
      showPercentage: true,
      isDarkTheme: true,
      scale: 2
    })
    expect(empty.png.subarray(0, 8).equals(PNG_SIG)).toBe(true)
    expect(empty.logicalWidth).toBe(24)
    expect(empty.logicalHeight).toBe(16)
  })

  it('formats multi-provider hover tooltip cleanly including N/A items', () => {
    const names = { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }
    expect(
      formatTrayTooltip(
        'AI Energy Bar',
        [
          { id: 'chatgpt', status: 'ok', remainingPct: 72, level: 'high', badgeKind: 'percentage' },
          { id: 'gemini', status: 'auth_required', remainingPct: null, level: 'unknown', badgeKind: 'alert' },
          { id: 'claude', status: 'auth_required', remainingPct: null, level: 'unknown', badgeKind: 'unavailable' }
        ],
        names
      )
    ).toBe('AI Energy Bar · ChatGPT 72% · Gemini 재로그인 필요 · Claude N/A')

    expect(formatTrayTooltip('AI Energy Bar', [], names)).toBe('AI Energy Bar · 활성 플랫폼 없음')
  })
})
