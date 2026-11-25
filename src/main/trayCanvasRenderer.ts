import { BrowserWindow } from 'electron'
import { PROVIDER_ICON_PATHS } from '../shared/providerIcons'
import type { TrayItemSummary } from '../shared/types'

export interface CanvasMultiProviderTrayOptions {
  items: TrayItemSummary[]
  showPercentage: boolean
  isDarkTheme: boolean
}

export interface CanvasRenderedTray {
  logicalWidth: number
  logicalHeight: number
  png1x: Buffer
  png2x: Buffer
}

interface CanvasEvalResult {
  logicalWidth: number
  logicalHeight: number
  png1xBase64: string
  png2xBase64: string
}

const RENDERER_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:transparent;overflow:hidden;">
<script>
(() => {
  const ICON_PATHS = ${JSON.stringify(PROVIDER_ICON_PATHS)};
  const ICON_OPTICAL_SIZE = {
    chatgpt: 14.0,
    gemini: 15.2,
    claude: 14.8
  };

  const FONT_FAMILY =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const FILL_STOPS_WITH_TEXT = {
    high: ['rgba(34, 197, 94, 0.64)', 'rgba(21, 160, 72, 0.54)'],
    medium: ['rgba(245, 158, 11, 0.68)', 'rgba(217, 119, 6, 0.58)'],
    low: ['rgba(239, 68, 68, 0.74)', 'rgba(220, 38, 38, 0.64)'],
    unknown: ['rgba(148, 163, 184, 0.45)', 'rgba(100, 116, 139, 0.38)']
  };

  const FILL_STOPS_PLAIN = {
    high: ['rgba(34, 197, 94, 0.82)', 'rgba(22, 163, 74, 0.74)'],
    medium: ['rgba(245, 158, 11, 0.84)', 'rgba(217, 119, 6, 0.76)'],
    low: ['rgba(239, 68, 68, 0.88)', 'rgba(220, 38, 38, 0.80)'],
    unknown: ['rgba(148, 163, 184, 0.65)', 'rgba(100, 116, 139, 0.55)']
  };

  function getCachedPaths() {
    if (!window.__providerPaths) {
      window.__providerPaths = {
        chatgpt: new Path2D(ICON_PATHS.chatgpt),
        gemini: new Path2D(ICON_PATHS.gemini),
        claude: new Path2D(ICON_PATHS.claude)
      };
    }
    return window.__providerPaths;
  }

  function renderAtScale(options, scale) {
    const { items, showPercentage, isDarkTheme } = options;
    const logicalHeight = 22;
    const cy = logicalHeight / 2;

    const paddingX = 3;
    const iconSlotW = 15;
    const iconToBatteryGap = 3.5;
    const batteryW = showPercentage ? 41 : 22;
    const batteryH = showPercentage ? 16 : 13;
    const bodyR = showPercentage ? 3.8 : 2.8;
    const borderW = showPercentage ? 1.25 : 1.2;
    const capGap = 0.85;
    const capW = showPercentage ? 2.0 : 1.8;
    const capH = showPercentage ? 6.0 : 5.0;
    const itemW = iconSlotW + iconToBatteryGap + batteryW + capGap + capW;
    const itemGap = showPercentage ? 8 : 6.5;

    const logicalWidth = Math.ceil(
      paddingX * 2 + items.length * itemW + Math.max(0, items.length - 1) * itemGap
    );

    const canvas = document.createElement('canvas');
    canvas.width = logicalWidth * scale;
    canvas.height = logicalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const iconColorActive = isDarkTheme ? 'rgba(255, 255, 255, 0.96)' : 'rgba(20, 22, 26, 0.92)';
    const iconColorMuted = isDarkTheme ? 'rgba(255, 255, 255, 0.78)' : 'rgba(20, 22, 26, 0.68)';

    const outlineColorActive = isDarkTheme ? 'rgba(255, 255, 255, 0.86)' : 'rgba(24, 26, 31, 0.84)';
    const outlineColorMuted = isDarkTheme ? 'rgba(255, 255, 255, 0.66)' : 'rgba(24, 26, 31, 0.62)';

    const capColorActive = isDarkTheme ? 'rgba(255, 255, 255, 0.82)' : 'rgba(24, 26, 31, 0.80)';
    const capColorMuted = isDarkTheme ? 'rgba(255, 255, 255, 0.62)' : 'rgba(24, 26, 31, 0.58)';

    const trackBgActive = showPercentage
      ? isDarkTheme
        ? 'rgba(12, 16, 24, 0.56)'
        : 'rgba(18, 23, 32, 0.62)'
      : isDarkTheme
        ? 'rgba(15, 19, 27, 0.34)'
        : 'rgba(24, 26, 31, 0.14)';

    const trackBgMuted = showPercentage
      ? isDarkTheme
        ? 'rgba(12, 16, 24, 0.42)'
        : 'rgba(22, 27, 36, 0.48)'
      : isDarkTheme
        ? 'rgba(15, 19, 27, 0.24)'
        : 'rgba(24, 26, 31, 0.10)';

    const paths = getCachedPaths();
    const fillMap = showPercentage ? FILL_STOPS_WITH_TEXT : FILL_STOPS_PLAIN;

    items.forEach((item, idx) => {
      const startX = paddingX + idx * (itemW + itemGap);
      const iconCx = startX + iconSlotW / 2;

      const pct =
        item.status === 'ok' && typeof item.remainingPct === 'number' && Number.isFinite(item.remainingPct)
          ? Math.max(0, Math.min(100, Math.round(item.remainingPct)))
          : null;

      const isUnavailable =
        item.badgeKind === 'unavailable' ||
        (item.badgeKind === undefined && item.status === 'ok' && pct === null);

      // 1. Official brand vector icon
      const drawSize = ICON_OPTICAL_SIZE[item.id] ?? 14.5;
      const iconScale = drawSize / 24;
      const path2d = paths[item.id];
      if (path2d) {
        ctx.save();
        ctx.translate(iconCx - drawSize / 2, cy - drawSize / 2);
        ctx.scale(iconScale, iconScale);
        if (isDarkTheme) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
          ctx.shadowBlur = 1.2 * scale;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0.5 * scale;
        }
        ctx.fillStyle = isUnavailable ? iconColorMuted : iconColorActive;
        ctx.fill(path2d);
        ctx.restore();
      }

      // 2. Battery capsule geometry
      const batteryLeft = startX + iconSlotW + iconToBatteryGap;
      const batteryTop = cy - batteryH / 2;

      const innerInset = showPercentage ? 1.05 : 1.55;
      const innerX = batteryLeft + innerInset;
      const innerY = batteryTop + innerInset;
      const innerW = batteryW - innerInset * 2;
      const innerH = batteryH - innerInset * 2;
      const innerR = Math.max(1.2, bodyR - innerInset);

      // 2a. Frosted translucent dark capsule track + semi-transparent colored level fill
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(innerX, innerY, innerW, innerH, innerR);
      ctx.fillStyle = isUnavailable ? trackBgMuted : trackBgActive;
      ctx.fill();

      if (pct !== null && pct > 0) {
        ctx.clip();
        const fillW = Math.max(2.8, (innerW * pct) / 100);
        const stops = fillMap[item.level] || fillMap.unknown;
        const grad = ctx.createLinearGradient(0, innerY, 0, innerY + innerH);
        grad.addColorStop(0, stops[0]);
        grad.addColorStop(1, stops[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(innerX, innerY, fillW, innerH);
      }
      ctx.restore();

      // 2b. Crisp outer battery outline (cleanly covers inner seam with zero background bleed)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(
        batteryLeft + borderW / 2,
        batteryTop + borderW / 2,
        batteryW - borderW,
        batteryH - borderW,
        Math.max(1.5, bodyR - borderW / 2)
      );
      ctx.lineWidth = borderW;
      ctx.strokeStyle = isUnavailable ? outlineColorMuted : outlineColorActive;
      ctx.stroke();
      ctx.restore();

      // 2c. Positive battery terminal cap
      const capX = batteryLeft + batteryW + capGap;
      const capY = cy - capH / 2;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(capX, capY, capW, capH, [0.45, 1.1, 1.1, 0.45]);
      ctx.fillStyle = isUnavailable ? capColorMuted : capColorActive;
      ctx.fill();
      ctx.restore();

      // 2d. High-legibility native system percentage / status label centered optically inside the capsule
      if (showPercentage) {
        const label =
          pct !== null
            ? String(pct) + '%'
            : isUnavailable
              ? 'N/A'
              : '!';

        const batteryCx = batteryLeft + batteryW / 2;
        const maxTextW = innerW - 4.4;
        let fontSize = label === 'N/A' ? 9.75 : label.length >= 4 ? 10.25 : 11.0;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';

        while (fontSize > 8.25) {
          ctx.font = '700 ' + fontSize + 'px ' + FONT_FAMILY;
          if (ctx.measureText(label).width <= maxTextW) break;
          fontSize -= 0.25;
        }

        const metrics = ctx.measureText(label);
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.72;
        const descent = metrics.actualBoundingBoxDescent || 0;
        const textY = cy + (ascent - descent) / 2;

        // Subtle crisp drop shadow keeps inner glyph counters (0, 8, %) completely open and sharp
        ctx.shadowColor = isUnavailable ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0.56)';
        ctx.shadowBlur = 1.3 * scale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0.5 * scale;
        ctx.fillStyle = isUnavailable ? 'rgba(255, 255, 255, 0.84)' : '#ffffff';
        ctx.fillText(label, batteryCx, textY);
        ctx.restore();
      }
    });

    const dataUrl = canvas.toDataURL('image/png');
    return {
      logicalWidth,
      logicalHeight,
      base64: dataUrl.replace(/^data:image\\/png;base64,/, '')
    };
  }

  window.__renderMultiProviderTray = (options) => {
    const r1 = renderAtScale(options, 1);
    const r2 = renderAtScale(options, 2);
    if (!r1 || !r2) return null;
    return {
      logicalWidth: r1.logicalWidth,
      logicalHeight: r1.logicalHeight,
      png1xBase64: r1.base64,
      png2xBase64: r2.base64
    };
  };
})();
</script>
</body>
</html>`

/**
 * Renders Retina (@1x/@2x) macOS/Linux menu bar icons using Chromium's Skia 2D canvas inside
 * a single tiny reusable hidden BrowserWindow. This delivers pixel-accurate official SVG brand
 * icons (Path2D) and crisp native system typography (SF Pro / Segoe UI) inside battery capsules.
 */
export class TrayCanvasRenderer {
  private win: BrowserWindow | null = null
  private readyPromise: Promise<BrowserWindow | null> | null = null
  private disposed = false

  private async ensureWindow(): Promise<BrowserWindow | null> {
    if (this.disposed) return null
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      return this.win
    }
    if (this.readyPromise) {
      return this.readyPromise
    }

    this.readyPromise = (async () => {
      try {
        const win = new BrowserWindow({
          width: 320,
          height: 64,
          show: false,
          frame: false,
          transparent: true,
          skipTaskbar: true,
          focusable: false,
          hasShadow: false,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false
          }
        })

        win.on('closed', () => {
          if (this.win === win) {
            this.win = null
          }
        })

        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(RENDERER_HTML)}`)

        if (this.disposed || win.isDestroyed() || win.webContents.isDestroyed()) {
          if (!win.isDestroyed()) win.destroy()
          return null
        }

        this.win = win
        return win
      } catch {
        return null
      } finally {
        this.readyPromise = null
      }
    })()

    return this.readyPromise
  }

  async renderMultiProviderTray(
    options: CanvasMultiProviderTrayOptions
  ): Promise<CanvasRenderedTray | null> {
    if (this.disposed || options.items.length === 0) return null

    const win = await this.ensureWindow()
    if (!win || this.disposed || win.isDestroyed() || win.webContents.isDestroyed()) {
      return null
    }

    try {
      const payload = JSON.stringify(options)
      const result = (await win.webContents.executeJavaScript(
        `window.__renderMultiProviderTray(${payload})`,
        true
      )) as CanvasEvalResult | null

      if (!result || !result.png1xBase64 || !result.png2xBase64) {
        return null
      }

      return {
        logicalWidth: result.logicalWidth,
        logicalHeight: result.logicalHeight,
        png1x: Buffer.from(result.png1xBase64, 'base64'),
        png2x: Buffer.from(result.png2xBase64, 'base64')
      }
    } catch {
      return null
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy()
    }
    this.win = null
    this.readyPromise = null
  }
}
