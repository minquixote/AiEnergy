import { app } from 'electron'

export interface LaunchAtLoginResult {
  appliedToOs: boolean
  openAtLogin: boolean
  diagnostic: string
}

/**
 * Applies macOS/Windows OS login item registration via `app.setLoginItemSettings`.
 * In development (`!app.isPackaged`), persists preference cleanly without registering the
 * raw Electron binary as an OS login item.
 */
export function applyLaunchAtLoginSetting(enabled: boolean): LaunchAtLoginResult {
  const supportedPlatform = process.platform === 'darwin' || process.platform === 'win32'
  if (!supportedPlatform) {
    return {
      appliedToOs: false,
      openAtLogin: enabled,
      diagnostic: '현재 OS에서는 자동 실행 등록을 지원하지 않습니다.'
    }
  }

  if (!app.isPackaged) {
    return {
      appliedToOs: false,
      openAtLogin: enabled,
      diagnostic: `개발 모드에서는 설정만 저장됩니다 (${enabled ? 'ON' : 'OFF'}). 패키징된 앱에서 OS 자동 실행이 적용됩니다.`
    }
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: enabled
    })
    return {
      appliedToOs: true,
      openAtLogin: enabled,
      diagnostic: `OS 로그인 시 자동 실행 ${enabled ? '등록' : '해제'} 완료`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      appliedToOs: false,
      openAtLogin: enabled,
      diagnostic: `OS 자동 실행 설정 중 오류: ${msg}`
    }
  }
}
