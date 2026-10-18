/**
 * PNG: chunk walk with CRC checks. Stripping drops whole chunks — eXIf, tEXt,
 * zTXt, iTXt, tIME and (unless kept) iCCP — and copies every other chunk,
 * CRC included, byte for byte.
 */
import { ascii, complement, concat, crc32, formatBytes, hex, inflate, putU32be, startsWith, text, u32be, type Range } from './bytes'
import { exifBlock, orientationTiff, readOrientation, tiffStart } from './exif'
import { parseIcc } from './icc'
import { parseIim, parseIrb, iptcFacts } from './iptc'
import type { Ctx } from './jpeg'
import type { Block, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface Chunk {
  type: string
  start: number
  /** data start */
  data: number
  length: number
  end: number
}

const METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP'])

export const isPng = (b: Uint8Array) => SIGNATURE.every((v, i) => b[i] === v)

export function scanPng(b: Uint8Array, warnings: string[] = []) {
  if (!isPng(b)) throw new Error('Not a PNG (bad signature)')
  const chunks: Chunk[] = []
  let o = 8
  let imageEnd = b.length
  let badCrc = 0
  while (o + 12 <= b.length) {
    const length = u32be(b, o)
    const type = ascii(b, o + 4, o + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) {
      warnings.push(`PNG: garbage where a chunk should start at ${hex(o)} — stopped reading`)
      imageEnd = o
      break
    }
    const end = o + 12 + length
    if (end > b.length) {
      warnings.push(`PNG: ${type} chunk at ${hex(o)} runs past the end of the file`)
      chunks.push({ type, start: o, data: o + 8, length: b.length - o - 8, end: b.length })
      break
    }
    if (crc32(b, o + 4, o + 8 + length) !== u32be(b, o + 8 + length) && badCrc++ < 3) warnings.push(`PNG: ${type} chunk at ${hex(o)} has a bad CRC`)
    chunks.push({ type, start: o, data: o + 8, length, end })
    o = end
    if (type === 'IEND') {
      imageEnd = end
      break
    }
  }
  if (!chunks.some((c) => c.type === 'IEND')) warnings.push('PNG: no IEND chunk — the file may be truncated')
  return { chunks, imageEnd }
}

/** ImageMagick's "Raw profile type …" text: a name line, a length line, then hex. */
function rawProfile(value: string): Uint8Array | null {
  const m = /^\s*\n?\s*\S+\s*\n\s*(\d+)\s*\n([\s\S]*)$/.exec(value)
  if (!m) return null
  const hexDigits = m[2].replace(/[^0-9a-fA-F]/g, '')
  const n = Math.min(Number(m[1]), hexDigits.length >> 1)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = parseInt(hexDigits.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function textChunk(b: Uint8Array, c: Chunk, warnings: string[]): Promise<{ keyword: string; value: string; note?: string }> {
  const data = b.subarray(c.data, c.data + c.length)
  const nul = data.indexOf(0)
  const keyword = ascii(data, 0, nul < 0 ? data.length : nul)
  if (nul < 0) return { keyword, value: '' }
  try {
    if (c.type === 'tEXt') return { keyword, value: new TextDecoder('latin1').decode(data.subarray(nul + 1)) }
    if (c.type === 'zTXt') return { keyword, value: new TextDecoder('latin1').decode(await inflate(data.subarray(nul + 2))) }
    // iTXt: keyword\0 flag method lang\0 translated\0 text
    const compressed = data[nul + 1] === 1
    let p = nul + 3
    const langEnd = data.indexOf(0, p)
    if (langEnd < 0) return { keyword, value: '' }
    const transEnd = data.indexOf(0, langEnd + 1)
    if (transEnd < 0) return { keyword, value: '' }
    p = transEnd + 1
    const body = compressed ? await inflate(data.subarray(p)) : data.subarray(p)
    return { keyword, value: text(body) }
  } catch (error) {
    warnings.push(`PNG: ${c.type} “${keyword}” could not be decompressed (${error instanceof Error ? error.message : error})`)
    return { keyword, value: '', note: 'Compressed text that could not be decompressed.' }
  }
}

const SENSITIVE_KEYWORDS = /author|copyright|comment|source|disclaimer|warning|location|gps/i

export async function pngBlocks(b: Uint8Array, ctx: Ctx): Promise<{ blocks: Block[]; width?: number; height?: number; imageRanges: Range[] }> {
  const { chunks, imageEnd } = scanPng(b, ctx.warnings)
  const blocks: Block[] = []
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  for (const c of chunks) {
    if (!METADATA.has(c.type)) continue
    const where = `${c.type} chunk at ${hex(c.start)}`
    const size = c.end - c.start
    switch (c.type) {
      case 'eXIf':
        blocks.push(exifBlock(b, tiffStart(b, c.data), c.data + c.length, where, ctx, size))
        break
      case 'tIME': {
        const d = b.subarray(c.data, c.data + 7)
        const value = d.length === 7 ? `${(d[0] << 8) | d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')} ${[d[4], d[5], d[6]].map((x) => String(x).padStart(2, '0')).join(':')} UTC` : 'malformed'
        blocks.push({ kind: 'time', label: 'Last-modified time', where, size, sections: [{ title: 'tIME', rows: [{ key: 'Modified', value }] }] })
        if (ctx.facts && !ctx.facts.rows.has('Modified')) ctx.facts.rows.set('Modified', { key: 'Modified', value })
        break
      }
      case 'iCCP': {
        const data = b.subarray(c.data, c.data + c.length)
        const nul = data.indexOf(0)
        const name = ascii(data, 0, nul < 0 ? 0 : nul)
        const block: Block = { kind: 'icc', label: 'ICC colour profile', where, size, sections: [] }
        try {
          const profile = await inflate(data.subarray(nul + 2))
          const parsed = parseIcc(profile, 0, profile.length)
          block.sections.push({ title: `Profile “${name}”`, rows: parsed.rows })
          const desc = parsed.description ?? name
          if (desc && ctx.facts && !ctx.facts.rows.has('Colour profile')) ctx.facts.rows.set('Colour profile', { key: 'Colour profile', value: desc })
        } catch (error) {
          block.note = `Profile “${name}” could not be decompressed (${error instanceof Error ? error.message : error}).`
        }
        blocks.push(block)
        break
      }
      default: {
        const { keyword, value, note } = await textChunk(b, c, ctx.warnings)
        if (keyword === 'XML:com.adobe.xmp') {
          const rows = parseXmp(value)
          xmpFacts(rows, ctx.facts)
          blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }], note })
          break
        }
        const raw = /^Raw profile type (exif|APP1|iptc|xmp)$/i.exec(keyword)
        const bytes = raw ? rawProfile(value) : null
        if (raw && bytes) {
          const kind = raw[1].toLowerCase()
          if (kind === 'exif' || kind === 'app1') {
            const block = exifBlock(bytes, tiffStart(bytes, 0), bytes.length, `${where} (ImageMagick “${keyword}”)`, ctx, size)
            blocks.push(block)
          } else if (kind === 'iptc') {
            const rows = startsWith(bytes, 0, '8BIM') ? null : parseIim(bytes, 0, bytes.length, ctx.warnings)
            const sections = rows ? [{ title: 'IPTC-IIM', rows }] : parseIrb(bytes, 0, bytes.length, ctx.warnings, ctx.facts).sections
            if (rows) iptcFacts(rows, ctx.facts)
            blocks.push({ kind: 'iptc', label: 'IPTC', where: `${where} (ImageMagick “${keyword}”)`, size, sections })
          } else {
            const rows = parseXmp(text(bytes))
            xmpFacts(rows, ctx.facts)
            blocks.push({ kind: 'xmp', label: 'XMP', where: `${where} (ImageMagick “${keyword}”)`, size, sections: [{ title: 'XMP properties', rows }] })
          }
          break
        }
        const shown = value.length > 400 ? `${value.slice(0, 400)}… (${value.length.toLocaleString()} characters)` : value
        blocks.push({
          kind: 'text',
          label: `Text “${keyword}”`,
          where,
          size,
          sections: [{ title: c.type, rows: [{ key: keyword || '(no keyword)', value: shown, sensitive: SENSITIVE_KEYWORDS.test(keyword) }] }],
          note,
        })
        if (/^(Software)$/i.test(keyword) && ctx.facts && !ctx.facts.rows.has('Software')) ctx.facts.rows.set('Software', { key: 'Software', value: shown })
        if (/^(Author)$/i.test(keyword) && ctx.facts && !ctx.facts.rows.has('Artist')) ctx.facts.rows.set('Artist', { key: 'Artist', value: shown, sensitive: true })
        if (/^(Comment|Description)$/i.test(keyword) && ctx.facts && !ctx.facts.rows.has('Description')) ctx.facts.rows.set('Description', { key: 'Description', value: shown })
      }
    }
  }
  if (imageEnd < b.length) blocks.push({ kind: 'trailing', label: 'Data after IEND', where: `${hex(imageEnd)}–${hex(b.length)}`, size: b.length - imageEnd, sections: [], note: 'Bytes no decoder reads — removed.' })
  const imageRanges = complement(imageEnd, chunks.filter((c) => METADATA.has(c.type)).map((c) => [c.start, c.end] as const))
  const width = ihdr && ihdr.length >= 8 ? u32be(b, ihdr.data) : undefined
  const height = ihdr && ihdr.length >= 8 ? u32be(b, ihdr.data + 4) : undefined
  return { blocks, width, height, imageRanges }
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  putU32be(out, 0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  putU32be(out, 8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

export function stripPng(b: Uint8Array, options: StripOptions): Stripped {
  const { chunks, imageEnd } = scanPng(b)
  const removed: string[] = []
  const kept: string[] = []
  const drop: Range[] = []
  const counts = new Map<string, number>()
  let orientation: number | undefined
  for (const c of chunks) {
    if (!METADATA.has(c.type)) continue
    if (c.type === 'iCCP' && options.keepIcc) {
      kept.push('iCCP colour profile')
      continue
    }
    if (c.type === 'eXIf' && orientation === undefined) orientation = readOrientation(b, tiffStart(b, c.data), c.data + c.length)
    drop.push([c.start, c.end])
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
  }
  for (const [type, n] of counts) removed.push(n > 1 ? `${type} chunk ×${n}` : `${type} chunk`)
  if (imageEnd < b.length) removed.push(`${formatBytes(b.length - imageEnd)} after IEND`)
  const ranges = complement(imageEnd, drop)
  const parts = ranges.map(([s, e]) => b.subarray(s, e))
  if (options.keepOrientation && orientation !== undefined && orientation !== 1) {
    // eXIf must come before the first IDAT for decoders to honour it.
    const idat = chunks.find((c) => c.type === 'IDAT')
    if (idat) {
      const out: Uint8Array[] = []
      for (const [s, e] of ranges) {
        if (s <= idat.start && idat.start < e) out.push(b.subarray(s, idat.start), pngChunk('eXIf', orientationTiff(orientation)), b.subarray(idat.start, e))
        else out.push(b.subarray(s, e))
      }
      kept.push(`Orientation ${orientation} (new eXIf chunk with that tag only)`)
      return { bytes: concat(out), removed, kept }
    }
  }
  return { bytes: concat(parts), removed, kept }
}
