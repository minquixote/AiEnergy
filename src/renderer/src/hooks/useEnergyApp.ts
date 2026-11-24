import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, AppSnapshot, MockScenarioId, ProviderId } from '@shared/types'
import { getEnergyBridge } from '../lib/bridge'

export interface UseEnergyAppState {
  snapshot: AppSnapshot | null
  now: number
  toastMessage: string | null
  refreshNow: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setMockScenario: (scenario: MockScenarioId) => Promise<void>
  openProviderLogin: (providerId: ProviderId) => Promise<void>
  disconnectProvider: (providerId: ProviderId) => Promise<void>
  quitApp: () => Promise<void>
}

export function useEnergyApp(): UseEnergyAppState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToastMessage(message)
  }, [])

  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 2600)
    return () => clearTimeout(timer)
  }, [toastMessage])

  useEffect(() => {
    const bridge = getEnergyBridge()
    let active = true

    void bridge.getSnapshot().then((initial) => {
      if (active) setSnapshot(initial)
    })

    const unsubscribe = bridge.onSnapshotUpdated((next) => {
      if (active) setSnapshot(next)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Local 1-second tick for cooldown badge, relative update time, and reset countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Sync resolved theme to root data-theme attribute
  useEffect(() => {
    if (!snapshot) return
    const pref = snapshot.settings.theme
    const resolved = pref === 'system' ? snapshot.systemTheme : pref
    document.documentElement.dataset.theme = resolved
  }, [snapshot])

  const refreshNow = useCallback(async () => {
    const result = await getEnergyBridge().refreshNow()
    setSnapshot(result.snapshot)
    if (!result.refreshed && result.cooldownRemainingMs > 0) {
      const sec = Math.ceil(result.cooldownRemainingMs / 1000)
      showToast(`잠시 후 다시 시도해 주세요 (${sec}초 남음)`)
    }
  }, [showToast])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await getEnergyBridge().updateSettings(patch)
    setSnapshot(next)
  }, [])

  const setMockScenario = useCallback(async (scenario: MockScenarioId) => {
    const next = await getEnergyBridge().setMockScenario(scenario)
    setSnapshot(next)
  }, [])

  const openProviderLogin = useCallback(
    async (providerId: ProviderId) => {
      const res = await getEnergyBridge().openProviderLogin(providerId)
      if (res.note) showToast(res.note)
    },
    [showToast]
  )

  const disconnectProvider = useCallback(
    async (providerId: ProviderId) => {
      const next = await getEnergyBridge().disconnectProvider(providerId)
      setSnapshot(next)
      showToast('로컬 세션을 초기화했습니다.')
    },
    [showToast]
  )

  const quitApp = useCallback(async () => {
    await getEnergyBridge().quitApp()
  }, [])

  return {
    snapshot,
    now,
    toastMessage,
    refreshNow,
    updateSettings,
    setMockScenario,
    openProviderLogin,
    disconnectProvider,
    quitApp
  }
}
