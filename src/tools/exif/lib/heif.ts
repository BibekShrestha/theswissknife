/**
 * HEIF/AVIF (ISO-BMFF). Item payloads are located through `iloc` by absolute
 * offset, so rewriting the file would mean rebuilding that table. Instead the
 * Exif and XMP items are overwritten with zeros in place: the file keeps its
 * length, every offset stays valid, and the item entries remain but carry no
 * data.
 */
import { ascii, complement, concat, cString, formatBytes, hex, text, u16be, u32be, u64be, type Range } from './bytes'
import { exifBlock } from './exif'
import { parseIcc } from './icc'
import type { Ctx } from './jpeg'
import type { Block, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

interface Box {
  type: string
  start: number
  /** payload start (after size/type/largesize) */
  data: number
  end: number
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis', 'mif2', 'MiHE'])

function boxes(b: Uint8Array, start: number, end: number, warnings: string[]): Box[] {
  const out: Box[] = []
  let o = start
  while (o + 8 <= end && out.length < 10000) {
    let size = u32be(b, o)
    const type = ascii(b, o + 4, o + 8)
    let data = o + 8
    if (size === 1) {
      if (o + 16 > end) break
      size = u64be(b, o + 8)
      data = o + 16
    } else if (size === 0) size = end - o
    if (size < data - o || o + size > end) {
      warnings.push(`HEIF: ${type.replace(/[^\x20-\x7e]/g, '?')} box at ${hex(o)} runs past its parent — stopped reading`)
      break
    }
    out.push({ type, start: o, data, end: o + size })
    o += size
  }
  return out
}

export function heifBrand(b: Uint8Array): { major: string; brands: string[] } | null {
  if (b.length < 16 || ascii(b, 4, 8) !== 'ftyp') return null
  const size = Math.min(u32be(b, 0), b.length)
  const brands = [ascii(b, 8, 12)]
  for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, o + 4))
  return { major: brands[0], brands }
}

export const isHeif = (b: Uint8Array) => {
  const brand = heifBrand(b)
  return !!brand && brand.brands.some((x) => HEIF_BRANDS.has(x))
}

interface Item {
  id: number
  type: string
  contentType?: string
  name?: string
  extents: Range[]
}

interface Meta {
  items: Item[]
  icc: { start: number; end: number; where: string }[]
  width?: number
  height?: number
  rotation: boolean
}

function readMeta(b: Uint8Array, warnings: string[]): Meta {
  const top = boxes(b, 0, b.length, warnings)
  if (top.some((x) => x.type === 'moov') && !top.some((x) => x.type === 'meta')) throw new Error('This is a video (it has a moov box and no image items) — video is not supported')
  const meta = top.find((x) => x.type === 'meta')
  if (!meta) throw new Error('HEIF file has no meta box')
  const children = boxes(b, meta.data + 4, meta.end, warnings)
  const items = new Map<number, Item>()
  const icc: Meta['icc'] = []
  let width: number | undefined
  let height: number | undefined
  let rotation = false

  const iinf = children.find((x) => x.type === 'iinf')
  if (iinf) {
    const version = b[iinf.data]
    const first = iinf.data + 4 + (version === 0 ? 2 : 4)
    for (const infe of boxes(b, first, iinf.end, warnings)) {
      if (infe.type !== 'infe') continue
      const v = b[infe.data]
      let p = infe.data + 4
      let id: number
      let type = 'mime'
      if (v >= 2) {
        id = v === 2 ? u16be(b, p) : u32be(b, p)
        p += v === 2 ? 2 : 4
        p += 2 // protection index
        type = ascii(b, p, p + 4)
        p += 4
      } else {
        id = u16be(b, p)
        p += 4
      }
      const name = cString(b, p, infe.end)
      p += name.length + 1
      const contentType = type === 'mime' ? cString(b, p, infe.end) : undefined
      items.set(id, { id, type, name, contentType, extents: [] })
    }
  }

  let idatData = -1
  const idat = children.find((x) => x.type === 'idat')
  if (idat) idatData = idat.data

  const iloc = children.find((x) => x.type === 'iloc')
  if (iloc) {
    const v = b[iloc.data]
    let p = iloc.data + 4
    const sizes = b[p]
    const offsetSize = sizes >> 4
    const lengthSize = sizes & 15
    const baseSize = b[p + 1] >> 4
    const indexSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0
    p += 2
    const read = (n: number) => {
      if (p + n > iloc.end) throw new Error('iloc box is truncated')
      const value = n === 0 ? 0 : n === 4 ? u32be(b, p) : n === 8 ? u64be(b, p) : n === 2 ? u16be(b, p) : NaN
      if (Number.isNaN(value)) throw new Error(`iloc uses an unsupported field size (${n})`)
      p += n
      return value
    }
    try {
      const count = v < 2 ? read(2) : read(4)
      for (let i = 0; i < count && i < 100000; i++) {
        const id = v < 2 ? read(2) : read(4)
        const method = v === 1 || v === 2 ? read(2) & 15 : 0
        read(2) // data reference index
        const base = read(baseSize)
        const extentCount = read(2)
        const extents: Range[] = []
        for (let e = 0; e < extentCount; e++) {
          if (indexSize) read(indexSize)
          const off = read(offsetSize)
          const len = read(lengthSize)
          const startAt = method === 1 ? idatData + base + off : method === 0 ? base + off : -1
          if (method === 1 && idatData < 0) continue
          if (startAt < 0) continue
          const endAt = len === 0 ? b.length : startAt + len
          if (endAt > b.length) {
            warnings.push(`HEIF: item ${id} extent runs past the end of the file`)
            continue
          }
          extents.push([startAt, endAt])
        }
        const item = items.get(id)
        if (item) item.extents = extents
      }
    } catch (error) {
      warnings.push(`HEIF: ${error instanceof Error ? error.message : error}`)
    }
  }

  const iprp = children.find((x) => x.type === 'iprp')
  const ipco = iprp && boxes(b, iprp.data, iprp.end, warnings).find((x) => x.type === 'ipco')
  if (ipco) {
    let area = 0
    for (const prop of boxes(b, ipco.data, ipco.end, warnings)) {
      if (prop.type === 'colr') {
        const kind = ascii(b, prop.data, prop.data + 4)
        if (kind === 'prof' || kind === 'rICC') icc.push({ start: prop.data + 4, end: prop.end, where: `colr property box at ${hex(prop.start)}` })
      } else if (prop.type === 'ispe' && prop.data + 12 <= prop.end) {
        const w = u32be(b, prop.data + 4)
        const h = u32be(b, prop.data + 8)
        if (w * h > area) {
          area = w * h
          width = w
          height = h
        }
      } else if (prop.type === 'irot' || prop.type === 'imir') rotation = true
    }
  }
  return { items: [...items.values()], icc, width, height, rotation }
}

const isXmpItem = (item: Item) => item.type === 'mime' && /rdf\+xml|xmp/i.test(item.contentType ?? '')
const isMetadataItem = (item: Item) => item.type === 'Exif' || isXmpItem(item)

export function heifBlocks(b: Uint8Array, ctx: Ctx) {
  const meta = readMeta(b, ctx.warnings)
  const brand = heifBrand(b)!
  const avif = brand.major === 'avif' || brand.major === 'avis' || (!brand.brands.includes('heic') && brand.brands.includes('avif'))
  const blocks: Block[] = []
  const holes: Range[] = []
  for (const item of meta.items) {
    if (!isMetadataItem(item)) continue
    holes.push(...item.extents)
    const payload = concat(item.extents.map(([s, e]) => b.subarray(s, e)))
    const size = payload.length
    const where = `${item.type === 'Exif' ? 'Exif' : 'XMP (mime)'} item ${item.id}`
    if (payload.every((x) => x === 0)) {
      blocks.push({ kind: item.type === 'Exif' ? 'exif' : 'xmp', label: item.type === 'Exif' ? 'EXIF' : 'XMP', where, size, sections: [], empty: true, note: `Emptied — all ${formatBytes(size)} are zero. The item entry is still listed, but holds no data.` })
      continue
    }
    if (item.type === 'Exif') {
      // A 4-byte offset to the TIFF header, usually skipping "Exif\0\0".
      const skip = payload.length >= 4 ? u32be(payload, 0) : 0
      const at = 4 + skip
      blocks.push(exifBlock(payload, at <= payload.length ? at : 4, payload.length, where, ctx, size))
    } else {
      const rows = parseXmp(text(payload))
      xmpFacts(rows, ctx.facts)
      blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }] })
    }
  }
  for (const p of meta.icc) {
    const parsed = parseIcc(b, p.start, p.end)
    blocks.push({ kind: 'icc', label: 'ICC colour profile', where: p.where, size: p.end - p.start, sections: [{ title: 'Profile', rows: parsed.rows }] })
    if (parsed.description && ctx.facts && !ctx.facts.rows.has('Colour profile')) ctx.facts.rows.set('Colour profile', { key: 'Colour profile', value: parsed.description })
  }
  return {
    blocks,
    width: meta.width,
    height: meta.height,
    imageRanges: complement(b.length, holes),
    formatLabel: avif ? 'AVIF' : `HEIF (${brand.major})`,
    mime: avif ? 'image/avif' : 'image/heic',
  }
}

export function stripHeif(b: Uint8Array, options: StripOptions): Stripped {
  const meta = readMeta(b, [])
  const out = b.slice()
  const removed: string[] = []
  const kept: string[] = []
  for (const item of meta.items) {
    if (!isMetadataItem(item)) continue
    let n = 0
    for (const [s, e] of item.extents) {
      out.fill(0, s, e)
      n += e - s
    }
    removed.push(`${item.type === 'Exif' ? 'Exif' : 'XMP'} item ${item.id} — ${formatBytes(n)} overwritten with zeros in place`)
  }
  if (meta.icc.length) kept.push(options.keepIcc ? 'ICC colour profile (colr box)' : 'ICC colour profile (colr box) — kept anyway: removing it would mean rebuilding the box structure')
  if (meta.rotation) kept.push('Rotation and mirroring (irot/imir boxes, which HEIF uses instead of EXIF Orientation)')
  return { bytes: out, removed, kept }
}
