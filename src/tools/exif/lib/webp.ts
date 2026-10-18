/**
 * WebP (RIFF): drops the EXIF and "XMP " chunks (and ICCP unless kept),
 * clears the matching VP8X flags, and rewrites the RIFF size. The VP8, VP8L,
 * ALPH, ANIM and ANMF chunks are copied untouched.
 */
import { ascii, concat, formatBytes, hex, putU32le, startsWith, text, u16le, u32le, type Range } from './bytes'
import { exifBlock, orientationTiff, readOrientation, tiffStart } from './exif'
import { parseIcc } from './icc'
import type { Ctx } from './jpeg'
import type { Block, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

export const FLAG_ICC = 0x20
export const FLAG_ALPHA = 0x10
export const FLAG_EXIF = 0x08
export const FLAG_XMP = 0x04
export const FLAG_ANIMATION = 0x02

export interface RiffChunk {
  fourcc: string
  start: number
  data: number
  size: number
  /** end including the pad byte */
  end: number
}

export const isWebp = (b: Uint8Array) => startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')

export function scanWebp(b: Uint8Array, warnings: string[] = []) {
  if (!isWebp(b)) throw new Error('Not a WebP (no RIFF/WEBP header)')
  const declared = u32le(b, 4) + 8
  let riffEnd = declared
  if (declared > b.length) {
    warnings.push(`WebP: RIFF size says ${declared} bytes but the file has ${b.length}`)
    riffEnd = b.length
  }
  const chunks: RiffChunk[] = []
  let o = 12
  while (o + 8 <= riffEnd) {
    const fourcc = ascii(b, o, o + 4)
    const size = u32le(b, o + 4)
    let end = o + 8 + size + (size & 1)
    if (o + 8 + size > riffEnd) {
      warnings.push(`WebP: ${fourcc} chunk at ${hex(o)} runs past the end of the RIFF data`)
      end = riffEnd
    }
    chunks.push({ fourcc, start: o, data: o + 8, size: Math.min(size, riffEnd - o - 8), end: Math.min(end, riffEnd) })
    o = end
  }
  return { chunks, riffEnd }
}

const METADATA = new Set(['EXIF', 'XMP ', 'ICCP'])

function dimensions(b: Uint8Array, chunks: RiffChunk[]): { width?: number; height?: number } {
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X')
  const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
  if (vp8x && vp8x.size >= 10) return { width: 1 + u24(vp8x.data + 4), height: 1 + u24(vp8x.data + 7) }
  const vp8 = chunks.find((c) => c.fourcc === 'VP8 ')
  if (vp8 && vp8.size >= 10 && b[vp8.data + 3] === 0x9d) return { width: u16le(b, vp8.data + 6) & 0x3fff, height: u16le(b, vp8.data + 8) & 0x3fff }
  const vp8l = chunks.find((c) => c.fourcc === 'VP8L')
  if (vp8l && vp8l.size >= 5 && b[vp8l.data] === 0x2f) {
    const bits = u32le(b, vp8l.data + 1)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return {}
}

export function webpBlocks(b: Uint8Array, ctx: Ctx): { blocks: Block[]; width?: number; height?: number; imageRanges: Range[] } {
  const { chunks, riffEnd } = scanWebp(b, ctx.warnings)
  const blocks: Block[] = []
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X')
  const flags = vp8x ? b[vp8x.data] : 0
  for (const c of chunks) {
    if (!METADATA.has(c.fourcc)) continue
    const where = `${c.fourcc.trim()} chunk at ${hex(c.start)}`
    const size = c.end - c.start
    if (c.fourcc === 'EXIF') {
      blocks.push(exifBlock(b, tiffStart(b, c.data), c.data + c.size, where, ctx, size))
      if (!(flags & FLAG_EXIF)) ctx.warnings.push('WebP: EXIF chunk present but the VP8X EXIF flag is clear')
    } else if (c.fourcc === 'XMP ') {
      const rows = parseXmp(text(b.subarray(c.data, c.data + c.size)))
      xmpFacts(rows, ctx.facts)
      blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }] })
    } else {
      const parsed = parseIcc(b, c.data, c.data + c.size)
      blocks.push({ kind: 'icc', label: 'ICC colour profile', where, size, sections: [{ title: 'Profile', rows: parsed.rows }] })
      if (parsed.description && ctx.facts && !ctx.facts.rows.has('Colour profile')) ctx.facts.rows.set('Colour profile', { key: 'Colour profile', value: parsed.description })
    }
  }
  if (riffEnd < b.length) blocks.push({ kind: 'trailing', label: 'Data after RIFF end', where: `${hex(riffEnd)}–${hex(b.length)}`, size: b.length - riffEnd, sections: [], note: 'Bytes outside the RIFF container — removed.' })
  const imageRanges = chunks.filter((c) => !METADATA.has(c.fourcc) && c.fourcc !== 'VP8X').map((c) => [c.start, c.end] as const)
  return { blocks, ...dimensions(b, chunks), imageRanges }
}

function chunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i)
  putU32le(out, 4, data.length)
  out.set(data, 8)
  return out
}

export function stripWebp(b: Uint8Array, options: StripOptions): Stripped {
  const { chunks, riffEnd } = scanWebp(b)
  const removed: string[] = []
  const kept: string[] = []
  const parts: Uint8Array[] = [b.slice(0, 12)]
  let flagsAt = -1
  let hasIcc = false
  let orientation: number | undefined
  let exifIndex = -1
  for (const c of chunks) {
    if (c.fourcc === 'EXIF' && orientation === undefined) orientation = readOrientation(b, tiffStart(b, c.data), c.data + c.size)
    if (c.fourcc === 'EXIF' || c.fourcc === 'XMP ' || (c.fourcc === 'ICCP' && !options.keepIcc)) {
      removed.push(`${c.fourcc.trim()} chunk (${formatBytes(c.end - c.start)})`)
      if (c.fourcc === 'EXIF' && exifIndex < 0) exifIndex = parts.length
      continue
    }
    if (c.fourcc === 'ICCP') {
      hasIcc = true
      kept.push('ICCP colour profile')
    }
    if (c.fourcc === 'VP8X') {
      const copy = b.slice(c.start, c.end)
      flagsAt = parts.length
      parts.push(copy)
      continue
    }
    parts.push(b.subarray(c.start, c.end))
  }
  const vp8x = flagsAt >= 0 ? (parts[flagsAt] as Uint8Array) : null
  let exifFlag = false
  if (options.keepOrientation && orientation !== undefined && orientation !== 1 && vp8x) {
    // EXIF belongs after the image data; put it where the old one was.
    parts.splice(exifIndex >= 0 ? exifIndex : parts.length, 0, chunk('EXIF', orientationTiff(orientation)))
    exifFlag = true
    kept.push(`Orientation ${orientation} (new EXIF chunk with that tag only)`)
  }
  if (vp8x) {
    let flags = vp8x[8] & ~(FLAG_EXIF | FLAG_XMP)
    if (!hasIcc) flags &= ~FLAG_ICC
    if (exifFlag) flags |= FLAG_EXIF
    vp8x[8] = flags
  }
  if (riffEnd < b.length) removed.push(`${formatBytes(b.length - riffEnd)} after the RIFF data`)
  const out = concat(parts)
  putU32le(out, 4, out.length - 8)
  return { bytes: out, removed, kept }
}

