/**
 * GIF: a block walk. Comment extensions and metadata application extensions
 * (XMP, ImageMagick's 8BIM/IPTC, unknown ones) are dropped whole; NETSCAPE
 * looping, graphic control, plain-text and image blocks are copied untouched.
 */
import { ascii, complement, concat, formatBytes, hex, indexOf, startsWith, text, u16le, type Range } from './bytes'
import { parseIcc } from './icc'
import { parseIim, parseIrb } from './iptc'
import type { Ctx } from './jpeg'
import type { Block, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

type Kind = 'comment' | 'xmp' | 'icc' | 'photoshop' | 'iptc' | 'app' | 'keep'

interface GifBlock {
  kind: Kind
  start: number
  end: number
  /** first data byte after the extension header (for app extensions, after the 11-byte identifier) */
  data: number
  ident?: string
}

export const isGif = (b: Uint8Array) => startsWith(b, 0, 'GIF87a') || startsWith(b, 0, 'GIF89a')

/** Skips data sub-blocks from `o`; returns the offset after the terminator, or -1 if the file ends first. */
function skipSubBlocks(b: Uint8Array, o: number): number {
  while (o < b.length) {
    const n = b[o]
    if (n === 0) return o + 1
    o += n + 1
  }
  return -1
}

export function scanGif(b: Uint8Array, warnings: string[] = []) {
  if (!isGif(b)) throw new Error('Not a GIF (bad signature)')
  if (b.length < 13) throw new Error('GIF is too short for a screen descriptor')
  const packed = b[10]
  let o = 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0)
  const blocks: GifBlock[] = []
  let end = b.length
  let trailer = false
  while (o < b.length) {
    const introducer = b[o]
    if (introducer === 0x3b) {
      end = o + 1
      trailer = true
      break
    }
    if (introducer === 0x21) {
      const label = b[o + 1]
      let kind: Kind = 'keep'
      let data = o + 2
      let ident: string | undefined
      if (label === 0xfe) kind = 'comment'
      else if (label === 0xff && b[o + 2] === 11) {
        ident = ascii(b, o + 3, o + 14)
        data = o + 14
        if (ident === 'XMP DataXMP') kind = 'xmp'
        else if (ident === 'ICCRGBG1012') kind = 'icc'
        else if (ident === 'MGK8BIM0000') kind = 'photoshop'
        else if (ident === 'MGKIPTC0000') kind = 'iptc'
        else if (ident === 'NETSCAPE2.0' || ident === 'ANIMEXTS1.0') kind = 'keep'
        else kind = 'app'
      }
      const next = skipSubBlocks(b, data)
      if (next < 0) {
        warnings.push(`GIF: extension at ${hex(o)} runs past the end of the file`)
        blocks.push({ kind, start: o, end: b.length, data, ident })
        end = b.length
        break
      }
      blocks.push({ kind, start: o, end: next, data, ident })
      o = next
      continue
    }
    if (introducer === 0x2c) {
      if (o + 10 > b.length) {
        warnings.push('GIF: file ends inside an image descriptor')
        break
      }
      const lp = b[o + 9]
      const p = o + 10 + (lp & 0x80 ? 3 * (1 << ((lp & 7) + 1)) : 0) + 1
      const next = skipSubBlocks(b, p)
      if (next < 0) {
        warnings.push(`GIF: image data at ${hex(o)} runs past the end of the file`)
        end = b.length
        break
      }
      o = next
      continue
    }
    warnings.push(`GIF: unknown block ${hex(introducer, 2)} at ${hex(o)} — stopped reading`)
    end = o
    break
  }
  if (!trailer) warnings.push('GIF: no trailer byte — the file may be truncated')
  return { blocks, end, width: u16le(b, 6), height: u16le(b, 8) }
}

/** Concatenated sub-block payloads starting at `o`. */
function subBlocks(b: Uint8Array, o: number, end: number): Uint8Array {
  const parts: Uint8Array[] = []
  while (o < end && b[o] !== 0) {
    parts.push(b.subarray(o + 1, Math.min(end, o + 1 + b[o])))
    o += b[o] + 1
  }
  return concat(parts)
}

/** GIF XMP is raw bytes followed by a 257-byte "magic trailer" that makes them parse as sub-blocks. */
function xmpText(b: Uint8Array, g: GifBlock): string {
  const raw = b.subarray(g.data, g.end)
  const close = indexOf(raw, '<?xpacket end=')
  const stop = close >= 0 ? raw.indexOf(0x3e, close) + 1 : indexOf(raw, '</x:xmpmeta>') + 12
  return text(raw.subarray(0, stop > 0 ? stop : Math.max(0, raw.length - 258)))
}

const DROP_LABEL: Record<Kind, string> = {
  comment: 'comment extension',
  xmp: 'XMP application extension',
  icc: 'ICC application extension',
  photoshop: 'Photoshop (8BIM) application extension',
  iptc: 'IPTC application extension',
  app: 'application extension',
  keep: '',
}

export function gifBlocks(b: Uint8Array, ctx: Ctx): { blocks: Block[]; width?: number; height?: number; imageRanges: Range[] } {
  const scan = scanGif(b, ctx.warnings)
  const blocks: Block[] = []
  for (const g of scan.blocks) {
    if (g.kind === 'keep') continue
    const where = `${g.kind === 'comment' ? 'Comment extension' : `Application extension “${g.ident}”`} at ${hex(g.start)}`
    const size = g.end - g.start
    switch (g.kind) {
      case 'comment': {
        const value = text(subBlocks(b, g.data, g.end))
        blocks.push({ kind: 'comment', label: 'GIF comment', where, size, sections: [{ title: 'Comment', rows: [{ key: 'Comment', value: value.length > 400 ? `${value.slice(0, 400)}…` : value }] }] })
        if (ctx.facts && !ctx.facts.rows.has('Description') && value.trim()) ctx.facts.rows.set('Description', { key: 'Description', value: value.slice(0, 200) })
        break
      }
      case 'xmp': {
        const rows = parseXmp(xmpText(b, g))
        xmpFacts(rows, ctx.facts)
        blocks.push({ kind: 'xmp', label: 'XMP', where, size, sections: [{ title: 'XMP properties', rows }] })
        break
      }
      case 'icc': {
        const profile = subBlocks(b, g.data, g.end)
        blocks.push({ kind: 'icc', label: 'ICC colour profile', where, size, sections: [{ title: 'Profile', rows: parseIcc(profile, 0, profile.length).rows }] })
        break
      }
      case 'photoshop':
      case 'iptc': {
        const data = subBlocks(b, g.data, g.end)
        const sections = g.kind === 'iptc' ? [{ title: 'IPTC-IIM', rows: parseIim(data, 0, data.length, ctx.warnings) }] : parseIrb(data, 0, data.length, ctx.warnings, ctx.facts).sections
        blocks.push({ kind: g.kind, label: g.kind === 'iptc' ? 'IPTC' : 'Photoshop resources', where, size, sections })
        break
      }
      default:
        blocks.push({ kind: 'other', label: `Application data “${g.ident ?? '?'}”`, where, size, sections: [] })
    }
  }
  if (scan.end < b.length) blocks.push({ kind: 'trailing', label: 'Data after GIF trailer', where: `${hex(scan.end)}–${hex(b.length)}`, size: b.length - scan.end, sections: [], note: 'Bytes no decoder reads — removed.' })
  const imageRanges = complement(scan.end, scan.blocks.filter((g) => g.kind !== 'keep').map((g) => [g.start, g.end] as const))
  return { blocks, width: scan.width, height: scan.height, imageRanges }
}

export function stripGif(b: Uint8Array, options: StripOptions): Stripped {
  const scan = scanGif(b)
  const removed: string[] = []
  const kept: string[] = []
  const drop: Range[] = []
  const counts = new Map<string, number>()
  for (const g of scan.blocks) {
    if (g.kind === 'keep') continue
    if (g.kind === 'icc' && options.keepIcc) {
      kept.push('ICC colour profile (application extension)')
      continue
    }
    drop.push([g.start, g.end])
    const label = g.kind === 'app' ? `${DROP_LABEL.app} “${g.ident}”` : DROP_LABEL[g.kind]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  for (const [label, n] of counts) removed.push(n > 1 ? `${label} ×${n}` : label)
  if (scan.end < b.length) removed.push(`${formatBytes(b.length - scan.end)} after the trailer`)
  return { bytes: concat(complement(scan.end, drop).map(([s, e]) => b.subarray(s, e))), removed, kept }
}
