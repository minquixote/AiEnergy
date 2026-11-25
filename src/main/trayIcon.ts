import { deflateSync } from 'node:zlib'
import type { EnergyLevel, ProviderId, TrayItemSummary } from '../shared/types'

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export interface BatteryIconRenderOptions {
  percentage: number | null
  level: EnergyLevel
  isDarkTheme: boolean
  scale: 1 | 2
}

export interface MultiProviderTrayRenderOptions {
  items: TrayItemSummary[]
  showPercentage: boolean
  isDarkTheme: boolean
  scale: 1 | 2
}

export interface RenderedTrayPng {
  logicalWidth: number
  logicalHeight: number
  pixelWidth: number
  pixelHeight: number
  png: Buffer
}

const COMPACT_LOGICAL_WIDTH = 24
const COMPACT_LOGICAL_HEIGHT = 16
const MULTI_LOGICAL_HEIGHT = 20

// High-contrast rich fills tuned so white bold % text inside the capsule stays crisp
const FILL_COLORS_WITH_TEXT: Record<EnergyLevel, Rgba> = {
  high: { r: 22, g: 163, b: 74, a: 255 }, // #16a34a
  medium: { r: 217, g: 119, b: 6, a: 255 }, // #d97706
  low: { r: 220, g: 38, b: 38, a: 255 }, // #dc2626
  unknown: { r: 100, g: 116, b: 139, a: 230 } // #64748b
}

const FILL_COLORS_PLAIN: Record<EnergyLevel, Rgba> = {
  high: { r: 34, g: 197, b: 94, a: 255 }, // #22c55e
  medium: { r: 245, g: 158, b: 11, a: 255 }, // #f59e0b
  low: { r: 239, g: 68, b: 68, a: 255 }, // #ef4444
  unknown: { r: 148, g: 163, b: 184, a: 215 } // #94a3b8
}

// ---------- SDF Geometry Primitives ----------

function sdRoundedBox(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  r: number
): number {
  const qx = Math.abs(px - cx) - (hx - r)
  const qy = Math.abs(py - cy) - (hy - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - r
}

function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const denom = bax * bax + bay * bay
  const h = denom > 0 ? Math.max(0, Math.min(1, (pax * bax + pay * bay) / denom)) : 0
  return Math.hypot(pax - bax * h, pay - bay * h)
}

function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r
}

function sdRing(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.abs(Math.hypot(px - cx, py - cy) - r)
}

function sdEllipseRing(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): number {
  const dx = px - cx
  const dy = py - cy
  const k0 = Math.hypot(dx / rx, dy / ry)
  if (k0 === 0) return Math.min(rx, ry)
  const k1 = Math.hypot(dx / (rx * rx), dy / (ry * ry))
  return Math.abs((k0 * (k0 - 1)) / k1)
}

function sdArc(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startRad: number,
  endRad: number
): number {
  // Sample-free distance to an elliptical arc via clamped angle projection (accurate for glyph arcs)
  const dx = px - cx
  const dy = py - cy
  let angle = Math.atan2(dy / ry, dx / rx)

  const twoPi = Math.PI * 2
  const span = ((endRad - startRad) % twoPi + twoPi) % twoPi
  const rel = ((angle - startRad) % twoPi + twoPi) % twoPi

  if (rel > span) {
    // Clamp to nearest arc endpoint
    const dStart = rel > Math.PI ? twoPi - rel : rel
    const dEnd = Math.abs(rel - span)
    angle = dStart < dEnd ? startRad : endRad
  }

  const ax = cx + Math.cos(angle) * rx
  const ay = cy + Math.sin(angle) * ry
  return Math.hypot(px - ax, py - ay)
}

// ---------- Distinct Platform Icons (normalized center cx, cy, radius R) ----------

function sdProviderIcon(
  id: ProviderId,
  px: number,
  py: number,
  cx: number,
  cy: number,
  radius: number
): number {
  const x = (px - cx) / radius
  const y = (py - cy) / radius

  switch (id) {
    case 'gemini': {
      // Exact 4-corner circular-cutout concave star SDF (smooth everywhere, zero axis singularity)
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      const boxD = Math.max(ax - 1, ay - 1)
      const cutoutD = 0.98 - Math.hypot(ax - 1.02, ay - 1.02)
      return Math.max(boxD, cutoutD) * radius
    }

    case 'claude': {
      // Iconic Anthropic Claude 8-ray starburst
      let d = sdCircle(x, y, 0, 0, 0.21)
      for (let i = 0; i < 8; i += 1) {
        const theta = (i * Math.PI) / 4
        const len = i % 2 === 0 ? 0.94 : 0.84
        const segD = sdSegment(x, y, 0, 0, Math.cos(theta) * len, Math.sin(theta) * len) - 0.115
        d = Math.min(d, segD)
      }
      return d * radius
    }

    case 'chatgpt': {
      // Iconic OpenAI 6-lobe interlocking bloom ring with clean hexagonal center opening
      let petals = Infinity
      const orbit = 0.44
      const lobeR = 0.37
      const lobeStroke = 0.105
      for (let i = 0; i < 6; i += 1) {
        const theta = (i * Math.PI) / 3 + Math.PI / 6
        const lx = Math.cos(theta) * orbit
        const ly = Math.sin(theta) * orbit
        const ring = sdRing(x, y, lx, ly, lobeR) - lobeStroke
        petals = Math.min(petals, ring)
      }
      // Keep the central aperture crisp and hollow
      const coreCutout = 0.22 - Math.hypot(x, y)
      const combined = Math.max(petals, coreCutout)
      return combined * radius
    }
  }
}

// ---------- Vector SDF Glyphs for Digits & Symbols Inside Battery ----------

function sdGlyphStroke(
  ch: string,
  lx: number,
  ly: number,
  gx: number,
  gy: number,
  gw: number,
  gh: number
): number {
  // Compute SDF in glyph-local physical units (origin at gx, gy)
  const x = lx - gx
  const y = ly - gy
  const w = gw
  const h = gh

  switch (ch) {
    case '0':
      return Math.abs(
        sdRoundedBox(x, y, w * 0.5, h * 0.5, w * 0.42, h * 0.45, Math.min(w * 0.38, h * 0.34))
      )

    case '1': {
      const stem = sdSegment(x, y, w * 0.58, h * 0.08, w * 0.58, h * 0.92)
      const serif = sdSegment(x, y, w * 0.58, h * 0.09, w * 0.22, h * 0.29)
      const base = sdSegment(x, y, w * 0.25, h * 0.92, w * 0.88, h * 0.92)
      return Math.min(stem, serif, base)
    }

    case '2': {
      const topArc = sdArc(x, y, w * 0.5, h * 0.30, w * 0.39, h * 0.24, Math.PI * 1.08, Math.PI * 0.15)
      const diag = sdSegment(x, y, w * 0.86, h * 0.39, w * 0.12, h * 0.92)
      const bottom = sdSegment(x, y, w * 0.12, h * 0.92, w * 0.90, h * 0.92)
      return Math.min(topArc, diag, bottom)
    }

    case '3': {
      const upper = sdArc(x, y, w * 0.48, h * 0.28, w * 0.39, h * 0.22, Math.PI * 1.15, Math.PI * 0.52)
      const lower = sdArc(x, y, w * 0.48, h * 0.71, w * 0.41, h * 0.23, Math.PI * 1.48, Math.PI * 0.88)
      const mid = sdSegment(x, y, w * 0.40, h * 0.49, w * 0.54, h * 0.49)
      return Math.min(upper, lower, mid)
    }

    case '4': {
      const vert = sdSegment(x, y, w * 0.72, h * 0.08, w * 0.72, h * 0.92)
      const diag = sdSegment(x, y, w * 0.70, h * 0.09, w * 0.10, h * 0.66)
      const bar = sdSegment(x, y, w * 0.10, h * 0.66, w * 0.94, h * 0.66)
      return Math.min(vert, diag, bar)
    }

    case '5': {
      const top = sdSegment(x, y, w * 0.84, h * 0.08, w * 0.19, h * 0.08)
      const stem = sdSegment(x, y, w * 0.19, h * 0.08, w * 0.16, h * 0.46)
      const bowl = sdArc(x, y, w * 0.48, h * 0.68, w * 0.40, h * 0.25, Math.PI * 1.28, Math.PI * 0.86)
      return Math.min(top, stem, bowl)
    }

    case '6': {
      const bowl = sdEllipseRing(x, y, w * 0.50, h * 0.68, w * 0.39, h * 0.25)
      const neck = sdArc(x, y, w * 0.58, h * 0.52, w * 0.47, h * 0.45, Math.PI * 0.96, Math.PI * 1.64)
      return Math.min(bowl, neck)
    }

    case '7': {
      const top = sdSegment(x, y, w * 0.11, h * 0.08, w * 0.89, h * 0.08)
      const diag = sdSegment(x, y, w * 0.89, h * 0.08, w * 0.36, h * 0.92)
      return Math.min(top, diag)
    }

    case '8': {
      const upper = sdEllipseRing(x, y, w * 0.50, h * 0.28, w * 0.35, h * 0.21)
      const lower = sdEllipseRing(x, y, w * 0.50, h * 0.71, w * 0.40, h * 0.23)
      return Math.min(upper, lower)
    }

    case '9': {
      const bowl = sdEllipseRing(x, y, w * 0.50, h * 0.31, w * 0.39, h * 0.24)
      const tail = sdArc(x, y, w * 0.42, h * 0.47, w * 0.47, h * 0.46, -Math.PI * 0.06, Math.PI * 0.64)
      return Math.min(bowl, tail)
    }

    case '%': {
      const slash = sdSegment(x, y, w * 0.84, h * 0.10, w * 0.16, h * 0.90)
      const topDot = sdRing(x, y, w * 0.24, h * 0.24, Math.min(w, h) * 0.17)
      const botDot = sdRing(x, y, w * 0.76, h * 0.76, Math.min(w, h) * 0.17)
      return Math.min(slash, topDot, botDot)
    }

    case '-':
      return sdSegment(x, y, w * 0.16, h * 0.50, w * 0.84, h * 0.50)

    case '!': {
      const stem = sdSegment(x, y, w * 0.50, h * 0.10, w * 0.50, h * 0.62)
      const dot = Math.hypot(x - w * 0.50, y - h * 0.88)
      return Math.min(stem, dot)
    }

    default:
      return Infinity
  }
}

function getGlyphWidth(ch: string, digitW: number): number {
  if (ch === '1') return digitW * 0.72
  if (ch === '%') return digitW * 1.18
  if (ch === '!') return digitW * 0.55
  if (ch === '-') return digitW * 0.85
  return digitW
}

interface GlyphPlacement {
  ch: string
  x: number
  w: number
}

function layoutCenteredText(
  text: string,
  centerX: number,
  digitW: number,
  tracking: number
): GlyphPlacement[] {
  const widths = [...text].map((ch) => getGlyphWidth(ch, digitW))
  const totalW =
    widths.reduce((acc, w) => acc + w, 0) + Math.max(0, widths.length - 1) * tracking
  let cursor = centerX - totalW / 2
  const result: GlyphPlacement[] = []
  for (let i = 0; i < text.length; i += 1) {
    result.push({ ch: text[i], x: cursor, w: widths[i] })
    cursor += widths[i] + tracking
  }
  return result
}

// ---------- Pixel Blending & PNG Encoding ----------

function blendPixel(buf: Uint8Array, offset: number, src: Rgba, coverage: number): void {
  const srcAlpha = (src.a / 255) * Math.max(0, Math.min(1, coverage))
  if (srcAlpha <= 0) return

  const dstAlpha = buf[offset + 3] / 255
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
  if (outAlpha <= 0) return

  buf[offset] = Math.round((src.r * srcAlpha + buf[offset] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  buf[offset + 1] = Math.round(
    (src.g * srcAlpha + buf[offset + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha
  )
  buf[offset + 2] = Math.round(
    (src.b * srcAlpha + buf[offset + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha
  )
  buf[offset + 3] = Math.round(outAlpha * 255)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function makePngChunk(type: string, data: Uint8Array): Buffer {
  const lengthBuf = Buffer.alloc(4)
  lengthBuf.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf])
}

export function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter type None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1)
  }

  const compressed = deflateSync(raw)
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------- Compact Single Battery Icon (Windows / Empty Fallback) ----------

export function renderBatteryIconPng(options: BatteryIconRenderOptions): Buffer {
  const { percentage, level, isDarkTheme, scale } = options
  const width = COMPACT_LOGICAL_WIDTH * scale
  const height = COMPACT_LOGICAL_HEIGHT * scale
  const rgba = new Uint8Array(width * height * 4)

  const outlineColor: Rgba = isDarkTheme
    ? { r: 244, g: 244, b: 245, a: 235 }
    : { r: 24, g: 24, b: 27, a: 225 }

  const trackBgColor: Rgba = isDarkTheme
    ? { r: 255, g: 255, b: 255, a: 28 }
    : { r: 24, g: 24, b: 27, a: 22 }

  const fillColor = FILL_COLORS_PLAIN[level]

  const bodyCx = 10.5
  const bodyCy = 8
  const bodyHx = 9.0
  const bodyHy = 5.5
  const bodyR = 2.6
  const stroke = 1.25

  const capCx = 21.3
  const capCy = 8
  const capHx = 1.15
  const capHy = 2.35
  const capR = 0.85

  const innerLeft = 3.5
  const innerRight = 17.5
  const innerMaxW = innerRight - innerLeft
  const clampedPct =
    percentage === null || !Number.isFinite(percentage)
      ? 0
      : Math.max(0, Math.min(100, percentage))
  const fillW = clampedPct > 0 ? Math.max(1.8, (innerMaxW * clampedPct) / 100) : 0
  const fillCx = innerLeft + fillW / 2
  const fillHy = 3.5
  const fillR = Math.min(1.2, fillW / 2)

  const aa = 0.7 / scale

  for (let py = 0; py < height; py += 1) {
    const ly = (py + 0.5) / scale
    for (let px = 0; px < width; px += 1) {
      const lx = (px + 0.5) / scale
      const offset = (py * width + px) * 4

      const innerTrackDist = sdRoundedBox(
        lx,
        ly,
        bodyCx,
        bodyCy,
        bodyHx - stroke,
        bodyHy - stroke,
        Math.max(0.8, bodyR - stroke)
      )
      const trackCov = Math.max(0, Math.min(1, 0.5 - innerTrackDist / aa))
      if (trackCov > 0) {
        blendPixel(rgba, offset, trackBgColor, trackCov)
      }

      if (fillW > 0) {
        const fillDist = sdRoundedBox(lx, ly, fillCx, bodyCy, fillW / 2, fillHy, fillR)
        const fillCov = Math.max(0, Math.min(1, 0.5 - fillDist / aa))
        if (fillCov > 0) {
          blendPixel(rgba, offset, fillColor, fillCov)
        }
      }

      const outerDist = sdRoundedBox(lx, ly, bodyCx, bodyCy, bodyHx, bodyHy, bodyR)
      const ringDist = Math.max(outerDist, -(outerDist + stroke))
      const ringCov = Math.max(0, Math.min(1, 0.5 - ringDist / aa))
      if (ringCov > 0) {
        blendPixel(rgba, offset, outlineColor, ringCov)
      }

      const capDist = sdRoundedBox(lx, ly, capCx, capCy, capHx, capHy, capR)
      const capCov = Math.max(0, Math.min(1, 0.5 - capDist / aa))
      if (capCov > 0) {
        blendPixel(rgba, offset, outlineColor, capCov)
      }
    }
  }

  return encodeRgbaToPng(width, height, rgba)
}

// ---------- Multi-Provider macOS Menu Bar Strip ([Icon][Battery with XX%]) ----------

export function renderMultiProviderTrayPng(
  options: MultiProviderTrayRenderOptions
): RenderedTrayPng {
  const { items, showPercentage, isDarkTheme, scale } = options

  if (items.length === 0) {
    const png = renderBatteryIconPng({
      percentage: null,
      level: 'unknown',
      isDarkTheme,
      scale
    })
    return {
      logicalWidth: COMPACT_LOGICAL_WIDTH,
      logicalHeight: COMPACT_LOGICAL_HEIGHT,
      pixelWidth: COMPACT_LOGICAL_WIDTH * scale,
      pixelHeight: COMPACT_LOGICAL_HEIGHT * scale,
      png
    }
  }

  const paddingX = 2
  const iconSize = 13
  const iconRadius = 5.9
  const iconToBatteryGap = 2.5
  const batteryW = showPercentage ? 36 : 20
  const batteryH = showPercentage ? 15 : 12.5
  const capGap = 0.7
  const capW = 1.8
  const itemW = iconSize + iconToBatteryGap + batteryW + capGap + capW
  const itemGap = showPercentage ? 7 : 6

  const logicalWidth = Math.ceil(
    paddingX * 2 + items.length * itemW + Math.max(0, items.length - 1) * itemGap
  )
  const logicalHeight = MULTI_LOGICAL_HEIGHT
  const pixelWidth = logicalWidth * scale
  const pixelHeight = logicalHeight * scale
  const rgba = new Uint8Array(pixelWidth * pixelHeight * 4)

  const iconColor: Rgba = isDarkTheme
    ? { r: 245, g: 246, b: 248, a: 245 }
    : { r: 22, g: 24, b: 28, a: 235 }

  const outlineColor: Rgba = isDarkTheme
    ? { r: 245, g: 246, b: 248, a: 225 }
    : { r: 24, g: 24, b: 27, a: 220 }

  // Tinted dark backdrop inside battery capsule guarantees crisp white % legibility in both dark & light menu bars
  const trackBgColor: Rgba = showPercentage
    ? isDarkTheme
      ? { r: 18, g: 20, b: 26, a: 205 }
      : { r: 30, g: 34, b: 42, a: 185 }
    : isDarkTheme
      ? { r: 255, g: 255, b: 255, a: 32 }
      : { r: 24, g: 24, b: 27, a: 28 }

  const textColor: Rgba = { r: 255, g: 255, b: 255, a: 255 }
  const textHaloColor: Rgba = { r: 10, g: 12, b: 16, a: 165 }

  const cy = logicalHeight / 2
  const stroke = 1.1
  const bodyR = showPercentage ? 3.2 : 2.6
  const innerInset = showPercentage ? 1.45 : 1.75
  const innerHx = batteryW / 2 - innerInset
  const innerHy = batteryH / 2 - innerInset
  const innerR = Math.max(1.1, bodyR - innerInset)
  const aa = 0.72 / scale

  // Precompute per-item layout and glyph positions
  const slots = items.map((item, idx) => {
    const startX = paddingX + idx * (itemW + itemGap)
    const iconCx = startX + iconSize / 2
    const batteryLeft = startX + iconSize + iconToBatteryGap
    const batteryCx = batteryLeft + batteryW / 2
    const capCx = batteryLeft + batteryW + capGap + capW / 2
    const capHy = showPercentage ? 2.6 : 2.2

    const pct =
      item.status === 'ok' && item.remainingPct !== null
        ? Math.max(0, Math.min(100, Math.round(item.remainingPct)))
        : null

    const innerLeft = batteryCx - innerHx
    const innerSpanW = innerHx * 2
    const fillRight =
      pct !== null && pct > 0
        ? innerLeft + Math.max(2.2, (innerSpanW * pct) / 100)
        : innerLeft

    const fillColor = (showPercentage ? FILL_COLORS_WITH_TEXT : FILL_COLORS_PLAIN)[item.level]

    const label =
      pct !== null ? `${pct}%` : item.status === 'auth_required' || item.status === 'error' ? '!' : '--'

    const isFourChar = label.length >= 4
    const glyphH = isFourChar ? 7.3 : 7.8
    const digitW = isFourChar ? 4.35 : 4.75
    const tracking = isFourChar ? 0.95 : 1.15
    const glyphTop = cy - glyphH / 2
    const glyphs = showPercentage
      ? layoutCenteredText(label, batteryCx, digitW, tracking)
      : []

    return {
      id: item.id,
      startX,
      endX: startX + itemW + 1,
      iconCx,
      batteryCx,
      capCx,
      capHy,
      hasFill: pct !== null && pct > 0,
      fillRight,
      fillColor,
      glyphs,
      glyphH,
      glyphTop,
      strokeRadius: isFourChar ? 0.62 : 0.67
    }
  })

  for (const slot of slots) {
    const pxStart = Math.max(0, Math.floor((slot.startX - 1) * scale))
    const pxEnd = Math.min(pixelWidth, Math.ceil((slot.endX + 1) * scale))

    for (let py = 0; py < pixelHeight; py += 1) {
      const ly = (py + 0.5) / scale
      for (let px = pxStart; px < pxEnd; px += 1) {
        const lx = (px + 0.5) / scale
        const offset = (py * pixelWidth + px) * 4

        // 1. Platform distinguishing icon on the left
        if (lx <= slot.iconCx + iconRadius + 1.5) {
          const iconDist = sdProviderIcon(slot.id, lx, ly, slot.iconCx, cy, iconRadius)
          const iconCov = Math.max(0, Math.min(1, 0.5 - iconDist / aa))
          if (iconCov > 0) {
            blendPixel(rgba, offset, iconColor, iconCov)
          }
        }

        // 2. Battery capsule & fill bar & embedded percentage text
        if (lx >= slot.batteryCx - batteryW / 2 - 1.5) {
          const innerDist = sdRoundedBox(lx, ly, slot.batteryCx, cy, innerHx, innerHy, innerR)
          const trackCov = Math.max(0, Math.min(1, 0.5 - innerDist / aa))
          if (trackCov > 0) {
            blendPixel(rgba, offset, trackBgColor, trackCov)
          }

          if (slot.hasFill) {
            // Clip fill neatly to the inner rounded capsule on left & straight edge on fillRight
            const fillDist = Math.max(innerDist, lx - slot.fillRight)
            const fillCov = Math.max(0, Math.min(1, 0.5 - fillDist / aa))
            if (fillCov > 0) {
              blendPixel(rgba, offset, slot.fillColor, fillCov)
            }
          }

          // Battery outer border ring
          const outerDist = sdRoundedBox(
            lx,
            ly,
            slot.batteryCx,
            cy,
            batteryW / 2,
            batteryH / 2,
            bodyR
          )
          const ringDist = Math.max(outerDist, -(outerDist + stroke))
          const ringCov = Math.max(0, Math.min(1, 0.5 - ringDist / aa))
          if (ringCov > 0) {
            blendPixel(rgba, offset, outlineColor, ringCov)
          }

          // Positive battery terminal cap
          const capDist = sdRoundedBox(lx, ly, slot.capCx, cy, capW / 2, slot.capHy, 0.75)
          const capCov = Math.max(0, Math.min(1, 0.5 - capDist / aa))
          if (capCov > 0) {
            blendPixel(rgba, offset, outlineColor, capCov)
          }

          // Embedded % text inside battery capsule (crisp subtle halo + bright white glyph)
          if (slot.glyphs.length > 0 && innerDist < 0.8) {
            let minGlyphDist = Infinity
            for (const g of slot.glyphs) {
              if (lx < g.x - 2 || lx > g.x + g.w + 2) continue
              const gd = sdGlyphStroke(g.ch, lx, ly, g.x, slot.glyphTop, g.w, slot.glyphH)
              if (gd < minGlyphDist) minGlyphDist = gd
            }

            if (minGlyphDist < slot.strokeRadius + 1.2) {
              const haloDist = minGlyphDist - (slot.strokeRadius + 0.55)
              const haloCov = Math.max(0, Math.min(1, 0.5 - haloDist / aa))
              if (haloCov > 0) {
                blendPixel(rgba, offset, textHaloColor, haloCov)
              }

              const fgDist = minGlyphDist - slot.strokeRadius
              const fgCov = Math.max(0, Math.min(1, 0.5 - fgDist / aa))
              if (fgCov > 0) {
                blendPixel(rgba, offset, textColor, fgCov)
              }
            }
          }
        }
      }
    }
  }

  return {
    logicalWidth,
    logicalHeight,
    pixelWidth,
    pixelHeight,
    png: encodeRgbaToPng(pixelWidth, pixelHeight, rgba)
  }
}

export function formatTrayTooltip(appName: string, items: TrayItemSummary[], names: Record<ProviderId, string>): string {
  if (items.length === 0) return `${appName} · 활성 플랫폼 없음`
  const parts = items.map((item) => {
    const name = names[item.id]
    if (item.status === 'ok' && item.remainingPct !== null) {
      return `${name} ${item.remainingPct}%`
    }
    if (item.status === 'auth_required') {
      return `${name} 재로그인 필요`
    }
    return `${name} 오류`
  })
  return `${appName} · ${parts.join(' · ')}`
}
