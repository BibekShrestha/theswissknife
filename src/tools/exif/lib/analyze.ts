import { gather, startsWith, type Range } from './bytes'
import { dms, newFacts, type Facts } from './exif'
import { gifBlocks, isGif, stripGif } from './gif'
import { heifBlocks, heifBrand, isHeif, stripHeif } from './heif'
import { jpegBlocks, jpegImageRanges, jpegInfo, scanJpeg, stripJpeg, type Ctx } from './jpeg'
import { isPng, pngBlocks, stripPng } from './png'
import type { Analysis, Block, Format, Processed, Row, StripOptions, Stripped } from './types'
import { isWebp, stripWebp, webpBlocks } from './webp'

export function detect(b: Uint8Array): Format {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (isPng(b)) return 'png'
  if (isWebp(b)) return 'webp'
  if (isGif(b)) return 'gif'
  if (isHeif(b)) return 'heif'
  if (startsWith(b, 0, 'II*\0') || startsWith(b, 0, 'MM\0*')) throw new Error('TIFF and camera raw files are not supported — only JPEG, PNG, WebP, GIF, HEIC and AVIF')
  if (heifBrand(b)) throw new Error('This looks like a video (MP4/MOV) — video is not supported')
  throw new Error('Not a supported image — JPEG, PNG, WebP, GIF, HEIC or AVIF')
}

const SUMMARY_ORDER = [
  'Camera',
  'Lens',
  'Taken',
  'Digitised',
  'Modified',
  'Exposure',
  'Flash',
  'Orientation',
  'Software',
  'Artist',
  'Owner',
  'Copyright',
  'Camera serial',
  'Lens serial',
  'Image ID',
  'Place',
  'GPS time',
  'Facing',
  'Description',
  'Keywords',
  'Colour profile',
  'MakerNote',
]

function summarise(facts: Facts): Row[] {
  const rows: Row[] = []
  if (facts.gps) {
    const { lat, lon, alt } = facts.gps
    rows.push({ key: 'Location', value: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, sensitive: true })
    rows.push({ key: 'Location (DMS)', value: `${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'W')}`, sensitive: true })
    if (alt !== undefined) rows.push({ key: 'Altitude', value: `${Number(alt.toFixed(1))} m${alt < 0 ? ' (below sea level)' : ''}`, sensitive: true })
  }
  const keys = [...SUMMARY_ORDER, ...[...facts.rows.keys()].filter((k) => !SUMMARY_ORDER.includes(k))]
  for (const key of keys) {
    const row = facts.rows.get(key)
    if (row) rows.push(row)
  }
  return rows
}

async function digest(b: Uint8Array, ranges: Range[]): Promise<{ hex: string; bytes: number }> {
  const data = gather(b, ranges)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return { hex: [...hash].map((x) => x.toString(16).padStart(2, '0')).join(''), bytes: data.length }
}

const LABELS: Record<Format, [string, string]> = {
  jpeg: ['JPEG', 'image/jpeg'],
  png: ['PNG', 'image/png'],
  webp: ['WebP', 'image/webp'],
  gif: ['GIF', 'image/gif'],
  heif: ['HEIF', 'image/heic'],
}

/** Reads every metadata block in `b`. Throws on a file it cannot identify at all. */
export async function analyze(b: Uint8Array): Promise<Analysis> {
  const format = detect(b)
  const facts = newFacts()
  const ctx: Ctx = { facts, warnings: [], depth: 0 }
  let [formatLabel, mime] = LABELS[format]
  let parsed: { blocks: Block[]; width?: number; height?: number; imageRanges: Range[] }
  switch (format) {
    case 'jpeg': {
      const scan = scanJpeg(b)
      parsed = { blocks: jpegBlocks(b, ctx, scan), imageRanges: jpegImageRanges(b, scan), ...jpegInfo(b, scan) }
      break
    }
    case 'png':
      parsed = await pngBlocks(b, ctx)
      break
    case 'webp':
      parsed = webpBlocks(b, ctx)
      break
    case 'gif':
      parsed = gifBlocks(b, ctx)
      break
    case 'heif': {
      const h = heifBlocks(b, ctx)
      parsed = h
      formatLabel = h.formatLabel
      mime = h.mime
      break
    }
  }
  const { hex, bytes } = await digest(b, parsed.imageRanges)
  return {
    format,
    formatLabel,
    mime,
    size: b.length,
    width: parsed.width,
    height: parsed.height,
    blocks: parsed.blocks,
    summary: summarise(facts),
    gps: facts.gps,
    orientation: facts.orientation,
    warnings: [...new Set(ctx.warnings)].slice(0, 20),
    imageDigest: hex,
    imageBytes: bytes,
  }
}

export function strip(b: Uint8Array, format: Format, options: StripOptions): Stripped {
  switch (format) {
    case 'jpeg':
      return stripJpeg(b, options)
    case 'png':
      return stripPng(b, options)
    case 'webp':
      return stripWebp(b, options)
    case 'gif':
      return stripGif(b, options)
    case 'heif':
      return stripHeif(b, options)
  }
}

/** Blocks the options asked to keep — or that HEIF cannot drop in place (its colour profile). */
export function keptOnPurpose(block: Block, format: Format, options: StripOptions): boolean {
  if (block.unremovable) return false
  if (block.empty) return true
  if (block.kind === 'icc') return options.keepIcc || format === 'heif'
  if (block.kind === 'exif' && block.orientationOnly && !block.nested) return options.keepOrientation
  return false
}

/**
 * Analyses, strips and then analyses the output again. `remaining` comes from
 * that second parse — the claim that a file is clean is never taken from the
 * stripper's own bookkeeping.
 */
export async function processImage(b: Uint8Array, options: StripOptions): Promise<Processed> {
  const before = await analyze(b)
  const stripped = strip(b, before.format, options)
  const after = await analyze(stripped.bytes)
  const remaining = after.blocks.filter((block) => !keptOnPurpose(block, after.format, options))
  return {
    before,
    after,
    bytes: stripped.bytes,
    removed: stripped.removed,
    kept: stripped.kept,
    remaining,
    identical: before.imageDigest === after.imageDigest && before.imageBytes === after.imageBytes,
  }
}
