import { useCallback, useEffect, useState } from 'react'
import { PROVIDER_META } from '@shared/constants'
import type {
  AppSettings,
  AppSnapshot,
  DebugLogEntry,
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
  importProviderSession: (providerId: ProviderId, rawInput: string) => Promise<ImportSessionResult>
  openExternalProviderPage: (providerId: ProviderId) => Promise<void>
  disconnectProvider: (providerId: ProviderId) => Promise<void>
  getDebugLogs: () => Promise<DebugLogEntry[]>
  clearDebugLogs: () => Promise<DebugLogEntry[]>
  copyDebugLogs: () => Promise<boolean>
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

  const importProviderSession = useCallback(
    async (providerId: ProviderId, rawInput: string): Promise<ImportSessionResult> => {
      const result = await getEnergyBridge().importProviderSession(providerId, rawInput)
      setSnapshot(result.snapshot)
      if (result.ok) {
        showToast(`${PROVIDER_META[providerId].name} 연결이 완료되었습니다.`)
      }
      return result
    },
    [showToast]
  )

  const openExternalProviderPage = useCallback(
    async (providerId: ProviderId) => {
      await getEnergyBridge().openExternalProviderPage(providerId)
      const isWin = snapshot?.platform === 'win32'
      const devToolsKey = isWin ? 'F12' : '⌥⌘I'
      const hint =
        providerId === 'chatgpt'
          ? '열린 세션 페이지 전체를 복사해 붙여넣어 주세요.'
          : providerId === 'gemini'
            ? `개발자 도구(${devToolsKey}) Network에서 executeQuery → Copy as cURL을 복사해 붙여넣어 주세요.`
            : '개발자 도구에서 sessionKey 또는 Copy as cURL을 복사해 붙여넣어 주세요.'
      showToast(hint)
    },
    [showToast, snapshot?.platform]
  )

  const disconnectProvider = useCallback(
    async (providerId: ProviderId) => {
      const next = await getEnergyBridge().disconnectProvider(providerId)
      setSnapshot(next)
      showToast(`${PROVIDER_META[providerId].name} 로컬 세션을 초기화했습니다.`)
    },
    [showToast]
  )

  const getDebugLogs = useCallback(async (): Promise<DebugLogEntry[]> => {
    return getEnergyBridge().getDebugLogs()
  }, [])

  const clearDebugLogs = useCallback(async (): Promise<DebugLogEntry[]> => {
    const next = await getEnergyBridge().clearDebugLogs()
    showToast('디버그 로그를 비웠습니다.')
    return next
  }, [showToast])

  const copyDebugLogs = useCallback(async (): Promise<boolean> => {
    const ok = await getEnergyBridge().copyDebugLogs()
    if (ok) {
      showToast('진단 로그를 클립보드에 복사했습니다 (민감 정보 마스킹됨).')
    }
    return ok
  }, [showToast])

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
    importProviderSession,
    openExternalProviderPage,
    disconnectProvider,
    getDebugLogs,
    clearDebugLogs,
    copyDebugLogs,
    quitApp
  }
}
