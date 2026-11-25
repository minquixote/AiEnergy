import { describe, expect, it } from 'vitest'
import type { ProviderUsage } from '../shared/types'
import { createInitialAlertState, evaluateAlertTransition } from './notifier'

function makeUsage(pct: number | null, status: ProviderUsage['status'] = 'ok'): ProviderUsage {
  return {
    id: 'gemini',
    status,
    sessionRemainingPct: pct,
    sessionResetAt: null,
    weeklyRemainingPct: null,
    weeklyResetAt: null,
    updatedAt: 1_780_000_000_000
  }
}

describe('evaluateAlertTransition', () => {
  const enabledOpts = { providerEnabled: true, notificationsEnabled: true }

  it('sets baseline on initial reading without firing noisy startup notifications', () => {
    const r100 = evaluateAlertTransition(createInitialAlertState(), makeUsage(100), enabledOpts)
    expect(r100.notification).toBeNull()
    expect(r100.nextState).toEqual({ lastPct: 100, lowAlertSent: false, resetAlertSent: true })

    const r15 = evaluateAlertTransition(createInitialAlertState(), makeUsage(15), enabledOpts)
    expect(r15.notification).toBeNull()
    expect(r15.nextState).toEqual({ lastPct: 15, lowAlertSent: true, resetAlertSent: false })
  })

  it('fires exactly once when crossing >20% -> <=20% and does not spam while staying <=20%', () => {
    const base = evaluateAlertTransition(createInitialAlertState(), makeUsage(35), enabledOpts)
    expect(base.notification).toBeNull()

    const dip = evaluateAlertTransition(base.nextState, makeUsage(20), enabledOpts)
    expect(dip.notification?.kind).toBe('low_threshold')
    expect(dip.notification?.title).toContain('Gemini')
    expect(dip.nextState.lowAlertSent).toBe(true)

    // Still low (12%) -> must NOT send a duplicate notification
    const stillLow = evaluateAlertTransition(dip.nextState, makeUsage(12), enabledOpts)
    expect(stillLow.notification).toBeNull()

    // Rises above 20% (50%) -> re-arms low trigger, no notification
    const mid = evaluateAlertTransition(stillLow.nextState, makeUsage(50), enabledOpts)
    expect(mid.notification).toBeNull()
    expect(mid.nextState.lowAlertSent).toBe(false)

    // Dips back to 18% -> fires once again
    const secondDip = evaluateAlertTransition(mid.nextState, makeUsage(18), enabledOpts)
    expect(secondDip.notification?.kind).toBe('low_threshold')
  })

  it('fires exactly once when recovering from <100% to 100%', () => {
    const base = evaluateAlertTransition(createInitialAlertState(), makeUsage(64), enabledOpts)
    const recovered = evaluateAlertTransition(base.nextState, makeUsage(100), enabledOpts)
    expect(recovered.notification?.kind).toBe('reset_recovered')
    expect(recovered.nextState.resetAlertSent).toBe(true)

    // Stays at 100% -> must NOT duplicate
    const stillFull = evaluateAlertTransition(recovered.nextState, makeUsage(100), enabledOpts)
    expect(stillFull.notification).toBeNull()
  })

  it('suppresses notifications when notificationsEnabled is false or provider is hidden', () => {
    const base = evaluateAlertTransition(createInitialAlertState(), makeUsage(40), enabledOpts)
    const silentDip = evaluateAlertTransition(base.nextState, makeUsage(15), {
      providerEnabled: true,
      notificationsEnabled: false
    })
    expect(silentDip.notification).toBeNull()
    expect(silentDip.nextState.lowAlertSent).toBe(true)

    const hiddenProvider = evaluateAlertTransition(base.nextState, makeUsage(10), {
      providerEnabled: false,
      notificationsEnabled: true
    })
    expect(hiddenProvider.notification).toBeNull()
    expect(hiddenProvider.nextState).toEqual(base.nextState)
  })
})
