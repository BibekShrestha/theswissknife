/**
 * JPEG: a marker walk that also follows the entropy-coded data after each SOS
 * (so APPn/COM segments between progressive scans and data after EOI are
 * seen), and an allow-list stripper. The output is SOI, the frame, tables,
 * scans and EOI byte for byte, plus APP0 JFIF and APP14 Adobe cut down to the
 * fields that steer decoding — and nothing else. Every other APPn, COM,
 * unknown marker, stray or fill byte between segments and byte after EOI is
 * dropped, and the analysis lists each of them, so the re-parse of the output
 * covers everything that was there.
 */
import { ascii, concat, cString, formatBytes, hex, indexOf, putU16be, startsWith, text, u16be, u32be, type Range } from './bytes'
import { EXIF_HEADER, exifBlock, orientationTiff, parseTiff, readOrientation, tiffStart, type ExifContext } from './exif'
import { parseIcc } from './icc'
import { parseIrb } from './iptc'
import type { Block, Row, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

export interface Ctx extends ExifContext {
  depth: number
}

interface Segment {
  /** 0x00 for a run of entropy-coded data; 0x100 | marker for a standalone marker (RSTn, TEM, FF00) outside a scan. */
  marker: number
  start: number
  end: number
}

type Role = 'exif' | 'xmp' | 'xmp-ext' | 'icc' | 'mpf' | 'photoshop' | 'comment' | 'jfxx' | 'app' | 'jfif' | 'adobe' | 'frame' | 'unknown'

const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0'
const XMP_EXT_SIG = 'http://ns.adobe.com/xmp/extension/\0'
const ICC_SIG = 'ICC_PROFILE\0'

/** Extended XMP read per file, across every GUID — the declared lengths are attacker-chosen. */
export const XMP_EXT_LIMIT = 32 * 1024 * 1024

/**
 * Markers a decoder needs: SOFn (baseline, progressive, lossless, arithmetic,
 * hierarchical), DHT, DAC, EOI, SOS, DQT, DNL, DRI, DHP, EXP and JPEG-LS's
 * SOF55/LSE. JPG (C8), the other JPGn (F0–FD) and reserved markers are not.
 */
const FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xf7, 0xf8])

/** APP0 JFIF through Ydensity, and APP14 Adobe through the transform byte: the parts that steer decoding. */
const JFIF_CORE = 12
const ADOBE_CORE = 12

const isApp = (m: number) => m >= 0xe0 && m <= 0xef

function role(b: Uint8Array, s: Segment): Role {
  if (s.marker === 0) return 'frame'
  if (s.marker > 0xff) return 'unknown'
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
  if (isApp(s.marker)) return 'app'
  return FRAME.has(s.marker) ? 'frame' : 'unknown'
}

/** What the stripper does with a segment: copy it, cut it to its core, or drop it. */
type Decision = 'keep' | 'jfif' | 'adobe' | 'drop'

/** The allow-list: frame markers are kept, the first JFIF and the first Adobe are cut to their core, everything else goes. */
function decide(b: Uint8Array, segments: Segment[]): Map<Segment, Decision> {
  const out = new Map<Segment, Decision>()
  let jfif = false
  let adobe = false
  for (const s of segments) {
    const r = role(b, s)
    if (r === 'frame') out.set(s, 'keep')
    else if (r === 'jfif' && !jfif && s.end - s.start >= 4 + JFIF_CORE + 2) {
      jfif = true
      out.set(s, 'jfif')
    } else if (r === 'adobe' && !adobe && s.end - s.start >= 4 + ADOBE_CORE) {
      adobe = true
      out.set(s, 'adobe')
    } else out.set(s, 'drop')
  }
  return out
}

export interface JpegScan {
  segments: Segment[]
  /** Bytes outside any segment before imageEnd: garbage the walk skipped, and fill bytes (FF) before markers. */
  stray: Range[]
  /** End of EOI; where the walk stopped on a segment it could not read; or the file length. */
  imageEnd: number
  /** The walk stopped on an unreadable segment — everything from imageEnd on is unread. */
  broken: boolean
  warnings: string[]
}

export function scanJpeg(b: Uint8Array): JpegScan {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('Not a JPEG (no start-of-image marker)')
  const segments: Segment[] = []
  const stray: Range[] = []
  const warnings: string[] = []
  let o = 2
  let imageEnd = b.length
  let broken = false
  let garbage = 0
  while (o + 1 < b.length) {
    if (b[o] !== 0xff) {
      // Stray bytes between segments; resynchronise on the next 0xFF.
      const next = b.indexOf(0xff, o)
      if (garbage++ === 0) warnings.push(`JPEG: unexpected bytes at ${hex(o)} — skipped to the next marker`)
      stray.push([o, next < 0 ? b.length : next])
      if (next < 0) break
      o = next
      continue
    }
    // Fill bytes: any number of FF may precede a marker. Decoders skip them, and so does the copy.
    const fill = o
    while (b[o + 1] === 0xff && o + 2 < b.length) o++
    if (o > fill) stray.push([fill, o])
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
      imageEnd = o
      broken = true
      break
    }
    const length = u16be(b, o + 2)
    let end = o + 2 + length
    if (length < 2) {
      warnings.push(`JPEG: segment ${hex(marker, 2)} at ${hex(o)} has an impossible length — stopped reading`)
      imageEnd = o
      broken = true
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
  return { segments, stray, imageEnd, broken, warnings }
}

const at = (s: Segment) => `${hex(s.start)}`
const appName = (m: number) => (m === 0xfe ? 'COM' : isApp(m) ? `APP${m - 0xe0}` : `Marker ${hex(m & 0xff, 2)}`)

/** Bytes of a kept JFIF/Adobe segment past its core — a JFIF thumbnail, or anything else written there. */
function extras(s: Segment, decision: Decision): number {
  if (decision === 'jfif') return Math.max(0, s.end - (s.start + 4 + JFIF_CORE + 2))
  if (decision === 'adobe') return Math.max(0, s.end - (s.start + 4 + ADOBE_CORE))
  return 0
}

/** The JFIF thumbnail size its header declares, or null. */
function jfifThumbnail(b: Uint8Array, s: Segment): [number, number] | null {
  const xt = b[s.start + 4 + JFIF_CORE]
  const yt = b[s.start + 4 + JFIF_CORE + 1]
  return xt && yt ? [xt, yt] : null
}

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

export interface XmpExtension {
  bytes: Uint8Array
  /** Fewer bytes are present than the header declares (missing or overlapping parts). */
  incomplete: boolean
  /** The per-file budget ran out before this packet was read in full. */
  capped: boolean
}

/**
 * Joins extended-XMP parts in offset order. Only bytes that are actually in
 * the file are copied — never a buffer of the declared length — and the
 * shared `budget` bounds the total across every GUID in the file.
 */
export function assembleExtendedXmp(parts: { offset: number; data: Uint8Array }[], declared: number, budget: { left: number }): XmpExtension {
  const sorted = [...parts].sort((x, y) => x.offset - y.offset)
  const out: Uint8Array[] = []
  let pos = 0
  let length = 0
  let incomplete = false
  let capped = false
  for (const part of sorted) {
    if (length >= declared) break
    let data = part.data
    if (part.offset < pos) data = data.subarray(Math.min(data.length, pos - part.offset))
    else if (part.offset > pos) incomplete = true
    if (!data.length) continue
    data = data.subarray(0, Math.max(0, declared - length))
    if (data.length > budget.left) {
      data = data.subarray(0, budget.left)
      capped = true
    }
    budget.left -= data.length
    out.push(data)
    length += data.length
    pos = Math.max(pos, part.offset) + data.length
    if (capped) break
  }
  if (length < declared) incomplete = true
  return { bytes: concat(out), incomplete, capped }
}

/** The metadata blocks of a JPEG. `depth` > 0 for embedded JPEGs (thumbnails, appended images), which are not searched further. */
export function jpegBlocks(b: Uint8Array, ctx: Ctx, scan = scanJpeg(b)): Block[] {
  ctx.warnings.push(...(ctx.depth === 0 ? scan.warnings : []))
  const blocks: Block[] = []
  const icc: Segment[] = []
  const ext = new Map<string, Segment[]>()
  const decisions = decide(b, scan.segments)
  const stray: Range[] = [...scan.stray]
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
    const decision = decisions.get(s)!
    const r = role(b, s)
    const size = s.end - s.start
    const where = `${appName(s.marker)} segment at ${at(s)}`
    if (decision !== 'drop') {
      const extra = extras(s, decision)
      if (!extra) continue
      if (decision === 'jfif') {
        const thumb = jfifThumbnail(b, s)
        blocks.push({
          kind: thumb ? 'thumbnail' : 'other',
          label: thumb ? 'JFIF thumbnail' : 'Extra bytes in APP0 JFIF',
          where,
          size: extra,
          sections: [],
          note: `${thumb ? `A ${thumb[0]}×${thumb[1]} uncompressed RGB thumbnail` : 'Bytes after the JFIF header'} — removed; the 16-byte JFIF header that steers decoding stays.`,
        })
      } else {
        blocks.push({ kind: 'other', label: 'Extra bytes in APP14 Adobe', where, size: extra, sections: [], note: 'Bytes after the colour-transform flag — removed; the 12 bytes that steer decoding stay.' })
      }
      continue
    }
    if (s.marker > 0xff) {
      stray.push([s.start, s.end])
      continue
    }
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
      case 'jfif':
      case 'adobe':
        blocks.push({ kind: 'other', label: `${appName(s.marker)} ${r === 'jfif' ? 'JFIF' : 'Adobe'} (repeated or too short)`, where, size, sections: [], note: 'Only the first well-formed one is needed to decode.' })
        break
      case 'unknown':
        blocks.push({ kind: 'other', label: `${appName(s.marker)} segment`, where, size, sections: [], note: 'A marker JPEG decoders do not use.' })
        break
      default: {
        const ident = cString(b, s.start + 4, Math.min(s.end, s.start + 36)).replace(/[^\x20-\x7e]/g, '')
        const label = s.marker === 0xe2 && ident === 'FPXR' ? 'FlashPix (APP2)' : `${appName(s.marker)}${ident ? ` “${ident}”` : ''}`
        blocks.push({ kind: 'other', label, where, size, sections: [] })
      }
    }
  }

  // Multi-segment blocks are filled in once all their parts are known.
  const budget = { left: XMP_EXT_LIMIT }
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
      const readable = segs.filter((s) => base(s) + 8 <= s.end)
      const declared = readable.length ? u32be(b, base(readable[0])) : 0
      const assembled = assembleExtendedXmp(
        readable.map((s) => ({ offset: u32be(b, base(s) + 4), data: b.subarray(base(s) + 8, s.end) })),
        declared,
        budget,
      )
      const rows = parseXmp(text(assembled.bytes))
      xmpFacts(rows, ctx.facts)
      block.where = `${segs.length} APP1 segment${segs.length === 1 ? '' : 's'} (GUID ${guid.slice(0, 8)}…)`
      block.size = segs.reduce((n, s) => n + s.end - s.start, 0)
      block.sections = [{ title: 'Extended XMP properties', rows }]
      const notes = ['Overflow from the main XMP packet — depth maps, gain maps and other large values live here.']
      if (assembled.incomplete) notes.push(`Incomplete: ${formatBytes(assembled.bytes.length)} of the ${formatBytes(declared)} its header declares were read.`)
      if (assembled.capped) {
        notes.push(`Only the first ${formatBytes(XMP_EXT_LIMIT)} of extended XMP in a file are read; it is removed in full all the same.`)
        ctx.warnings.push(`JPEG: extended XMP stopped at ${formatBytes(XMP_EXT_LIMIT)}`)
      }
      block.note = notes.join(' ')
    }
  }

  if (stray.length) {
    const size = stray.reduce((n, [s, e]) => n + e - s, 0)
    blocks.push({
      kind: 'other',
      label: 'Bytes between segments',
      where: `${stray.length} place${stray.length === 1 ? '' : 's'}, first at ${hex(Math.min(...stray.map(([s]) => s)))}`,
      size,
      sections: [],
      note: 'Bytes outside any segment (stray data, fill bytes, stand-alone markers). No decoder needs them, but they can carry anything — removed.',
    })
  }

  if (scan.imageEnd < b.length) {
    const tail = b.subarray(scan.imageEnd)
    const trailing: Block = {
      kind: 'trailing',
      label: scan.broken ? 'Unreadable data after a broken segment' : 'Data after end of image',
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
    trailing.note = scan.broken
      ? 'The segment structure breaks here, so these bytes cannot be told apart — they are removed, and the copy may not display.'
      : notes.length
        ? `Contains ${notes.join(' and ')} — removed with the rest of the trailer.`
        : 'Bytes no decoder reads — removed.'
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

/**
 * The bytes that make up the image: SOI, every kept segment, and the core of
 * JFIF and Adobe (their length field and anything past the core are not
 * part of it, since the stripper rewrites those).
 */
export function jpegImageRanges(b: Uint8Array, scan = scanJpeg(b)): Range[] {
  const decisions = decide(b, scan.segments)
  const out: Range[] = [[0, 2]]
  for (const s of scan.segments) {
    const d = decisions.get(s)
    if (d === 'keep') out.push([s.start, s.end])
    else if (d === 'jfif') out.push([s.start + 4, s.start + 4 + JFIF_CORE])
    else if (d === 'adobe') out.push([s.start + 4, s.start + 4 + ADOBE_CORE])
  }
  return out
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

/** A segment of `marker` holding `core` and, for JFIF, a zero thumbnail size. */
function coreSegment(marker: number, core: Uint8Array, tail: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4 + core.length + tail.length)
  out[0] = 0xff
  out[1] = marker
  putU16be(out, 2, out.length - 2)
  out.set(core, 4)
  out.set(tail, 4 + core.length)
  return out
}

export function stripJpeg(b: Uint8Array, options: StripOptions): Stripped {
  const scan = scanJpeg(b)
  const decisions = decide(b, scan.segments)
  const removed: string[] = []
  const kept: string[] = []
  const counts = new Map<string, number>()
  const count = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
  const out: Uint8Array[] = [b.subarray(0, 2)]
  let insertAt = 1
  let keptIcc = false
  let strayBytes = scan.stray.reduce((n, [s, e]) => n + e - s, 0)
  for (const s of scan.segments) {
    const d = decisions.get(s)!
    if (d === 'keep') out.push(b.subarray(s.start, s.end))
    else if (d === 'jfif') {
      out.push(coreSegment(0xe0, b.subarray(s.start + 4, s.start + 4 + JFIF_CORE), [0, 0]))
      // JFIF wants to be first; a new orientation EXIF goes right after it.
      if (out.length === 2) insertAt = 2
      if (extras(s, d)) count(jfifThumbnail(b, s) ? 'APP0 JFIF thumbnail' : 'APP0 JFIF extra bytes')
    } else if (d === 'adobe') {
      out.push(coreSegment(0xee, b.subarray(s.start + 4, s.start + 4 + ADOBE_CORE), []))
      if (extras(s, d)) count('APP14 Adobe extra bytes')
    } else if (s.marker > 0xff) strayBytes += s.end - s.start
    else {
      const r = role(b, s)
      if (r === 'icc' && options.keepIcc) {
        out.push(b.subarray(s.start, s.end))
        keptIcc = true
        continue
      }
      count(`${appName(s.marker)} ${roleLabel(r)}`)
    }
  }
  for (const [name, n] of counts) removed.push(n > 1 ? `${name} ×${n}` : name)
  if (strayBytes) removed.push(`${formatBytes(strayBytes)} between segments`)
  if (scan.imageEnd < b.length) removed.push(`${formatBytes(b.length - scan.imageEnd)} ${scan.broken ? 'of unreadable data after a broken segment' : 'after end of image'}`)
  if (keptIcc) kept.push('ICC colour profile')

  const orientation = options.keepOrientation ? jpegOrientation(b, scan) : undefined
  if (orientation !== undefined && orientation !== 1) {
    out.splice(insertAt, 0, orientationSegment(orientation))
    kept.push(`Orientation ${orientation} (new 36-byte EXIF with that tag only)`)
  }
  return { bytes: concat(out), removed, kept }
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
    case 'jfif':
      return 'JFIF (repeated)'
    case 'adobe':
      return 'Adobe (repeated)'
    default:
      return 'segment'
  }
}

export function jpegInfo(b: Uint8Array, scan = scanJpeg(b)): { width?: number; height?: number } {
  const sof = scan.segments.find((s) => s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc)
  if (!sof || sof.start + 9 > b.length) return {}
  return { height: u16be(b, sof.start + 5), width: u16be(b, sof.start + 7) }
}
