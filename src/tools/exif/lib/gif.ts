/**
 * GIF: a block walk, and an allow-list stripper. It writes the header (with
 * the screen descriptor and global colour table), every image block byte for
 * byte, graphic control extensions cut to their four bytes, and NETSCAPE /
 * ANIMEXTS looping cut to its loop count. Everything else — comments,
 * plain-text extensions, XMP, ICC (unless kept), 8BIM/IPTC, any other or
 * malformed application extension and unknown extension labels — is dropped
 * and listed.
 */
import { ascii, concat, formatBytes, hex, indexOf, startsWith, text, u16le, type Range } from './bytes'
import { parseIcc } from './icc'
import { parseIim, parseIrb } from './iptc'
import type { Ctx } from './jpeg'
import type { Block, StripOptions, Stripped } from './types'
import { parseXmp, xmpFacts } from './xmp'

type Kind = 'comment' | 'xmp' | 'icc' | 'photoshop' | 'iptc' | 'app' | 'badapp' | 'plaintext' | 'unknown' | 'gce' | 'loop' | 'image'

interface GifBlock {
  kind: Kind
  start: number
  end: number
  /** first data byte after the extension header (for app extensions, after the 11-byte identifier) */
  data: number
  ident?: string
  label?: number
  /** For 'loop': where the two loop-count bytes are. */
  loopAt?: number
}

/** A graphic control extension: 21 F9 04, four bytes, terminator. */
const GCE_SIZE = 8
/** A looping extension: 21 FF 0B, the identifier, 03 01, the loop count, terminator. */
const LOOP_SIZE = 19

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

/** The loop-count sub-block (03 01 lo hi) of a looping extension, or -1. */
function loopCount(b: Uint8Array, o: number, end: number): number {
  while (o < end && b[o] !== 0) {
    if (b[o] === 3 && b[o + 1] === 1) return o + 2
    o += b[o] + 1
  }
  return -1
}

export function scanGif(b: Uint8Array, warnings: string[] = []) {
  if (!isGif(b)) throw new Error('Not a GIF (bad signature)')
  if (b.length < 13) throw new Error('GIF is too short for a screen descriptor')
  const packed = b[10]
  const headerEnd = Math.min(b.length, 13 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0))
  let o = headerEnd
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
      let kind: Kind = 'unknown'
      let data = o + 2
      let ident: string | undefined
      if (label === 0xfe) kind = 'comment'
      else if (label === 0xf9) kind = b[o + 2] >= 4 ? 'gce' : 'unknown'
      else if (label === 0x01) kind = 'plaintext'
      else if (label === 0xff && b[o + 2] === 11) {
        ident = ascii(b, o + 3, o + 14)
        data = o + 14
        if (ident === 'XMP DataXMP') kind = 'xmp'
        else if (ident === 'ICCRGBG1012') kind = 'icc'
        else if (ident === 'MGK8BIM0000') kind = 'photoshop'
        else if (ident === 'MGKIPTC0000') kind = 'iptc'
        else if (ident === 'NETSCAPE2.0' || ident === 'ANIMEXTS1.0') kind = 'loop'
        else kind = 'app'
      } else if (label === 0xff) kind = 'badapp'
      const next = skipSubBlocks(b, data)
      if (next < 0) {
        warnings.push(`GIF: extension at ${hex(o)} runs past the end of the file`)
        // Cut short, it cannot be rewritten to its core: it is dropped like any other extension.
        blocks.push({ kind: kind === 'gce' || kind === 'loop' ? 'unknown' : kind, start: o, end: b.length, data, ident, label })
        end = b.length
        break
      }
      const block: GifBlock = { kind, start: o, end: next, data, ident, label }
      if (kind === 'loop') {
        block.loopAt = loopCount(b, data, next)
        if (block.loopAt < 0) block.kind = 'app'
      }
      blocks.push(block)
      o = next
      continue
    }
    if (introducer === 0x2c) {
      if (o + 10 > b.length) {
        warnings.push('GIF: file ends inside an image descriptor')
        blocks.push({ kind: 'image', start: o, end: b.length, data: o })
        end = b.length
        break
      }
      const lp = b[o + 9]
      const p = o + 10 + (lp & 0x80 ? 3 * (1 << ((lp & 7) + 1)) : 0) + 1
      const next = skipSubBlocks(b, p)
      if (next < 0) {
        warnings.push(`GIF: image data at ${hex(o)} runs past the end of the file`)
        blocks.push({ kind: 'image', start: o, end: b.length, data: o })
        end = b.length
        break
      }
      blocks.push({ kind: 'image', start: o, end: next, data: o })
      o = next
      continue
    }
    warnings.push(`GIF: unknown block ${hex(introducer, 2)} at ${hex(o)} — stopped reading`)
    end = o
    break
  }
  if (!trailer) warnings.push('GIF: no trailer byte — the file may be truncated')
  return { headerEnd, blocks, end, trailer, width: u16le(b, 6), height: u16le(b, 8) }
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

/** Bytes a kept extension carries beyond its rewritten core. */
const extra = (g: GifBlock) => (g.kind === 'gce' ? g.end - g.start - GCE_SIZE : g.kind === 'loop' ? g.end - g.start - LOOP_SIZE : 0)

const DROP_LABEL: Record<Kind, string> = {
  comment: 'comment extension',
  xmp: 'XMP application extension',
  icc: 'ICC application extension',
  photoshop: 'Photoshop (8BIM) application extension',
  iptc: 'IPTC application extension',
  app: 'application extension',
  badapp: 'malformed application extension',
  plaintext: 'plain text extension',
  unknown: 'extension',
  gce: '',
  loop: '',
  image: '',
}

export function gifBlocks(b: Uint8Array, ctx: Ctx): { blocks: Block[]; width?: number; height?: number; imageRanges: Range[] } {
  const scan = scanGif(b, ctx.warnings)
  const blocks: Block[] = []
  const imageRanges: Range[] = [[0, scan.headerEnd]]
  for (const g of scan.blocks) {
    const where = `${g.kind === 'comment' ? 'Comment extension' : g.ident !== undefined ? `Application extension “${g.ident}”` : `Extension ${hex(g.label ?? 0, 2)}`} at ${hex(g.start)}`
    const size = g.end - g.start
    switch (g.kind) {
      case 'image':
        imageRanges.push([g.start, g.end])
        break
      case 'gce':
        imageRanges.push([g.start + 3, g.start + 7])
        if (extra(g) > 0) blocks.push({ kind: 'other', label: 'Extra data in a graphic control extension', where, size: extra(g), sections: [], note: 'Bytes past the four that set delay, disposal and transparency — removed.' })
        break
      case 'loop':
        imageRanges.push([g.loopAt!, g.loopAt! + 2])
        if (extra(g) > 0) blocks.push({ kind: 'other', label: 'Extra data in the looping extension', where, size: extra(g), sections: [], note: 'Bytes past the loop count — removed; the loop count stays.' })
        break
      case 'comment': {
        const value = text(subBlocks(b, g.data, g.end))
        blocks.push({ kind: 'comment', label: 'GIF comment', where, size, sections: [{ title: 'Comment', rows: [{ key: 'Comment', value: value.length > 400 ? `${value.slice(0, 400)}…` : value }] }] })
        if (ctx.facts && !ctx.facts.rows.has('Description') && value.trim()) ctx.facts.rows.set('Description', { key: 'Description', value: value.slice(0, 200) })
        break
      }
      case 'plaintext': {
        // A 12-byte grid/colour header sub-block, then the text.
        const value = text(subBlocks(b, g.data + 1 + (b[g.data] ?? 0), g.end))
        blocks.push({ kind: 'text', label: 'GIF plain text', where, size, sections: [{ title: 'Plain text extension', rows: [{ key: 'Text', value: value.length > 400 ? `${value.slice(0, 400)}…` : value }] }] })
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
      case 'badapp':
        blocks.push({ kind: 'other', label: 'Malformed application extension', where, size, sections: [], note: 'Its identifier block is not the 11 bytes the format requires — removed.' })
        break
      case 'unknown':
        blocks.push({ kind: 'other', label: `Extension ${hex(g.label ?? 0, 2)}`, where, size, sections: [], note: 'An extension GIF decoders do not use (or one cut short) — removed.' })
        break
      default:
        blocks.push({ kind: 'other', label: `Application data “${g.ident ?? '?'}”`, where, size, sections: [] })
    }
  }
  if (scan.end < b.length) {
    blocks.push({
      kind: 'trailing',
      label: scan.trailer ? 'Data after GIF trailer' : 'Unreadable data where a block should start',
      where: `${hex(scan.end)}–${hex(b.length)}`,
      size: b.length - scan.end,
      sections: [],
      note: scan.trailer ? 'Bytes no decoder reads — removed.' : 'The block structure breaks here, so these bytes cannot be told apart — they are removed, and the copy may not display.',
    })
  }
  return { blocks, width: scan.width, height: scan.height, imageRanges }
}

export function stripGif(b: Uint8Array, options: StripOptions): Stripped {
  const scan = scanGif(b)
  const removed: string[] = []
  const kept: string[] = []
  const counts = new Map<string, number>()
  const count = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1)
  const out: Uint8Array[] = [b.subarray(0, scan.headerEnd)]
  for (const g of scan.blocks) {
    if (g.kind === 'image') out.push(b.subarray(g.start, g.end))
    else if (g.kind === 'gce') {
      out.push(concat([new Uint8Array([0x21, 0xf9, 4]), b.subarray(g.start + 3, g.start + 7), new Uint8Array([0])]))
      if (extra(g) > 0) count('extra data in a graphic control extension')
    } else if (g.kind === 'loop') {
      out.push(concat([b.subarray(g.start, g.start + 14), new Uint8Array([3, 1]), b.subarray(g.loopAt!, g.loopAt! + 2), new Uint8Array([0])]))
      if (extra(g) > 0) count('extra data in the looping extension')
    } else if (g.kind === 'icc' && options.keepIcc) {
      out.push(b.subarray(g.start, g.end))
      kept.push('ICC colour profile (application extension)')
    } else count(g.kind === 'app' ? `${DROP_LABEL.app} “${g.ident}”` : g.kind === 'unknown' ? `${DROP_LABEL.unknown} ${hex(g.label ?? 0, 2)}` : DROP_LABEL[g.kind])
  }
  if (scan.trailer) out.push(new Uint8Array([0x3b]))
  for (const [label, n] of counts) removed.push(n > 1 ? `${label} ×${n}` : label)
  if (scan.end < b.length) removed.push(`${formatBytes(b.length - scan.end)} ${scan.trailer ? 'after the trailer' : 'of unreadable data'}`)
  return { bytes: concat(out), removed, kept }
}
