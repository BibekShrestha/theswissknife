/**
 * JPEG: a marker walk that also follows the entropy-coded data after each SOS
 * (so APPn/COM segments between progressive scans and data after EOI are
 * seen), and a stripper that copies every byte that is not an APPn/COM
 * segment or trailing data — the frame, tables, scans and EOI go through
 * untouched.
 */
import { ascii, complement, concat, cString, formatBytes, hex, indexOf, putU16be, startsWith, text, u16be, u32be, type Range } from './bytes'
import { EXIF_HEADER, exifBlock, orientationTiff, parseTiff, readOrientation, tiffStart, type ExifContext } from './exif'
import { parseIcc } from './icc'
import { parseIrb } from './iptc'
import type { Block, Row, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

export interface Ctx extends ExifContext {
  depth: number
}

interface Segment {
  /** 0x00 for a run of entropy-coded data. */
  marker: number
  start: number
  end: number
}

type Role = 'exif' | 'xmp' | 'xmp-ext' | 'icc' | 'mpf' | 'photoshop' | 'comment' | 'jfxx' | 'app' | 'jfif' | 'adobe' | 'frame'

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0'
const XMP_EXT_SIG = 'http://ns.adobe.com/xmp/extension/\0'
const ICC_SIG = 'ICC_PROFILE\0'

const isApp = (m: number) => m >= 0xe0 && m <= 0xef

function role(b: Uint8Array, s: Segment): Role {
  const p = s.start + 4
  switch (s.marker) {
    case 0xe0:
      return startsWith(b, p, 'JFIF\0') ? 'jfif' : startsWith(b, p, 'JFXX\0') ? 'jfxx' : 'app'
    case 0xe1:
      return startsWith(b, p, 'Exif\0') ? 'exif' : startsWith(b, p, XMP_SIG) ? 'xmp' : startsWith(b, p, XMP_EXT_SIG) ? 'xmp-ext' : 'app'
    case 0xe2:
      return startsWith(b, p, ICC_SIG) ? 'icc' : startsWith(b, p, 'MPF\0') ? 'mpf' : 'app'
    case 0xed:
      return startsWith(b, p, 'Photoshop 3.0\0') ? 'photoshop' : 'app'
    case 0xee:
      return startsWith(b, p, 'Adobe') ? 'adobe' : 'app'
    case 0xfe:
      return 'comment'
  }
  return isApp(s.marker) ? 'app' : 'frame'
}

/** Whether a segment is metadata — everything a strip may drop. APP0 JFIF and APP14 Adobe steer decoding, so they count as image data. */
const isMetadata = (r: Role) => r !== 'frame' && r !== 'jfif' && r !== 'adobe'

export interface JpegScan {
  segments: Segment[]
  /** End of EOI, or the file length when there is no EOI. */
  imageEnd: number
  warnings: string[]
}

export function scanJpeg(b: Uint8Array): JpegScan {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('Not a JPEG (no start-of-image marker)')
  const segments: Segment[] = []
  const warnings: string[] = []
  let o = 2
  let imageEnd = b.length
  let garbage = 0
  while (o + 1 < b.length) {
    if (b[o] !== 0xff) {
      // Stray bytes between segments; resynchronise on the next 0xFF.
      const next = b.indexOf(0xff, o)
      if (garbage++ === 0) warnings.push(`JPEG: unexpected bytes at ${hex(o)} — skipped to the next marker`)
      if (next < 0) break
      o = next
      continue
    }
    while (b[o + 1] === 0xff && o + 2 < b.length) o++
    const marker = b[o + 1]
    if (marker === 0xd9) {
      segments.push({ marker, start: o, end: o + 2 })
      imageEnd = o + 2
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0x00) {
      segments.push({ marker: 0x100 | marker, start: o, end: o + 2 })
      o += 2
      continue
    }
    if (o + 4 > b.length) {
      warnings.push('JPEG: file ends inside a marker')
      break
    }
    const length = u16be(b, o + 2)
    let end = o + 2 + length
    if (length < 2) {
      warnings.push(`JPEG: segment ${hex(marker, 2)} at ${hex(o)} has an impossible length — stopped reading`)
      imageEnd = b.length
      break
    }
    if (end > b.length) {
      warnings.push(`JPEG: segment ${hex(marker, 2)} at ${hex(o)} runs past the end of the file`)
      end = b.length
    }
    segments.push({ marker, start: o, end })
    o = end
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that is not stuffing (FF00), a restart (FFD0–D7) or fill (FFFF).
      let p = o
      for (;;) {
        p = b.indexOf(0xff, p)
        if (p < 0 || p + 1 >= b.length) {
          p = b.length
          break
        }
        const n = b[p + 1]
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) p += 2
        else if (n === 0xff) p += 1
        else break
      }
      if (p > o) segments.push({ marker: 0, start: o, end: p })
      o = p
    }
  }
  if (!segments.some((s) => s.marker === 0xd9)) warnings.push('JPEG: no end-of-image marker — the file may be truncated')
  return { segments, imageEnd, warnings }
}

const at = (s: Segment) => `${hex(s.start)}`
const appName = (m: number) => (m === 0xfe ? 'COM' : `APP${m - 0xe0}`)

function mpfSections(b: Uint8Array, s: Segment, warnings: string[]): { rows: Row[]; images: number } {
  const start = s.start + 8
  const rows: Row[] = []
  let images = 0
  try {
    const tiff = parseTiff(b, start, s.end)
    warnings.push(...tiff.warnings.map((w) => `MPF: ${w}`))
    const index = tiff.ifds[0]?.entries
    const v = index?.get(0xb000)?.value
    if (v instanceof Uint8Array) rows.push({ key: 'MPF version', value: ascii(v, 0, v.length) })
    const n = index?.get(0xb001)?.value
    images = Array.isArray(n) && typeof n[0] === 'number' ? n[0] : 0
    rows.push({ key: 'Images', value: String(images) })
    const entries = index?.get(0xb002)?.value
    if (entries instanceof Uint8Array) {
      const view = new DataView(entries.buffer, entries.byteOffset, entries.length)
      const TYPES: Record<number, string> = {
        0x030000: 'Baseline primary image',
        0x010001: 'Large thumbnail (VGA)',
        0x010002: 'Large thumbnail (Full HD)',
        0x020001: 'Multi-frame panorama',
        0x020002: 'Multi-frame disparity (depth)',
        0x020003: 'Multi-angle',
        0x000000: 'Undefined',
      }
      for (let i = 0; i * 16 + 16 <= entries.length && i < 32; i++) {
        const attr = view.getUint32(i * 16, tiff.littleEndian)
        const size = view.getUint32(i * 16 + 4, tiff.littleEndian)
        rows.push({ key: `Image ${i + 1}`, value: `${TYPES[attr & 0xffffff] ?? hex(attr & 0xffffff, 6)} · ${formatBytes(size)}` })
      }
    }
  } catch (error) {
    rows.push({ key: 'MPF', value: error instanceof Error ? error.message : String(error) })
  }
  return { rows, images }
}

/** The metadata blocks of a JPEG. `depth` > 0 for embedded JPEGs (thumbnails, appended images), which are not searched further. */
export function jpegBlocks(b: Uint8Array, ctx: Ctx, scan = scanJpeg(b)): Block[] {
  ctx.warnings.push(...(ctx.depth === 0 ? scan.warnings : []))
  const blocks: Block[] = []
  const icc: Segment[] = []
  const ext = new Map<string, Segment[]>()
  const nested = (bytes: Uint8Array, where: string): Block[] => {
    if (ctx.depth > 0) return []
    const sub: Ctx = { warnings: [], depth: ctx.depth + 1 }
    try {
      return jpegBlocks(bytes, sub).map((block) => ({ ...block, where: `${block.where}, ${where}` }))
    } catch {
      return []
    }
  }
  for (const s of scan.segments) {
    if (s.marker > 0xff || s.marker === 0) continue
    const r = role(b, s)
    if (!isMetadata(r)) continue
    const size = s.end - s.start
    const where = `${appName(s.marker)} segment at ${at(s)}`
    switch (r) {
      case 'exif':
        blocks.push(exifBlock(b, tiffStart(b, s.start + 4), s.end, where, { ...ctx, nestedJpeg: nested }, size))
        break
      case 'xmp': {
        const rows = parseXmp(text(b.subarray(s.start + 4 + XMP_SIG.length, s.end)))
        xmpFacts(rows, ctx.facts)
        blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }] })
        break
      }
      case 'xmp-ext': {
        const guid = ascii(b, s.start + 4 + XMP_EXT_SIG.length, s.start + 4 + XMP_EXT_SIG.length + 32)
        ext.set(guid, [...(ext.get(guid) ?? []), s])
        if (ext.get(guid)!.length === 1) blocks.push({ kind: 'xmp', label: 'XMP (extended)', where: guid, size: 0, sections: [] })
        break
      }
      case 'icc':
        icc.push(s)
        if (icc.length === 1) blocks.push({ kind: 'icc', label: 'ICC colour profile', where: '', size: 0, sections: [] })
        break
      case 'mpf': {
        const { rows, images } = mpfSections(b, s, ctx.warnings)
        blocks.push({
          kind: 'mpf',
          label: 'MPF (multi-picture index)',
          where,
          size,
          sections: [{ title: 'Multi-Picture Format', rows }],
          note: images > 1 ? 'Points at extra images stored after the end of the main image.' : undefined,
        })
        break
      }
      case 'photoshop': {
        const irb = parseIrb(b, s.start + 4 + 14, s.end, ctx.warnings, ctx.facts)
        blocks.push({ kind: irb.hasIptc ? 'iptc' : 'photoshop', label: irb.hasIptc ? 'IPTC (Photoshop APP13)' : 'Photoshop resources', where, size, sections: irb.sections })
        break
      }
      case 'comment': {
        const value = text(b.subarray(s.start + 4, s.end)).replace(/\0+$/, '')
        blocks.push({ kind: 'comment', label: 'JPEG comment', where, size, sections: [{ title: 'Comment', rows: [{ key: 'COM', value: value.length > 400 ? `${value.slice(0, 400)}…` : value }] }] })
        break
      }
      case 'jfxx':
        blocks.push({ kind: 'thumbnail', label: 'JFIF extension thumbnail', where, size, sections: [] })
        break
      default: {
        const ident = cString(b, s.start + 4, Math.min(s.end, s.start + 36)).replace(/[^\x20-\x7e]/g, '')
        const label = s.marker === 0xe2 && ident === 'FPXR' ? 'FlashPix (APP2)' : `${appName(s.marker)}${ident ? ` “${ident}”` : ''}`
        blocks.push({ kind: 'other', label, where, size, sections: [] })
      }
    }
  }

  // Multi-segment blocks are filled in once all their parts are known.
  for (const block of blocks) {
    if (block.label === 'ICC colour profile' && icc.length) {
      const parts = [...icc].sort((x, y) => b[x.start + 16] - b[y.start + 16])
      const profile = concat(parts.map((s) => b.subarray(s.start + 18, s.end)))
      const parsed = parseIcc(profile, 0, profile.length)
      block.where = icc.length === 1 ? `APP2 segment at ${at(icc[0])}` : `${icc.length} APP2 segments`
      block.size = icc.reduce((n, s) => n + s.end - s.start, 0)
      block.sections = [{ title: 'Profile', rows: parsed.rows }]
      if (parsed.description && ctx.facts && !ctx.facts.rows.has('Colour profile')) ctx.facts.rows.set('Colour profile', { key: 'Colour profile', value: parsed.description })
    }
    if (block.label === 'XMP (extended)') {
      const segs = ext.get(block.where) ?? []
      const guid = block.where
      const base = (s: Segment) => s.start + 4 + XMP_EXT_SIG.length + 32
      const full = segs.length ? Math.min(u32be(b, base(segs[0])), 16 * 1024 * 1024) : 0
      const assembled = new Uint8Array(full)
      for (const s of segs) {
        const off = u32be(b, base(s) + 4)
        const data = b.subarray(base(s) + 8, s.end)
        if (off + data.length <= full) assembled.set(data, off)
      }
      const rows = parseXmp(text(assembled))
      xmpFacts(rows, ctx.facts)
      block.where = `${segs.length} APP1 segment${segs.length === 1 ? '' : 's'} (GUID ${guid.slice(0, 8)}…)`
      block.size = segs.reduce((n, s) => n + s.end - s.start, 0)
      block.sections = [{ title: 'Extended XMP properties', rows }]
      block.note = 'Overflow from the main XMP packet — depth maps, gain maps and other large values live here.'
    }
  }

  if (scan.imageEnd < b.length) {
    const tail = b.subarray(scan.imageEnd)
    const trailing: Block = {
      kind: 'trailing',
      label: 'Data after end of image',
      where: `${hex(scan.imageEnd)}–${hex(b.length)}`,
      size: tail.length,
      sections: [],
    }
    const notes: string[] = []
    const jpegs: number[] = []
    for (let p = indexOf(tail, '\xff\xd8\xff'); p >= 0 && jpegs.length < 8; p = indexOf(tail, '\xff\xd8\xff', p + 3)) jpegs.push(p)
    if (jpegs.length) notes.push(`${jpegs.length} embedded JPEG${jpegs.length === 1 ? '' : 's'}`)
    const ftyp = indexOf(tail, 'ftyp')
    if (ftyp >= 4) notes.push('an MP4/MOV video (motion photo)')
    trailing.note = notes.length ? `Contains ${notes.join(' and ')} — removed with the rest of the trailer.` : 'Bytes no decoder reads — removed.'
    if (ctx.depth === 0) {
      const inner: Block[] = []
      jpegs.forEach((p, i) => {
        const end = i + 1 < jpegs.length ? jpegs[i + 1] : tail.length
        inner.push(...nested(tail.subarray(p, end), `appended image ${i + 1}`))
      })
      if (inner.length) trailing.nested = inner
    }
    blocks.push(trailing)
  }
  return blocks
}

const metadataRanges = (b: Uint8Array, scan: JpegScan): Range[] =>
  scan.segments.filter((s) => s.marker > 0 && s.marker <= 0xff && isMetadata(role(b, s))).map((s) => [s.start, s.end] as const)

/** Every byte of the main image that is not metadata. Trailing data is not part of it. */
export function jpegImageRanges(b: Uint8Array, scan = scanJpeg(b)): Range[] {
  return complement(scan.imageEnd, metadataRanges(b, scan))
}

/** An APP1 Exif segment holding only the Orientation tag. */
export function orientationSegment(orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = orientationTiff(orientation)
  const seg = new Uint8Array(4 + 6 + tiff.length)
  seg[0] = 0xff
  seg[1] = 0xe1
  putU16be(seg, 2, seg.length - 2)
  for (let i = 0; i < 6; i++) seg[4 + i] = EXIF_HEADER.charCodeAt(i)
  seg.set(tiff, 10)
  return seg
}

export function jpegOrientation(b: Uint8Array, scan = scanJpeg(b)): number | undefined {
  for (const s of scan.segments) {
    if (s.marker === 0xe1 && role(b, s) === 'exif') return readOrientation(b, tiffStart(b, s.start + 4), s.end)
  }
  return undefined
}

export function stripJpeg(b: Uint8Array, options: StripOptions): Stripped {
  const scan = scanJpeg(b)
  const removed: string[] = []
  const kept: string[] = []
  const drop: Range[] = []
  for (const s of scan.segments) {
    if (s.marker === 0 || s.marker > 0xff) continue
    const r = role(b, s)
    if (!isMetadata(r)) continue
    if (r === 'icc' && options.keepIcc) continue
    drop.push([s.start, s.end])
  }
  const counts = new Map<string, number>()
  for (const [s] of drop) {
    const seg = scan.segments.find((x) => x.start === s)!
    const name = `${appName(seg.marker)} ${roleLabel(role(b, seg))}`
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const [name, n] of counts) removed.push(n > 1 ? `${name} ×${n}` : name)
  if (scan.imageEnd < b.length) removed.push(`${formatBytes(b.length - scan.imageEnd)} after end of image`)
  if (options.keepIcc && scan.segments.some((s) => role(b, s) === 'icc')) kept.push('ICC colour profile')

  const ranges = complement(scan.imageEnd, drop)
  const parts = ranges.map(([s, e]) => b.subarray(s, e))
  const orientation = options.keepOrientation ? jpegOrientation(b, scan) : undefined
  if (orientation !== undefined && orientation !== 1) {
    // After SOI, and after APP0 JFIF when there is one (JFIF wants to be first).
    const jfif = scan.segments.find((s) => s.marker === 0xe0 && role(b, s) === 'jfif' && s.start === 2)
    const insertAt = jfif ? jfif.end : 2
    const out: Uint8Array[] = []
    let inserted = false
    for (const [s, e] of ranges) {
      if (!inserted && s <= insertAt && insertAt <= e) {
        out.push(b.subarray(s, insertAt), orientationSegment(orientation), b.subarray(insertAt, e))
        inserted = true
      } else out.push(b.subarray(s, e))
    }
    kept.push(`Orientation ${orientation} (new 36-byte EXIF with that tag only)`)
    return { bytes: concat(out), removed, kept }
  }
  return { bytes: concat(parts), removed, kept }
}

function roleLabel(r: Role): string {
  switch (r) {
    case 'exif':
      return 'EXIF'
    case 'xmp':
      return 'XMP'
    case 'xmp-ext':
      return 'extended XMP'
    case 'icc':
      return 'ICC profile'
    case 'mpf':
      return 'MPF index'
    case 'photoshop':
      return 'Photoshop/IPTC'
    case 'comment':
      return 'comment'
    case 'jfxx':
      return 'JFXX thumbnail'
    default:
      return 'segment'
  }
}

export function jpegInfo(b: Uint8Array, scan = scanJpeg(b)): { width?: number; height?: number } {
  const sof = scan.segments.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc)
  if (!sof || sof.start + 9 > b.length) return {}
  return { height: u16be(b, sof.start + 5), width: u16be(b, sof.start + 7) }
}

