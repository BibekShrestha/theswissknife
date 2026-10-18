/**
 * A defensive TIFF/EXIF reader. Every offset is bounds-checked, every IFD is
 * visited at most once (so a next-IFD pointer back to itself cannot loop), the
 * IFD chain and the entry counts are capped, and an entry whose data would run
 * past the block is reported and skipped rather than read.
 */
import { ascii, formatBytes, hex, startsWith, text, utf16 } from './bytes'
import { describeFlash, ENUMS, EXIF_TAGS, GPS_REFS, GPS_TAGS, IFD0_TAGS, INTEROP_TAGS, ORIENTATION, SENSITIVE_TAGS } from './tags'
import type { Block, Gps, Row, Section } from './types'

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 }
/** No real IFD comes near this; a bigger count is garbage or an attack. */
const MAX_ENTRIES = 1000
/** IFD0, IFD1 and the odd IFD2 — a longer chain is a loop that dodged the visited set or garbage. */
const MAX_CHAIN = 4
/** Numeric arrays are only read this far for display. */
const MAX_VALUES = 256

export type IfdName = 'IFD0' | 'ExifIFD' | 'GPS' | 'Interop' | 'IFD1' | 'IFD2' | 'IFD3'

export type Rational = readonly [number, number]
export type Value = string | number[] | Rational[] | Uint8Array

export interface Entry {
  tag: number
  type: number
  count: number
  value: Value
}

export interface Ifd {
  name: IfdName
  offset: number
  entries: Map<number, Entry>
}

export interface Tiff {
  littleEndian: boolean
  ifds: Ifd[]
  warnings: string[]
  /** IFD1's JPEG thumbnail, as absolute offsets into the buffer. */
  thumbnail?: { start: number; end: number }
}

/** Parses the TIFF structure in b[start, end). Throws only when there is no TIFF header at all. */
export function parseTiff(b: Uint8Array, start: number, end = b.length): Tiff {
  end = Math.min(end, b.length)
  const len = end - start
  if (len < 8) throw new Error('EXIF data is too short to hold a TIFF header')
  const order = ascii(b, start, start + 2)
  if (order !== 'II' && order !== 'MM') throw new Error('EXIF data has no TIFF byte-order mark (II or MM)')
  const le = order === 'II'
  const view = new DataView(b.buffer, b.byteOffset + start, len)
  const u16 = (o: number) => view.getUint16(o, le)
  const u32 = (o: number) => view.getUint32(o, le)
  if (u16(2) !== 42) throw new Error('EXIF data has a bad TIFF magic number')

  const warnings: string[] = []
  const visited = new Set<number>()
  const ifds: Ifd[] = []

  const readValue = (type: number, count: number, at: number): Value => {
    switch (type) {
      case 2: {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + at, count)
        const nul = bytes.indexOf(0)
        return text(nul >= 0 ? bytes.subarray(0, nul) : bytes).trim()
      }
      case 1:
      case 6:
      case 7:
        return new Uint8Array(view.buffer, view.byteOffset + at, count)
      case 5:
      case 10: {
        const out: Rational[] = []
        for (let i = 0; i < Math.min(count, MAX_VALUES); i++) {
          const o = at + i * 8
          out.push(type === 5 ? [u32(o), u32(o + 4)] : [view.getInt32(o, le), view.getInt32(o + 4, le)])
        }
        return out
      }
      default: {
        const out: number[] = []
        for (let i = 0; i < Math.min(count, MAX_VALUES); i++) {
          const o = at + i * TYPE_SIZE[type]
          if (type === 3) out.push(u16(o))
          else if (type === 4 || type === 13) out.push(u32(o))
          else if (type === 8) out.push(view.getInt16(o, le))
          else if (type === 9) out.push(view.getInt32(o, le))
          else if (type === 11) out.push(view.getFloat32(o, le))
          else out.push(view.getFloat64(o, le))
        }
        return out
      }
    }
  }

  const readIfd = (offset: number, name: IfdName): { ifd: Ifd; next: number } | null => {
    if (visited.has(offset)) {
      warnings.push(`${name} points back to an IFD already read (offset ${hex(offset)}) — loop ignored`)
      return null
    }
    if (offset < 8 || offset + 2 > len) {
      warnings.push(`${name} offset ${hex(offset)} is outside the EXIF data — skipped`)
      return null
    }
    visited.add(offset)
    let count = u16(offset)
    const fits = Math.floor((len - offset - 2) / 12)
    if (count > fits) {
      warnings.push(`${name} claims ${count} entries but only ${fits} fit — read those`)
      count = fits
    }
    if (count > MAX_ENTRIES) {
      warnings.push(`${name} claims ${count} entries — read the first ${MAX_ENTRIES}`)
      count = MAX_ENTRIES
    }
    const entries = new Map<number, Entry>()
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12
      const tag = u16(e)
      const type = u16(e + 2)
      const n = u32(e + 4)
      const size = TYPE_SIZE[type]
      if (!size) {
        warnings.push(`${name} tag ${hex(tag, 4)} has unknown type ${type} — skipped`)
        continue
      }
      const bytes = size * n
      const at = bytes <= 4 ? e + 8 : u32(e + 8)
      if (at + bytes > len || at < 0) {
        warnings.push(`${name} tag ${tagName(name, tag)} points outside the EXIF data — skipped`)
        continue
      }
      entries.set(tag, { tag, type, count: n, value: readValue(type, n, at) })
    }
    const nextAt = offset + 2 + count * 12
    const next = nextAt + 4 <= len ? u32(nextAt) : 0
    const ifd = { name, offset, entries }
    ifds.push(ifd)
    return { ifd, next }
  }

  const pointer = (ifd: Ifd, tag: number) => {
    const v = ifd.entries.get(tag)?.value
    return Array.isArray(v) && typeof v[0] === 'number' ? (v[0] as number) : null
  }

  const chain: IfdName[] = ['IFD0', 'IFD1', 'IFD2', 'IFD3']
  let next = u32(4)
  let thumbnail: Tiff['thumbnail']
  for (let i = 0; i < MAX_CHAIN && next !== 0; i++) {
    const read = readIfd(next, chain[i])
    if (!read) break
    next = read.next
    const { ifd } = read
    if (i === 0) {
      const exif = pointer(ifd, 0x8769)
      if (exif !== null) {
        const sub = readIfd(exif, 'ExifIFD')
        const interop = sub && pointer(sub.ifd, 0xa005)
        if (interop != null) readIfd(interop, 'Interop')
      }
      const gps = pointer(ifd, 0x8825)
      if (gps !== null) readIfd(gps, 'GPS')
    }
    if (i === 1) {
      const off = pointer(ifd, 0x0201)
      const length = pointer(ifd, 0x0202)
      if (off !== null && length !== null && length > 0) {
        if (off + length <= len) thumbnail = { start: start + off, end: start + off + length }
        else warnings.push('IFD1 thumbnail runs past the EXIF data — not read')
      }
    }
  }
  if (next !== 0 && ifds.length >= MAX_CHAIN) warnings.push(`More than ${MAX_CHAIN} IFDs chained — stopped reading`)
  return { littleEndian: le, ifds, warnings, thumbnail }
}

const TABLES: Record<IfdName, Record<number, string>> = {
  IFD0: IFD0_TAGS,
  IFD1: IFD0_TAGS,
  IFD2: IFD0_TAGS,
  IFD3: IFD0_TAGS,
  ExifIFD: EXIF_TAGS,
  GPS: GPS_TAGS,
  Interop: INTEROP_TAGS,
}

export const tagName = (ifd: IfdName, tag: number) => TABLES[ifd][tag] ?? `Tag ${hex(tag, 4)}`

// ---- value formatting ------------------------------------------------------

const num = (v: Value | undefined): number | undefined => {
  if (Array.isArray(v) && v.length) {
    const first = v[0]
    if (typeof first === 'number') return first
    const [n, d] = first as Rational
    return d === 0 ? undefined : n / d
  }
  if (v instanceof Uint8Array && v.length) return v[0]
  return undefined
}

const nums = (v: Value | undefined): number[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : x[1] === 0 ? NaN : x[0] / x[1])) : v instanceof Uint8Array ? [...v] : []

const trimNum = (n: number, digits = 2) => (Number.isFinite(n) ? String(Number(n.toFixed(digits))) : '—')

function printable(bytes: Uint8Array): string | null {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end--
  if (end === 0) return ''
  for (let i = 0; i < end; i++) if (bytes[i] < 0x20 && bytes[i] !== 9 && bytes[i] !== 10 && bytes[i] !== 13) return null
  return text(bytes.subarray(0, end))
}

export function exposureTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds >= 1) return `${trimNum(seconds, 1)} s`
  return `1/${Math.round(1 / seconds)} s`
}

/** Degrees as 37°46′29.64″ N. */
export function dms(deg: number, positive: string, negative: string): string {
  const hemi = deg < 0 ? negative : positive
  let a = Math.abs(deg)
  let d = Math.floor(a)
  a = (a - d) * 60
  let m = Math.floor(a)
  let s = Number(((a - m) * 60).toFixed(2))
  if (s >= 60) {
    s = 0
    m++
  }
  if (m >= 60) {
    m = 0
    d++
  }
  return `${d}°${String(m).padStart(2, '0')}′${s.toFixed(2).padStart(5, '0')}″ ${hemi}`
}

function gpsCoordinate(v: Value | undefined, ref: Value | undefined, neg: string): number | undefined {
  const parts = nums(v)
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return undefined
  const value = (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600
  return typeof ref === 'string' && ref.toUpperCase().startsWith(neg) ? -value : value
}

function genericValue(entry: Entry): string {
  const v = entry.value
  if (typeof v === 'string') return v
  if (v instanceof Uint8Array) {
    const p = printable(v)
    if (p !== null && p.length > 0) return p.length > 400 ? `${p.slice(0, 400)}… (${v.length} bytes)` : p
    return entry.count <= 8 ? [...v].join(' ') : `${formatBytes(entry.count)} of binary data`
  }
  const values = nums(v).map((n) => trimNum(n, 4))
  const shown = values.slice(0, 16).join(', ')
  return entry.count > 16 ? `${shown}, … (${entry.count} values)` : shown
}

function version(v: Value): string {
  const s = v instanceof Uint8Array ? ascii(v, 0, v.length) : String(v)
  return /^\d{4}$/.test(s) ? `${Number(s.slice(0, 2))}.${s.slice(2)}` : s
}

/** UserComment and GPSProcessingMethod: 8-byte character-code prefix, then the text. */
function codedText(v: Value): string {
  if (!(v instanceof Uint8Array) || v.length < 8) return typeof v === 'string' ? v : ''
  const code = ascii(v, 0, 8).replace(/\0+$/, '')
  const body = v.subarray(8)
  if (code === 'UNICODE') {
    // Spec says UCS-2 in the TIFF byte order; most writers use big-endian regardless. Guess from NULs.
    const le = body.length > 1 && body[1] === 0 && body[0] !== 0
    return utf16(body, le).trim()
  }
  return (printable(body) ?? `${body.length} bytes`).trim()
}

export function formatEntry(ifd: IfdName, entry: Entry, all: Map<number, Entry>): string {
  const name = tagName(ifd, entry.tag)
  const v = entry.value
  const n = num(v)
  if (ifd === 'GPS') {
    switch (name) {
      case 'GPSVersionID':
        return nums(v).join('.')
      case 'GPSLatitude': {
        const deg = gpsCoordinate(v, all.get(0x01)?.value, 'S')
        return deg === undefined ? genericValue(entry) : `${dms(deg, 'N', 'S')} (${deg.toFixed(6)})`
      }
      case 'GPSLongitude': {
        const deg = gpsCoordinate(v, all.get(0x03)?.value, 'W')
        return deg === undefined ? genericValue(entry) : `${dms(deg, 'E', 'W')} (${deg.toFixed(6)})`
      }
      case 'GPSDestLatitude': {
        const deg = gpsCoordinate(v, all.get(0x13)?.value, 'S')
        return deg === undefined ? genericValue(entry) : `${dms(deg, 'N', 'S')} (${deg.toFixed(6)})`
      }
      case 'GPSDestLongitude': {
        const deg = gpsCoordinate(v, all.get(0x15)?.value, 'W')
        return deg === undefined ? genericValue(entry) : `${dms(deg, 'E', 'W')} (${deg.toFixed(6)})`
      }
      case 'GPSAltitude':
        return n === undefined ? genericValue(entry) : `${trimNum(n, 1)} m`
      case 'GPSTimeStamp': {
        const [h, m, s] = nums(v)
        return [h, m].map((x) => String(Math.floor(x ?? 0)).padStart(2, '0')).join(':') + ':' + trimNum(s ?? 0, 3).padStart(2, '0') + ' UTC'
      }
      case 'GPSProcessingMethod':
      case 'GPSAreaInformation':
        return codedText(v)
      case 'GPSImgDirection':
      case 'GPSTrack':
      case 'GPSDestBearing': {
        const ref = all.get(entry.tag - 1)?.value
        const refText = typeof ref === 'string' ? GPS_REFS.GPSImgDirectionRef[ref] : undefined
        return n === undefined ? genericValue(entry) : `${trimNum(n, 1)}°${refText ? ` (${refText})` : ''}`
      }
      case 'GPSSpeed': {
        const ref = all.get(0x0c)?.value
        return n === undefined ? genericValue(entry) : `${trimNum(n, 2)} ${typeof ref === 'string' ? GPS_REFS.GPSSpeedRef[ref] ?? '' : 'km/h'}`.trim()
      }
      case 'GPSHPositioningError':
        return n === undefined ? genericValue(entry) : `${trimNum(n, 1)} m`
    }
    if (typeof v === 'string' && GPS_REFS[name]?.[v]) return `${v} (${GPS_REFS[name][v]})`
  }
  switch (name) {
    case 'ExposureTime':
      return n === undefined ? genericValue(entry) : exposureTime(n)
    case 'FNumber':
      return n === undefined ? genericValue(entry) : `f/${trimNum(n, 1)}`
    case 'ApertureValue':
    case 'MaxApertureValue':
      return n === undefined ? genericValue(entry) : `f/${trimNum(Math.pow(2, n / 2), 1)}`
    case 'ShutterSpeedValue':
      return n === undefined ? genericValue(entry) : exposureTime(Math.pow(2, -n))
    case 'FocalLength':
      return n === undefined ? genericValue(entry) : `${trimNum(n, 1)} mm`
    case 'FocalLengthIn35mmFilm':
      return n === undefined ? genericValue(entry) : `${n} mm`
    case 'ExposureBiasValue':
      return n === undefined ? genericValue(entry) : `${n > 0 ? '+' : ''}${trimNum(n, 2)} EV`
    case 'SubjectDistance':
      return n === undefined ? genericValue(entry) : `${trimNum(n, 2)} m`
    case 'Flash':
      return n === undefined ? genericValue(entry) : describeFlash(n)
    case 'ExifVersion':
    case 'FlashpixVersion':
    case 'InteropVersion':
      return version(v)
    case 'UserComment':
      return codedText(v) || '(empty)'
    case 'MakerNote':
      return `${formatBytes(entry.count)} of camera-maker data (not decoded — it can hold serial numbers)`
    case 'XMP':
      return `${formatBytes(entry.count)} of XMP`
    case 'IPTC-NAA':
      return `${formatBytes(entry.count * (TYPE_SIZE[entry.type] ?? 1))} of IPTC`
    case 'ICCProfile':
      return `${formatBytes(entry.count)} ICC profile`
    case 'PrintIM':
      return `${formatBytes(entry.count)} of print-matching data`
    case 'Padding':
      return `${formatBytes(entry.count)} of padding`
    case 'XPTitle':
    case 'XPComment':
    case 'XPAuthor':
    case 'XPKeywords':
    case 'XPSubject':
      return v instanceof Uint8Array ? utf16(v, true) : genericValue(entry)
    case 'LensSpecification': {
      const [a, b2, c, d] = nums(v)
      const focal = a === b2 ? `${trimNum(a, 1)} mm` : `${trimNum(a, 1)}–${trimNum(b2, 1)} mm`
      const ap = !Number.isFinite(c) ? '' : c === d || !Number.isFinite(d) ? ` f/${trimNum(c, 1)}` : ` f/${trimNum(c, 1)}–${trimNum(d, 1)}`
      return focal + ap
    }
    case 'XResolution':
    case 'YResolution':
      return n === undefined ? genericValue(entry) : trimNum(n, 2)
    case 'ComponentsConfiguration':
      return v instanceof Uint8Array ? [...v].map((c) => ['', 'Y', 'Cb', 'Cr', 'R', 'G', 'B'][c] ?? '-').join('') : genericValue(entry)
    case 'ThumbnailOffset':
      return n === undefined ? genericValue(entry) : `offset ${n}`
    case 'ThumbnailLength':
      return n === undefined ? genericValue(entry) : formatBytes(n)
  }
  const table = ENUMS[name]
  if (table && n !== undefined && entry.count === 1) return table[n] ? `${table[n]} (${n})` : String(n)
  return genericValue(entry)
}

// ---- facts and blocks --------------------------------------------------------

/** What every parser feeds into the summary card. First writer wins, so EXIF beats XMP beats IPTC. */
export interface Facts {
  rows: Map<string, Row>
  gps?: Gps
  orientation?: number
}

export const newFacts = (): Facts => ({ rows: new Map() })

export function setFact(facts: Facts | undefined, key: string, value: string | undefined, sensitive = false) {
  if (!facts || !value || facts.rows.has(key)) return
  facts.rows.set(key, { key, value, sensitive })
}

const IFD_TITLES: Record<IfdName, string> = {
  IFD0: 'IFD0 — main image',
  ExifIFD: 'Exif IFD — capture settings',
  GPS: 'GPS IFD — location',
  Interop: 'Interoperability IFD',
  IFD1: 'IFD1 — thumbnail',
  IFD2: 'IFD2',
  IFD3: 'IFD3',
}

function exifFacts(tiff: Tiff, facts: Facts) {
  const get = (name: IfdName, tag: number) => tiff.ifds.find((i) => i.name === name)?.entries.get(tag)
  const str = (name: IfdName, tag: number) => {
    const v = get(name, tag)?.value
    return typeof v === 'string' && v ? v : undefined
  }
  const fmt = (name: IfdName, tag: number) => {
    const ifd = tiff.ifds.find((i) => i.name === name)
    const e = ifd?.entries.get(tag)
    return e && ifd ? formatEntry(name, e, ifd.entries) : undefined
  }

  const make = str('IFD0', 0x010f)
  const model = str('IFD0', 0x0110)
  const camera = model && make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model ?? make
  setFact(facts, 'Camera', camera)
  const lensMake = str('ExifIFD', 0xa433)
  const lensModel = str('ExifIFD', 0xa434)
  setFact(facts, 'Lens', lensModel ? (lensMake && !lensModel.startsWith(lensMake) ? `${lensMake} ${lensModel}` : lensModel) : fmt('ExifIFD', 0xa432))

  const stamp = (dt: number, sub: number, off: number) => {
    const d = str('ExifIFD', dt) ?? (dt === 0x9003 ? undefined : undefined)
    if (!d) return undefined
    const s = str('ExifIFD', sub)
    const o = str('ExifIFD', off)
    return `${d}${s ? `.${s}` : ''}${o ? ` ${o}` : ''}`
  }
  setFact(facts, 'Taken', stamp(0x9003, 0x9291, 0x9011))
  setFact(facts, 'Digitised', stamp(0x9004, 0x9292, 0x9012))
  const modified = str('IFD0', 0x0132)
  if (modified) setFact(facts, 'Modified', `${modified}${str('ExifIFD', 0x9010) ? ` ${str('ExifIFD', 0x9010)}` : ''}`)

  const exposure = [fmt('ExifIFD', 0x829a), fmt('ExifIFD', 0x829d), get('ExifIFD', 0x8827) ? `ISO ${num(get('ExifIFD', 0x8827)!.value)}` : undefined, fmt('ExifIFD', 0x920a)]
    .filter(Boolean)
    .join(' · ')
  const equiv = num(get('ExifIFD', 0xa405)?.value)
  setFact(facts, 'Exposure', exposure ? `${exposure}${equiv ? ` (${equiv} mm equiv.)` : ''}` : undefined)
  setFact(facts, 'Flash', fmt('ExifIFD', 0x9209))
  setFact(facts, 'Software', str('IFD0', 0x0131))
  setFact(facts, 'Artist', str('IFD0', 0x013b) ?? str('ExifIFD', 0xa437), true)
  setFact(facts, 'Copyright', str('IFD0', 0x8298), true)
  setFact(facts, 'Owner', str('ExifIFD', 0xa430), true)
  setFact(facts, 'Camera serial', str('ExifIFD', 0xa431), true)
  setFact(facts, 'Lens serial', str('ExifIFD', 0xa435), true)
  setFact(facts, 'Image ID', str('ExifIFD', 0xa420), true)
  setFact(facts, 'Description', str('IFD0', 0x010e))
  if (get('ExifIFD', 0x927c)) setFact(facts, 'MakerNote', fmt('ExifIFD', 0x927c), true)

  const orientation = num(get('IFD0', 0x0112)?.value)
  if (orientation !== undefined && facts.orientation === undefined) {
    facts.orientation = orientation
    setFact(facts, 'Orientation', ORIENTATION[orientation] ? `${ORIENTATION[orientation]} (${orientation})` : String(orientation))
  }

  const gps = tiff.ifds.find((i) => i.name === 'GPS')
  if (gps && !facts.gps) {
    const lat = gpsCoordinate(gps.entries.get(0x02)?.value, gps.entries.get(0x01)?.value, 'S')
    const lon = gpsCoordinate(gps.entries.get(0x04)?.value, gps.entries.get(0x03)?.value, 'W')
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      let alt = num(gps.entries.get(0x06)?.value)
      if (alt !== undefined && num(gps.entries.get(0x05)?.value) === 1) alt = -alt
      facts.gps = { lat, lon, alt: alt !== undefined && Number.isFinite(alt) ? alt : undefined }
    }
    const date = gps.entries.get(0x1d)?.value
    const time = gps.entries.get(0x07)
    if (time) setFact(facts, 'GPS time', `${typeof date === 'string' ? `${date} ` : ''}${formatEntry('GPS', time, gps.entries)}`, true)
    const dir = gps.entries.get(0x11)
    if (dir) setFact(facts, 'Facing', formatEntry('GPS', dir, gps.entries), true)
  }
}

export interface ExifContext {
  facts?: Facts
  warnings: string[]
  /** Parses an embedded JPEG (the IFD1 thumbnail) for its own metadata. */
  nestedJpeg?: (b: Uint8Array, where: string) => Block[]
}

/** True for what "Keep orientation" writes: IFD0 with Orientation and nothing else. */
export const isOrientationOnly = (tiff: Tiff) =>
  tiff.ifds.length === 1 && tiff.ifds[0].name === 'IFD0' && tiff.ifds[0].entries.size === 1 && tiff.ifds[0].entries.has(0x0112)

/**
 * Builds the EXIF block for the TIFF structure at b[start, end). On a TIFF
 * header that cannot be read it still returns a block (it is metadata and it
 * gets stripped) with the reason as a note.
 */
export function exifBlock(b: Uint8Array, start: number, end: number, where: string, ctx: ExifContext, size = end - start): Block {
  const block: Block = { kind: 'exif', label: 'EXIF', where, size, sections: [] }
  let tiff: Tiff
  try {
    tiff = parseTiff(b, start, end)
  } catch (error) {
    block.note = error instanceof Error ? error.message : String(error)
    return block
  }
  ctx.warnings.push(...tiff.warnings.map((w) => `EXIF: ${w}`))
  block.sections.push({ title: 'Byte order', rows: [{ key: 'TIFF header', value: tiff.littleEndian ? 'II — little-endian (Intel)' : 'MM — big-endian (Motorola)' }] })
  for (const ifd of tiff.ifds) {
    const rows: Row[] = []
    for (const entry of ifd.entries.values()) {
      if (ifd.name === 'IFD0' && (entry.tag === 0x8769 || entry.tag === 0x8825)) continue
      if (ifd.name === 'ExifIFD' && entry.tag === 0xa005) continue
      const key = tagName(ifd.name, entry.tag)
      rows.push({ key, value: formatEntry(ifd.name, entry, ifd.entries), sensitive: ifd.name === 'GPS' || SENSITIVE_TAGS.has(key) })
    }
    const section: Section = { title: IFD_TITLES[ifd.name], rows }
    block.sections.push(section)
  }
  block.orientationOnly = isOrientationOnly(tiff)
  exifFacts(tiff, ctx.facts ?? newFacts())
  if (tiff.thumbnail) {
    const { start: ts, end: te } = tiff.thumbnail
    const thumbRows = block.sections.find((s) => s.title === IFD_TITLES.IFD1)?.rows
    const isJpeg = b[ts] === 0xff && b[ts + 1] === 0xd8
    thumbRows?.push({ key: 'Thumbnail', value: `${formatBytes(te - ts)} ${isJpeg ? 'JPEG' : 'data'} — a small copy of the photo, as it was before any crop or edit` })
    if (isJpeg && ctx.nestedJpeg) {
      const nested = ctx.nestedJpeg(b.subarray(ts, te), 'inside the IFD1 thumbnail')
      if (nested.length) block.nested = nested
    }
  }
  return block
}

/** Reads the Orientation tag from TIFF data without building a block. */
export function readOrientation(b: Uint8Array, start: number, end: number): number | undefined {
  try {
    const v = parseTiff(b, start, end).ifds.find((i) => i.name === 'IFD0')?.entries.get(0x0112)?.value
    return num(v)
  } catch {
    return undefined
  }
}

/**
 * The smallest EXIF that keeps a photo upright: a TIFF header and IFD0 with
 * one entry, Orientation. Big-endian, like most cameras. 26 bytes.
 */
export function orientationTiff(orientation: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(26)
  const v = new DataView(out.buffer)
  out.set([0x4d, 0x4d], 0)
  v.setUint16(2, 42)
  v.setUint32(4, 8)
  v.setUint16(8, 1)
  v.setUint16(10, 0x0112)
  v.setUint16(12, 3)
  v.setUint32(14, 1)
  v.setUint16(18, orientation)
  v.setUint32(22, 0)
  return out
}

export const EXIF_HEADER = 'Exif\0\0'

/** Offset of the TIFF header in an EXIF payload that may or may not start with "Exif\0\0". */
export function tiffStart(b: Uint8Array, start: number): number {
  if (startsWith(b, start, 'Exif\0')) return start + 6
  return start
}

