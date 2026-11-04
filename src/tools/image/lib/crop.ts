/**
 * Crop geometry. Pure, like dimensions.ts: every rule the crop box follows —
 * aspect locking, staying inside the picture, what a crop drawn on one image
 * means for another — is decided here so it can be tested without a canvas.
 *
 * Rectangles are in the decoded image's pixels (EXIF orientation applied,
 * which is also how an <img> reports its natural size). A crop is stored with
 * the size it was drawn against (`ref`), so the worker can map it onto a
 * bitmap of a different size: "apply to all" across a mixed batch, or an SVG
 * rasterised at its output size.
 */

import type { Size } from './dimensions'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface CropEntry {
  rect: Rect
  /** The image size `rect` was drawn against. */
  ref: Size
}

export type AspectId = 'free' | 'original' | '1:1' | '4:3' | '3:2' | '16:9' | '3:4' | '2:3' | '9:16'

export const ASPECTS: { id: AspectId; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' },
  { id: '16:9', label: '16:9' },
  { id: '3:4', label: '3:4' },
  { id: '2:3', label: '2:3' },
  { id: '9:16', label: '9:16' },
]

/** What the screen keeps: one aspect for the batch, one crop per file id. */
export interface CropOptions {
  aspect: AspectId
  rects: Readonly<Record<string, CropEntry>>
}

/** What one job needs: the batch's aspect and this file's crop, if it has one. */
export interface CropSpec {
  aspect: AspectId
  entry: CropEntry | null
}

export const DEFAULT_CROP: CropOptions = { aspect: 'free', rects: {} }
export const NO_CROP: CropSpec = { aspect: 'free', entry: null }

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Width ÷ height, or null when the box is free. 'original' is per image. */
export function aspectRatio(aspect: AspectId, source: Size): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return source.width / source.height
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}

export function fullRect(size: Size): Rect {
  return { x: 0, y: 0, width: size.width, height: size.height }
}

export function isFull(rect: Rect, size: Size): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height
}

/** The largest rectangle of `ratio` inside `box`, centred in it. */
export function containAspect(box: Rect, ratio: number): Rect {
  let width: number
  let height: number
  if (box.width / box.height > ratio) {
    height = box.height
    width = Math.min(box.width, Math.max(1, Math.round(height * ratio)))
  } else {
    width = box.width
    height = Math.min(box.height, Math.max(1, Math.round(width / ratio)))
  }
  return {
    x: box.x + Math.floor((box.width - width) / 2),
    y: box.y + Math.floor((box.height - height) / 2),
    width,
    height,
  }
}

/** Where a file with no crop of its own starts: centred, as large as the ratio allows. */
export function defaultRect(source: Size, ratio: number | null): Rect {
  const full = fullRect(source)
  return ratio == null ? full : containAspect(full, ratio)
}

/** Whole pixels, at least 1×1, entirely inside the image. */
export function clampRect(rect: Rect, bounds: Size): Rect {
  const width = clamp(Math.round(rect.width), 1, bounds.width)
  const height = clamp(Math.round(rect.height), 1, bounds.height)
  return {
    x: clamp(Math.round(rect.x), 0, bounds.width - width),
    y: clamp(Math.round(rect.y), 0, bounds.height - height),
    width,
    height,
  }
}

/**
 * The pixels the worker actually cuts out of a bitmap of `source` size. A crop
 * drawn against another size is scaled per axis, then — if the ratio is fixed
 * and the scaling bent it — shrunk back to the ratio about its centre.
 */
export function resolveCrop(source: Size, spec: CropSpec): Rect {
  const ratio = aspectRatio(spec.aspect, source)
  if (!spec.entry) return defaultRect(source, ratio)
  const { rect, ref } = spec.entry
  const sx = source.width / ref.width
  const sy = source.height / ref.height
  let out = clampRect(
    { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy },
    source,
  )
  if (ratio != null && (sx !== sy || Math.abs(out.width / out.height - ratio) * out.height >= 1)) {
    out = containAspect(out, ratio)
  }
  return out
}

/** Drags the whole box, stopping at the edges rather than shrinking it. */
export function moveRect(start: Rect, dx: number, dy: number, bounds: Size): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
}

/**
 * Drags one handle. The opposite edge or corner stays put; with a fixed ratio
 * an edge handle grows the box about the middle of that edge, and a corner
 * takes the larger of the two sizes the pointer asks for. Never leaves the image and
 * never goes below 1×1 — the box does not flip when dragged past its anchor.
 */
export function resizeRect(
  start: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  bounds: Size,
): Rect {
  const west = handle.includes('w')
  const east = handle.includes('e')
  const north = handle.includes('n')
  const south = handle.includes('s')
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (ratio == null) {
    if (west) left = clamp(left + dx, 0, right - 1)
    if (east) right = clamp(right + dx, left + 1, bounds.width)
    if (north) top = clamp(top + dy, 0, bottom - 1)
    if (south) bottom = clamp(bottom + dy, top + 1, bounds.height)
    return clampRect({ x: left, y: top, width: right - left, height: bottom - top }, bounds)
  }

  const horizontal = west || east
  const vertical = north || south
  const pulledW = horizontal ? (east ? start.width + dx : start.width - dx) : 0
  const pulledH = vertical ? (south ? start.height + dy : start.height - dy) : 0
  let width = horizontal && vertical ? Math.max(pulledW, pulledH * ratio) : horizontal ? pulledW : pulledH * ratio

  // Room on each axis from the anchor: an edge, or the middle of the box.
  const cx = start.x + start.width / 2
  const cy = start.y + start.height / 2
  const roomW = east ? bounds.width - left : west ? right : 2 * Math.min(cx, bounds.width - cx)
  const roomH = south ? bounds.height - top : north ? bottom : 2 * Math.min(cy, bounds.height - cy)
  width = clamp(width, Math.max(1, ratio), Math.min(roomW, roomH * ratio))
  const height = width / ratio

  const x = east ? left : west ? right - width : cx - width / 2
  const y = south ? top : north ? bottom - height : cy - height / 2
  return clampRect({ x, y, width, height }, bounds)
}

/** A new box dragged out from `origin` on empty picture. */
export function drawRect(
  origin: { x: number; y: number },
  dx: number,
  dy: number,
  ratio: number | null,
  bounds: Size,
): Rect {
  const handle = `${dy < 0 ? 'n' : 's'}${dx < 0 ? 'w' : 'e'}` as Handle
  return resizeRect({ x: origin.x, y: origin.y, width: 0, height: 0 }, handle, dx, dy, ratio, bounds)
}

/**
 * Typed width or height. The top-left corner stays unless the new size would
 * run off the image, in which case the box slides back in; with a fixed ratio
 * the other side follows.
 */
export function sizeRect(
  rect: Rect,
  change: { width?: number; height?: number },
  ratio: number | null,
  bounds: Size,
): Rect {
  let width = change.width ?? rect.width
  let height = change.height ?? rect.height
  if (ratio != null) {
    if (change.width != null) height = width / ratio
    else width = height * ratio
    if (width > bounds.width) {
      width = bounds.width
      height = width / ratio
    }
    if (height > bounds.height) {
      height = bounds.height
      width = height * ratio
    }
  }
  width = clamp(Math.round(width), 1, bounds.width)
  height = clamp(Math.round(height), 1, bounds.height)
  return clampRect({ x: Math.min(rect.x, bounds.width - width), y: Math.min(rect.y, bounds.height - height), width, height }, bounds)
}

/**
 * A new ratio for crops already placed: each becomes the largest box of that
 * ratio that fits in its image, centred where the old one was. Free keeps
 * them as they are.
 */
export function refitEntries(
  rects: Readonly<Record<string, CropEntry>>,
  aspect: AspectId,
): Record<string, CropEntry> {
  const out: Record<string, CropEntry> = {}
  for (const [id, entry] of Object.entries(rects)) {
    const ratio = aspectRatio(aspect, entry.ref)
    if (ratio == null) {
      out[id] = entry
      continue
    }
    const largest = containAspect(fullRect(entry.ref), ratio)
    const cx = entry.rect.x + entry.rect.width / 2
    const cy = entry.rect.y + entry.rect.height / 2
    out[id] = {
      ref: entry.ref,
      rect: clampRect(
        { ...largest, x: cx - largest.width / 2, y: cy - largest.height / 2 },
        entry.ref,
      ),
    }
  }
  return out
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
