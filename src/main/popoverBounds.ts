export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const EDGE_MARGIN = 8
const TRAY_GAP = 6

export function computePopoverBounds(
  trayBounds: Rect,
  workArea: Rect,
  popoverWidth: number,
  popoverHeight: number,
  platform: NodeJS.Platform
): Rect {
  const hasValidTrayBounds = trayBounds.width > 0 || trayBounds.height > 0

  if (!hasValidTrayBounds) {
    // Fallback (e.g. Linux environments without tray bounds): top-right on macOS/Linux, bottom-right on Windows
    const x = workArea.x + workArea.width - popoverWidth - EDGE_MARGIN
    const y =
      platform === 'win32'
        ? workArea.y + workArea.height - popoverHeight - EDGE_MARGIN
        : workArea.y + EDGE_MARGIN
    return { x, y, width: popoverWidth, height: popoverHeight }
  }

  const desiredX = Math.round(trayBounds.x + trayBounds.width / 2 - popoverWidth / 2)
  const minX = workArea.x + EDGE_MARGIN
  const maxX = Math.max(minX, workArea.x + workArea.width - popoverWidth - EDGE_MARGIN)
  const x = Math.max(minX, Math.min(maxX, desiredX))

  let desiredY: number
  if (platform === 'darwin') {
    desiredY = Math.max(workArea.y + TRAY_GAP, trayBounds.y + trayBounds.height + TRAY_GAP)
  } else {
    const isBottomTaskbar = trayBounds.y > workArea.y + workArea.height / 2
    desiredY = isBottomTaskbar
      ? trayBounds.y - popoverHeight - TRAY_GAP
      : trayBounds.y + trayBounds.height + TRAY_GAP
  }

  const minY = workArea.y + TRAY_GAP
  const maxY = Math.max(minY, workArea.y + workArea.height - popoverHeight - EDGE_MARGIN)
  const y = Math.max(minY, Math.min(maxY, Math.round(desiredY)))

  return {
    x,
    y,
    width: popoverWidth,
    height: popoverHeight
  }
}
