import { describe, expect, it } from 'vitest'
import { buildMockUsages } from '../main/providers/mock'
import {
  calculateRemainingPct,
  clampPercentage,
  computeTraySummary,
  formatCountdown,
  formatRelativeTime,
  formatResetTime,
  getCooldownRemainingMs,
  getEnergyLevel
} from './usage'

describe('energy level thresholds', () => {
  it('classifies 51% ~ 100% as high (green)', () => {
    expect(getEnergyLevel(51)).toBe('high')
    expect(getEnergyLevel(75)).toBe('high')
    expect(getEnergyLevel(100)).toBe('high')
  })

  it('classifies 21% ~ 50% as medium (amber/orange)', () => {
    expect(getEnergyLevel(21)).toBe('medium')
    expect(getEnergyLevel(35)).toBe('medium')
    expect(getEnergyLevel(50)).toBe('medium')
  })

  it('classifies 0% ~ 20% as low (red)', () => {
    expect(getEnergyLevel(0)).toBe('low')
    expect(getEnergyLevel(14)).toBe('low')
    expect(getEnergyLevel(20)).toBe('low')
  })

  it('classifies null or non-finite values as unknown', () => {
    expect(getEnergyLevel(null)).toBe('unknown')
    expect(getEnergyLevel(Number.NaN)).toBe('unknown')
  })
})

describe('percentage calculations', () => {
  it('calculates remaining percentage as 100 - used and clamps bounds', () => {
    expect(calculateRemainingPct(52)).toBe(48)
    expect(calculateRemainingPct(0)).toBe(100)
    expect(calculateRemainingPct(100)).toBe(0)
    expect(calculateRemainingPct(140)).toBe(0)
    expect(calculateRemainingPct(-10)).toBe(100)
    expect(clampPercentage(48.6)).toBe(49)
  })
})

describe('tray summary computation', () => {
  it('selects the lowest remaining percentage and lists only enabled providers in order', () => {
    const usages = buildMockUsages('balanced', 1_700_000_000_000)

    const allEnabled = computeTraySummary(usages, {
      chatgpt: true,
      gemini: true,
      claude: true
    })
    expect(allEnabled.lowestProviderId).toBe('claude')
    expect(allEnabled.lowestRemainingPct).toBe(14)
    expect(allEnabled.level).toBe('low')
    expect(allEnabled.connectedCount).toBe(3)
    expect(allEnabled.items.map((item) => [item.id, item.remainingPct])).toEqual([
      ['chatgpt', 72],
      ['gemini', 38],
      ['claude', 14]
    ])

    // When unsubscribed Claude is hidden, only ChatGPT + Gemini appear in tray items and Gemini (38%) is lowest
    const withoutClaude = computeTraySummary(usages, {
      chatgpt: true,
      gemini: true,
      claude: false
    })
    expect(withoutClaude.lowestProviderId).toBe('gemini')
    expect(withoutClaude.lowestRemainingPct).toBe(38)
    expect(withoutClaude.level).toBe('medium')
    expect(withoutClaude.connectedCount).toBe(2)
    expect(withoutClaude.enabledCount).toBe(2)
    expect(withoutClaude.items.map((item) => item.id)).toEqual(['chatgpt', 'gemini'])
  })

  it('ignores auth_required and error providers when picking the lowest percentage', () => {
    const usages = buildMockUsages('auth_issue', 1_700_000_000_000)
    const summary = computeTraySummary(usages, {
      chatgpt: true,
      gemini: true,
      claude: true
    })

    expect(summary.lowestProviderId).toBe('chatgpt')
    expect(summary.lowestRemainingPct).toBe(61)
    expect(summary.level).toBe('high')
    expect(summary.connectedCount).toBe(1)
    expect(summary.items.map((item) => [item.id, item.status])).toEqual([
      ['chatgpt', 'ok'],
      ['gemini', 'auth_required'],
      ['claude', 'error']
    ])
  })

  it('marks unconnected live providers and quota-less free plans as unavailable (N/A) while keeping expired sessions as alert (!)', () => {
    const base = buildMockUsages('auth_issue', 1_700_000_000_000)
    const usages = {
      ...base,
      claude: {
        ...base.claude,
        status: 'auth_required' as const
      }
    }

    const liveSummary = computeTraySummary(
      usages,
      { chatgpt: true, gemini: true, claude: true },
      {
        dataSourceMode: 'live',
        authSources: {
          chatgpt: 'imported_session',
          gemini: 'imported_cookie', // previously connected -> expired should alert (!)
          claude: 'none' // unsubscribed/never linked -> calm N/A
        }
      }
    )

    expect(liveSummary.items.map((item) => [item.id, item.badgeKind])).toEqual([
      ['chatgpt', 'percentage'],
      ['gemini', 'alert'],
      ['claude', 'unavailable']
    ])

    // Connected Claude Free account (status ok, sessionRemainingPct null) -> unavailable (N/A)
    const freeSummary = computeTraySummary(
      {
        ...usages,
        claude: {
          id: 'claude',
          status: 'ok',
          sessionRemainingPct: null,
          sessionResetAt: null,
          weeklyRemainingPct: null,
          weeklyResetAt: null,
          planName: 'Free',
          updatedAt: 1_700_000_000_000
        }
      },
      { chatgpt: true, gemini: true, claude: true },
      {
        dataSourceMode: 'live',
        authSources: {
          chatgpt: 'imported_session',
          gemini: 'imported_cookie',
          claude: 'imported_cookie'
        }
      }
    )

    expect(freeSummary.items.find((i) => i.id === 'claude')?.badgeKind).toBe('unavailable')
  })
})

describe('time, countdown, and cooldown formatters', () => {
  it('formats relative update times in Korean', () => {
    const base = 1_700_000_000_000
    expect(formatRelativeTime(null, base)).toBe('업데이트 기록 없음')
    expect(formatRelativeTime(base - 15_000, base)).toBe('방금 업데이트됨')
    expect(formatRelativeTime(base - 5 * 60_000, base)).toBe('5분 전')
    expect(formatRelativeTime(base - 2 * 3_600_000, base)).toBe('2시간 전')
  })

  it('formats ISO and raw reset times safely', () => {
    expect(formatResetTime('오전 12:18', false)).toBe('오전 12:18 초기화')
    expect(formatResetTime('오전 12:18 초기화', false)).toBe('오전 12:18 초기화')

    const localIso = new Date(2026, 11, 1, 20, 18).toISOString()
    expect(formatResetTime(localIso, false)).toBe('오후 8:18 초기화')
    expect(formatResetTime(localIso, true)).toBe('12/1 오후 8:18 초기화')
  })

  it('formats countdowns accurately', () => {
    const now = 1_700_000_000_000
    expect(formatCountdown(new Date(now - 1000).toISOString(), now)).toBe('곧 초기화')
    expect(formatCountdown(new Date(now + 42_000).toISOString(), now)).toBe('42초 후')
    expect(formatCountdown(new Date(now + 41 * 60_000).toISOString(), now)).toBe('41분 후')
    expect(formatCountdown(new Date(now + 155 * 60_000).toISOString(), now)).toBe('2시간 35분 후')
  })

  it('computes manual refresh cooldown remaining cleanly', () => {
    expect(getCooldownRemainingMs(1_030_000, 1_000_000)).toBe(30_000)
    expect(getCooldownRemainingMs(1_000_000, 1_005_000)).toBe(0)
  })
})
