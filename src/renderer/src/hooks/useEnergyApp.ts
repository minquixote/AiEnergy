import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  AppSnapshot,
  ImportSessionResult,
  MockScenarioId,
  ProviderId
} from '@shared/types'
import { getEnergyBridge } from '../lib/bridge'

export interface UseEnergyAppState {
  snapshot: AppSnapshot | null
  now: number
  toastMessage: string | null
  refreshNow: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setMockScenario: (scenario: MockScenarioId) => Promise<void>
  openProviderLogin: (providerId: ProviderId) => Promise<void>
  importChatGptSession: (rawJson: string) => Promise<ImportSessionResult>
  openChatGptSessionPage: () => Promise<void>
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
    const timer = setTimeout(() => setToastMessage(null), 2800)
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

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

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

  const importChatGptSession = useCallback(
    async (rawJson: string): Promise<ImportSessionResult> => {
      const result = await getEnergyBridge().importChatGptSession(rawJson)
      setSnapshot(result.snapshot)
      if (result.ok) {
        showToast('ChatGPT 세션이 연결되었습니다.')
      }
      return result
    },
    [showToast]
  )

  const openChatGptSessionPage = useCallback(async () => {
    await getEnergyBridge().openChatGptSessionPage()
    showToast('기본 브라우저에서 세션 페이지를 열었습니다. 전체 복사 후 붙여넣어 주세요.')
  }, [showToast])

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
    importChatGptSession,
    openChatGptSessionPage,
    disconnectProvider,
    quitApp
  }
}
