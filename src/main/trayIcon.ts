import { deflateSync } from 'node:zlib'
import type { EnergyLevel, TraySummary } from '../shared/types'

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

const LOGICAL_WIDTH = 24
const LOGICAL_HEIGHT = 16

const FILL_COLORS: Record<EnergyLevel, Rgba> = {
  high: { r: 34, g: 197, b: 94, a: 255 }, // #22c55e (여유)
  medium: { r: 245, g: 158, b: 11, a: 255 }, // #f59e0b (주의)
  low: { r: 239, g: 68, b: 68, a: 255 }, // #ef4444 (경고)
  unknown: { r: 148, g: 163, b: 184, a: 215 } // #94a3b8 (미확인)
}

// Signed distance to axis-aligned rounded rectangle centered at (cx, cy) with half-sizes (hx, hy) and radius r
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

export function renderBatteryIconPng(options: BatteryIconRenderOptions): Buffer {
  const { percentage, level, isDarkTheme, scale } = options
  const width = LOGICAL_WIDTH * scale
  const height = LOGICAL_HEIGHT * scale
  const rgba = new Uint8Array(width * height * 4)

  const outlineColor: Rgba = isDarkTheme
    ? { r: 244, g: 244, b: 245, a: 235 }
    : { r: 24, g: 24, b: 27, a: 225 }

  const trackBgColor: Rgba = isDarkTheme
    ? { r: 255, g: 255, b: 255, a: 28 }
    : { r: 24, g: 24, b: 27, a: 22 }

  const fillColor = FILL_COLORS[level]

  // Battery geometry in logical coordinates (24x16)
  const bodyCx = 10.5
  const bodyCy = 8
  const bodyHx = 9.0 // spans x: 1.5 .. 19.5 (width 18)
  const bodyHy = 5.5 // spans y: 2.5 .. 13.5 (height 11)
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

  // Anti-alias edge width in logical units
  const aa = 0.7 / scale

  for (let py = 0; py < height; py += 1) {
    const ly = (py + 0.5) / scale
    for (let px = 0; px < width; px += 1) {
      const lx = (px + 0.5) / scale
      const offset = (py * width + px) * 4

      // Subtle inner track background
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

      // Dynamic fill bar proportional to remaining %
      if (fillW > 0) {
        const fillDist = sdRoundedBox(lx, ly, fillCx, bodyCy, fillW / 2, fillHy, fillR)
        const fillCov = Math.max(0, Math.min(1, 0.5 - fillDist / aa))
        if (fillCov > 0) {
          blendPixel(rgba, offset, fillColor, fillCov)
        }
      }

      // Battery outline ring
      const outerDist = sdRoundedBox(lx, ly, bodyCx, bodyCy, bodyHx, bodyHy, bodyR)
      const ringDist = Math.max(outerDist, -(outerDist + stroke))
      const ringCov = Math.max(0, Math.min(1, 0.5 - ringDist / aa))
      if (ringCov > 0) {
        blendPixel(rgba, offset, outlineColor, ringCov)
      }

      // Positive battery terminal cap on the right
      const capDist = sdRoundedBox(lx, ly, capCx, capCy, capHx, capHy, capR)
      const capCov = Math.max(0, Math.min(1, 0.5 - capDist / aa))
      if (capCov > 0) {
        blendPixel(rgba, offset, outlineColor, capCov)
      }
    }
  }

  return encodeRgbaToPng(width, height, rgba)
}

export function formatMacTrayTitle(summary: TraySummary, showTrayPercentage: boolean): string {
  if (!showTrayPercentage) return ''
  if (summary.lowestRemainingPct === null) return ' --%'
  return ` ${summary.lowestRemainingPct}%`
}
