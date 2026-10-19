/**
 * Pure geometry for Fill & Sign: the drawing pad's stroke smoothing and
 * trimming, and the placed items' moves and resizes. No DOM, so it is
 * tested in Node (pad.test.ts).
 */

export interface Pt {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Pointer samples closer than this (canvas px) to the last kept point add nothing but jitter. */
export const MIN_POINT_DISTANCE = 1.5
/** How much of each new sample is kept: 1 follows the pointer exactly, lower values smooth more. */
export const SMOOTHING = 0.55

/**
 * Appends a pointer sample to a stroke, low-pass filtered against the last
 * kept point (the first point is kept as it is). Returns whether a point
 * was added.
 */
export function addPoint(stroke: Pt[], sample: Pt, minDistance = MIN_POINT_DISTANCE, smoothing = SMOOTHING): boolean {
  const last = stroke[stroke.length - 1]
  if (!last) {
    stroke.push({ x: sample.x, y: sample.y })
    return true
  }
  if (Math.hypot(sample.x - last.x, sample.y - last.y) < minDistance) return false
  stroke.push({ x: last.x + (sample.x - last.x) * smoothing, y: last.y + (sample.y - last.y) * smoothing })
  return true
}

export type Segment =
  | { kind: 'dot'; at: Pt }
  | { kind: 'line'; from: Pt; to: Pt }
  | { kind: 'quad'; from: Pt; ctrl: Pt; to: Pt }

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * A stroke as smooth curve pieces: quadratic curves through the midpoints
 * between samples, each sample a control point — the curve is continuous
 * and has no corners at the joins. A tap is a dot.
 */
export function strokeSegments(points: Pt[]): Segment[] {
  if (points.length === 0) return []
  if (points.length === 1) return [{ kind: 'dot', at: points[0] }]
  if (points.length === 2) return [{ kind: 'line', from: points[0], to: points[1] }]
  const out: Segment[] = []
  let from = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const to = i === points.length - 2 ? points[i + 1] : mid(points[i], points[i + 1])
    out.push({ kind: 'quad', from, ctrl: points[i], to })
    from = to
  }
  return out
}

/** The box around every stroke point, grown by `pad` (half the line width) and kept inside w×h; null when nothing was drawn. */
export function strokesBounds(strokes: Pt[][], pad: number, w: number, h: number): Box | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const stroke of strokes) {
    for (const p of stroke) {
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
  }
  if (x0 === Infinity) return null
  const left = Math.max(0, Math.floor(x0 - pad))
  const top = Math.max(0, Math.floor(y0 - pad))
  const right = Math.min(w, Math.ceil(x1 + pad))
  const bottom = Math.min(h, Math.ceil(y1 + pad))
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/** The smallest box holding every pixel more opaque than `threshold` in RGBA `data` (w×h); null when all are transparent. */
export function alphaBounds(data: Uint8ClampedArray, w: number, h: number, threshold = 8): Box | null {
  let [x0, y0, x1, y1] = [w, h, -1, -1]
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * Makes a scanned or photographed signature's paper transparent: pixels at
 * least `paper` bright become clear, ones at most `ink` keep their alpha, and
 * the ones between fade, so the pen's edge stays smooth. In place, RGBA.
 */
export function whiteToAlpha(data: Uint8ClampedArray, paper = 225, ink = 150): void {
  for (let i = 0; i < data.length; i += 4) {
    // perceived brightness
    const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    if (light >= paper) data[i + 3] = 0
    else if (light > ink) data[i + 3] = Math.round((data[i + 3] * (paper - light)) / (paper - ink))
  }
}

/** w×h scaled down (never up) to fit max×max, keeping its shape. */
export function fitSize(w: number, h: number, maxW: number, maxH: number): Size {
  const k = Math.min(1, maxW / w, maxH / h)
  return { width: w * k, height: h * k }
}

/** The box moved (not resized, unless it is larger than the page) so it lies within the page. */
export function clampBox(box: Box, view: Size): Box {
  const width = Math.min(box.width, view.width)
  const height = Math.min(box.height, view.height)
  return {
    x: Math.min(Math.max(0, box.x), view.width - width),
    y: Math.min(Math.max(0, box.y), view.height - height),
    width,
    height,
  }
}

/** Arrow keys move a placed item by 1 pt, with Shift by 10 pt. Null for any other key. */
export function nudge(box: Box, key: string, big: boolean, view: Size): Box | null {
  const step = big ? 10 : 1
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (!d[key]) return null
  return clampBox({ ...box, x: box.x + d[key][0], y: box.y + d[key][1] }, view)
}

/** Smallest a placed item may get, in points along its shorter side. */
export const MIN_ITEM = 6

/**
 * The box scaled by `factor` about its top-left corner, keeping its shape:
 * no smaller than MIN_ITEM on its short side, no larger than the page, and
 * moved back onto the page when growing pushes it over an edge.
 */
export function resizeBox(box: Box, factor: number, view: Size): Box {
  const k = Math.min(Math.max(factor, MIN_ITEM / Math.min(box.width, box.height)), view.width / box.width, view.height / box.height)
  return clampBox({ ...box, width: box.width * k, height: box.height * k }, view)
}

/** Where a box dropped centred on point p lands, kept on the page. */
export function centreOn(box: Box, p: Pt, view: Size): Box {
  return clampBox({ ...box, x: p.x - box.width / 2, y: p.y - box.height / 2 }, view)
}

/** A box on one page carried to another of a different size: same relative place, same size in points. */
export function carryTo(box: Box, from: Size, to: Size): Box {
  return clampBox({ ...box, x: (box.x / from.width) * to.width, y: (box.y / from.height) * to.height }, to)
}
