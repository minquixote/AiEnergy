import { Notification } from 'electron'
import { APP_NAME, ENERGY_THRESHOLDS, PROVIDER_META, PROVIDER_ORDER } from '../shared/constants'
import type { ProviderAlertState, ProviderId, ProviderUsage } from '../shared/types'
import { clampPercentage, formatResetTime } from '../shared/usage'

export type NotificationEventKind = 'low_threshold' | 'reset_recovered'

export interface NotificationDescriptor {
  providerId: ProviderId
  kind: NotificationEventKind
  title: string
  body: string
}

export interface AlertTransitionResult {
  nextState: ProviderAlertState
  notification: NotificationDescriptor | null
}

export function createInitialAlertState(): ProviderAlertState {
  return {
    lastPct: null,
    lowAlertSent: false,
    resetAlertSent: false
  }
}

export function createInitialAlertStateMap(): Record<ProviderId, ProviderAlertState> {
  return {
    chatgpt: createInitialAlertState(),
    gemini: createInitialAlertState(),
    claude: createInitialAlertState()
  }
}

/**
 * Pure state-machine evaluator for single-fire OS desktop notifications:
 * - Fires once when a provider first crosses into <= 20% remaining (`> 20 -> <= 20`)
 * - Fires once when a provider recovers to 100% remaining (`< 100 -> 100`)
 * - Never fires on the initial baseline observation (`lastPct === null`)
 */
export function evaluateAlertTransition(
  prev: ProviderAlertState | undefined,
  usage: ProviderUsage,
  options: {
    providerEnabled: boolean
    notificationsEnabled: boolean
  }
): AlertTransitionResult {
  const state: ProviderAlertState = prev ? { ...prev } : createInitialAlertState()

  if (!options.providerEnabled || usage.status !== 'ok' || usage.sessionRemainingPct === null) {
    return { nextState: state, notification: null }
  }

  const pct = clampPercentage(usage.sessionRemainingPct)
  const providerName = PROVIDER_META[usage.id].name

  // First reading establishes baseline without noisy startup alerts
  if (state.lastPct === null) {
    return {
      nextState: {
        lastPct: pct,
        lowAlertSent: pct <= ENERGY_THRESHOLDS.LOW_MAX,
        resetAlertSent: pct >= 100
      },
      notification: null
    }
  }

  const prevPct = state.lastPct
  let notification: NotificationDescriptor | null = null
  let lowAlertSent = state.lowAlertSent
  let resetAlertSent = state.resetAlertSent

  if (pct <= ENERGY_THRESHOLDS.LOW_MAX) {
    resetAlertSent = false
    if (!lowAlertSent && prevPct > ENERGY_THRESHOLDS.LOW_MAX) {
      lowAlertSent = true
      if (options.notificationsEnabled) {
        const resetLabel = formatResetTime(usage.sessionResetAt, false)
        const resetSuffix = resetLabel ? ` (${resetLabel})` : ''
        notification = {
          providerId: usage.id,
          kind: 'low_threshold',
          title: `${APP_NAME} · ${providerName} 잔여량 경고`,
          body: `세션 잔여량이 ${pct}% 이하로 내려갔습니다.${resetSuffix}`
        }
      }
    }
  } else if (pct >= 100) {
    lowAlertSent = false
    if (!resetAlertSent && prevPct < 100) {
      resetAlertSent = true
      if (options.notificationsEnabled) {
        notification = {
          providerId: usage.id,
          kind: 'reset_recovered',
          title: `${APP_NAME} · ${providerName} 사용량 초기화 완료`,
          body: `세션 잔여량이 100%로 회복되었습니다.`
        }
      }
    }
  } else {
    // Mid-range (21% ~ 99%): re-arm both single-fire triggers
    lowAlertSent = false
    resetAlertSent = false
  }

  return {
    nextState: {
      lastPct: pct,
      lowAlertSent,
      resetAlertSent
    },
    notification
  }
}

export class UsageNotifier {
  private readonly onClickNotification?: () => void

  constructor(onClickNotification?: () => void) {
    this.onClickNotification = onClickNotification
  }

  evaluateAndDispatch(
    prevStates: Record<ProviderId, ProviderAlertState>,
    usages: Record<ProviderId, ProviderUsage>,
    enabledProviders: Record<ProviderId, boolean>,
    notificationsEnabled: boolean
  ): Record<ProviderId, ProviderAlertState> {
    const nextStates = { ...prevStates }

    for (const id of PROVIDER_ORDER) {
      const { nextState, notification } = evaluateAlertTransition(prevStates[id], usages[id], {
        providerEnabled: enabledProviders[id],
        notificationsEnabled
      })
      nextStates[id] = nextState

      if (notification) {
        this.sendOsNotification(notification)
      }
    }

    return nextStates
  }

  private sendOsNotification(descriptor: NotificationDescriptor): void {
    try {
      if (!Notification.isSupported()) return
      const notif = new Notification({
        title: descriptor.title,
        body: descriptor.body,
        silent: false
      })
      if (this.onClickNotification) {
        notif.on('click', () => this.onClickNotification?.())
      }
      notif.show()
    } catch {
      // Never crash the resident tray app if OS notification subsystem rejects
    }
  }
}
