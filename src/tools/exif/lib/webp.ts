/**
 * WebP (RIFF), with an allow-list stripper: it keeps VP8, VP8L, VP8X, ALPH,
 * ANIM and ANMF (and ICCP when asked), drops every other chunk — EXIF, XMP,
 * C2PA and anything unknown, inside animation frames too — rewrites the VP8X
 * flags to match what is left, writes pad bytes as zero and fixes the RIFF
 * size. The image chunks are copied untouched.
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

function chunksIn(b: Uint8Array, from: number, to: number, warnings: string[]): RiffChunk[] {
  const chunks: RiffChunk[] = []
  let o = from
  while (o + 8 <= to) {
    const fourcc = ascii(b, o, o + 4)
    const size = u32le(b, o + 4)
    let end = o + 8 + size + (size & 1)
    if (o + 8 + size > to) {
      warnings.push(`WebP: ${fourcc} chunk at ${hex(o)} runs past the end of the RIFF data`)
      end = to
    }
    chunks.push({ fourcc, start: o, data: o + 8, size: Math.min(size, to - o - 8), end: Math.min(end, to) })
    o = end
  }
  return chunks
}

export function scanWebp(b: Uint8Array, warnings: string[] = []) {
  if (!isWebp(b)) throw new Error('Not a WebP (no RIFF/WEBP header)')
  const declared = u32le(b, 4) + 8
  let riffEnd = declared
  if (declared > b.length) {
    warnings.push(`WebP: RIFF size says ${declared} bytes but the file has ${b.length}`)
    riffEnd = b.length
  }
  return { chunks: chunksIn(b, 12, riffEnd, warnings), riffEnd }
}

/** Chunks needed to display the image. ICCP is metadata the "keep colour profile" option may keep. */
const DISPLAY = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF'])
/** Inside an ANMF frame, after its 16-byte header. */
const FRAME_DISPLAY = new Set(['ALPH', 'VP8 ', 'VP8L'])
const ANMF_HEADER = 16

const frameChunks = (b: Uint8Array, anmf: RiffChunk) => chunksIn(b, anmf.data + ANMF_HEADER, anmf.data + anmf.size, [])

/** [start, end of data] — the pad byte is not image data (the copy writes it as zero). */
const body = (c: RiffChunk): Range => [c.start, c.data + c.size]

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

const printable = (fourcc: string) => fourcc.replace(/[^\x20-\x7e]/g, '?').trim()

export function webpBlocks(b: Uint8Array, ctx: Ctx): { blocks: Block[]; width?: number; height?: number; imageRanges: Range[] } {
  const { chunks, riffEnd } = scanWebp(b, ctx.warnings)
  const blocks: Block[] = []
  const imageRanges: Range[] = []
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X')
  const flags = vp8x ? b[vp8x.data] : 0
  let frame = 0
  for (const c of chunks) {
    const where = `${printable(c.fourcc)} chunk at ${hex(c.start)}`
    const size = c.end - c.start
    if (c.fourcc === 'VP8X') {
      // The flags are rewritten by the strip; the canvas size is not.
      if (c.size >= 10) imageRanges.push([c.data + 4, c.data + 10])
      continue
    }
    if (c.fourcc === 'ANMF') {
      frame++
      imageRanges.push([c.data, Math.min(c.data + ANMF_HEADER, c.data + c.size)])
      for (const inner of frameChunks(b, c)) {
        if (FRAME_DISPLAY.has(inner.fourcc)) imageRanges.push(body(inner))
        else blocks.push({ kind: 'other', label: `Chunk “${printable(inner.fourcc)}”`, where: `inside animation frame ${frame} at ${hex(inner.start)}`, size: inner.end - inner.start, sections: [], note: 'Not needed to display the image — removed.' })
      }
      continue
    }
    if (DISPLAY.has(c.fourcc)) {
      imageRanges.push(body(c))
      continue
    }
    if (c.fourcc === 'EXIF') {
      blocks.push(exifBlock(b, tiffStart(b, c.data), c.data + c.size, where, ctx, size))
      if (!(flags & FLAG_EXIF)) ctx.warnings.push('WebP: EXIF chunk present but the VP8X EXIF flag is clear')
    } else if (c.fourcc === 'XMP ') {
      const rows = parseXmp(text(b.subarray(c.data, c.data + c.size)))
      xmpFacts(rows, ctx.facts)
      blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }] })
    } else if (c.fourcc === 'ICCP') {
      const parsed = parseIcc(b, c.data, c.data + c.size)
      blocks.push({ kind: 'icc', label: 'ICC colour profile', where, size, sections: [{ title: 'Profile', rows: parsed.rows }] })
      if (parsed.description && ctx.facts && !ctx.facts.rows.has('Colour profile')) ctx.facts.rows.set('Colour profile', { key: 'Colour profile', value: parsed.description })
    } else if (c.fourcc === 'C2PA') {
      blocks.push({ kind: 'other', label: 'C2PA content credentials', where, size, sections: [], note: 'Not needed to display the image — removed.' })
    } else {
      blocks.push({ kind: 'other', label: `Chunk “${printable(c.fourcc)}”`, where, size, sections: [], note: 'Not needed to display the image — removed.' })
    }
  }
  if (riffEnd < b.length) blocks.push({ kind: 'trailing', label: 'Data after RIFF end', where: `${hex(riffEnd)}–${hex(b.length)}`, size: b.length - riffEnd, sections: [], note: 'Bytes outside the RIFF container — removed.' })
  return { blocks, ...dimensions(b, chunks), imageRanges }
}

function chunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i)
  putU32le(out, 4, data.length)
  out.set(data, 8)
  return out
}

/** A copy of `c` with a zero pad byte. */
const copy = (b: Uint8Array, c: RiffChunk) => chunk(c.fourcc, b.subarray(c.data, c.data + c.size))

export function stripWebp(b: Uint8Array, options: StripOptions): Stripped {
  const { chunks, riffEnd } = scanWebp(b)
  const removed: string[] = []
  const kept: string[] = []
  const counts = new Map<string, number>()
  const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
  const parts: Uint8Array[] = [b.slice(0, 12)]
  let vp8x: Uint8Array | null = null
  let hasIcc = false
  let orientation: number | undefined
  let exifIndex = -1
  for (const c of chunks) {
    if (c.fourcc === 'VP8X') {
      vp8x = copy(b, c)
      parts.push(vp8x)
    } else if (c.fourcc === 'ANMF') {
      const inner = frameChunks(b, c)
      const keep = inner.filter((x) => FRAME_DISPLAY.has(x.fourcc))
      for (const x of inner) if (!keep.includes(x)) count(`${printable(x.fourcc)} chunk in an animation frame`)
      parts.push(chunk('ANMF', concat([b.subarray(c.data, Math.min(c.data + ANMF_HEADER, c.data + c.size)), ...keep.map((x) => copy(b, x))])))
    } else if (DISPLAY.has(c.fourcc)) parts.push(copy(b, c))
    else if (c.fourcc === 'ICCP' && options.keepIcc) {
      parts.push(copy(b, c))
      hasIcc = true
      kept.push('ICCP colour profile')
    } else {
      if (c.fourcc === 'EXIF') {
        if (orientation === undefined) orientation = readOrientation(b, tiffStart(b, c.data), c.data + c.size)
        if (exifIndex < 0) exifIndex = parts.length
      }
      count(`${printable(c.fourcc)} chunk`)
    }
  }
  for (const [name, n] of counts) removed.push(n > 1 ? `${name} ×${n}` : name)
  let exifFlag = false
  if (options.keepOrientation && orientation !== undefined && orientation !== 1 && vp8x) {
    // EXIF belongs after the image data; put it where the old one was.
    parts.splice(exifIndex >= 0 ? exifIndex : parts.length, 0, chunk('EXIF', orientationTiff(orientation)))
    exifFlag = true
    kept.push(`Orientation ${orientation} (new EXIF chunk with that tag only)`)
  }
  if (vp8x && vp8x.length >= 18) {
    // Only the flags that describe what is left; the reserved bits and bytes go to zero.
    let flags = vp8x[8] & (FLAG_ALPHA | FLAG_ANIMATION)
    if (hasIcc) flags |= FLAG_ICC
    if (exifFlag) flags |= FLAG_EXIF
    vp8x.set([flags, 0, 0, 0], 8)
  }
  if (riffEnd < b.length) removed.push(`${formatBytes(b.length - riffEnd)} after the RIFF data`)
  const out = concat(parts)
  putU32le(out, 4, out.length - 8)
  return { bytes: out, removed, kept }
}
