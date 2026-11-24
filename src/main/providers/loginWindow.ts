import { BrowserWindow, session } from 'electron'
import { PROVIDER_META } from '../../shared/constants'
import type { LoginWindowResult, ProviderId } from '../../shared/types'
import { buildCleanUserAgent } from './base'

const activeWindows = new Map<ProviderId, BrowserWindow>()

export function openProviderLoginWindow(
  providerId: ProviderId,
  onClosed?: (providerId: ProviderId) => void
): LoginWindowResult {
  const existing = activeWindows.get(providerId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return {
      opened: true,
      providerId,
      note: '이미 열려 있는 로그인 창을 활성화했습니다.'
    }
  }

  const meta = PROVIDER_META[providerId]
  const providerSession = session.fromPartition(meta.partition)
  const cleanUa = buildCleanUserAgent(providerSession.getUserAgent())
  providerSession.setUserAgent(cleanUa)

  const loginWindow = new BrowserWindow({
    width: 560,
    height: 740,
    minWidth: 420,
    minHeight: 560,
    title: `${meta.name} 로그인 — AI Energy Bar`,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      partition: meta.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Allow OAuth/SSO login popups (e.g. Google/Apple/Microsoft login) within the same persistent partition
  loginWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 500,
      height: 680,
      autoHideMenuBar: true,
      webPreferences: {
        partition: meta.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    }
  }))

  activeWindows.set(providerId, loginWindow)

  loginWindow.once('ready-to-show', () => {
    loginWindow.show()
    loginWindow.focus()
  })

  loginWindow.on('closed', () => {
    activeWindows.delete(providerId)
    onClosed?.(providerId)
  })

  void loginWindow.loadURL(meta.loginUrl)

  return {
    opened: true,
    providerId,
    note: `${meta.name} 로그인 창을 열었습니다. 로그인 완료 후 창을 닫으면 사용량을 자동으로 불러옵니다.`
  }
}

export async function clearProviderSession(providerId: ProviderId): Promise<void> {
  const meta = PROVIDER_META[providerId]
  const providerSession = session.fromPartition(meta.partition)
  await providerSession.clearStorageData()
  await providerSession.clearCache()
}
