/**
 * Geometry for the before/after viewer: fitting, zooming, panning and the
 * split divider. Pure functions, because "the image drifts when you zoom" is
 * the kind of bug that is miserable to chase through a component.
 *
 * The model: the original's frame is drawn at `scale`, centred in the stage,
 * then shifted by `offset` in screen pixels. Both images share that frame, so
 * anything the divider reveals lines up pixel for pixel.
 */

export interface Box {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 32

/** Largest scale that fits inside the stage, never enlarging past 1:1. */
export function fitScale(natural: Box, stage: Box): number {
  if (natural.width <= 0 || natural.height <= 0) return 1
  if (stage.width <= 0 || stage.height <= 0) return 1
  return Math.min(1, stage.width / natural.width, stage.height / natural.height)
}

/** Keeps the frame from being dragged out of sight. */
export function clampOffset(offset: Point, natural: Box, stage: Box, scale: number): Point {
  const slackX = Math.max(0, (natural.width * scale - stage.width) / 2)
  const slackY = Math.max(0, (natural.height * scale - stage.height) / 2)
  return {
    x: clamp(offset.x, -slackX, slackX),
    y: clamp(offset.y, -slackY, slackY),
  }
}

export interface ZoomResult {
  scale: number
  offset: Point
}

/**
 * Zooms by `factor` while holding the content under `pointer` still — pointer
 * is measured from the centre of the stage, which is where offset is measured
 * from too.
 */
export function zoomToward(
  current: ZoomResult,
  factor: number,
  pointer: Point,
  natural: Box,
  stage: Box,
): ZoomResult {
  const scale = clamp(current.scale * factor, MIN_ZOOM, MAX_ZOOM)
  const ratio = scale / current.scale
  // the content point under the pointer must map back to the same place
  const offset = {
    x: pointer.x - (pointer.x - current.offset.x) * ratio,
    y: pointer.y - (pointer.y - current.offset.y) * ratio,
  }
  return { scale, offset: clampOffset(offset, natural, stage, scale) }
}

/** Divider position as a percentage of the stage width, from a pointer x. */
export function dividerPercent(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 50
  return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100)
}

export type Tone = 'good' | 'warn' | 'flat'

export interface Delta {
  text: string
  tone: Tone
}

/** "−47%" when it shrank, "+35%" when it grew, "no change" when it did not. */
export function sizeDelta(before: number, after: number): Delta {
  if (!(before > 0) || !(after >= 0)) return { text: 'no change', tone: 'flat' }
  const change = 1 - after / before
  if (Math.abs(change) < 0.005) return { text: 'no change', tone: 'flat' }
  if (change > 0) return { text: `−${Math.round(change * 100)}%`, tone: 'good' }
  return { text: `+${Math.round(-change * 100)}%`, tone: 'warn' }
}

export function zoomLabel(scale: number): string {
  if (scale >= 1) return `${Math.round(scale * 100)}%`
  // small scales need a digit to stay distinguishable (7.5% vs 8%)
  return `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const clamped = Math.min(max, Math.max(min, value))
  // clamping a negative into a zero-width range yields -0, which reads oddly
  // in transforms and in tests
  return clamped === 0 ? 0 : clamped
}
