/**
 * Output-size arithmetic. Pure on purpose: every resize rule the UI offers is
 * decided here, so the rules can be tested without touching a canvas.
 */

export type ResizeMode = 'none' | 'percent' | 'exact' | 'longest'

export interface ResizeSpec {
  mode: ResizeMode
  /** `percent` mode: 1–1000, where 100 is unchanged. */
  percent: number
  /** `exact` mode: leave one side blank to derive it from the aspect ratio. */
  width: number | null
  height: number | null
  /** `exact` mode with both sides set: fit inside the box instead of stretching. */
  lockAspect: boolean
  /** `longest` mode: cap on the longer side, in pixels. */
  longest: number
}

export interface Size {
  width: number
  height: number
}

export interface ComputedSize extends Size {
  /** The result is larger than the source — the UI warns, it does not refuse. */
  upscaled: boolean
  /** The request exceeded MAX_PIXELS and was scaled back to fit. */
  clamped: boolean
}

export const DEFAULT_RESIZE: ResizeSpec = {
  mode: 'none',
  percent: 100,
  width: null,
  height: null,
  lockAspect: true,
  longest: 1920,
}

/**
 * Canvases much bigger than this are where browsers start returning blank
 * bitmaps or throwing — iOS Safari is the strictest. 100 MP leaves room for
 * any real photo while keeping us clear of the cliff.
 */
export const MAX_PIXELS = 100_000_000

export function computeSize(src: Size, spec: ResizeSpec, maxPixels = MAX_PIXELS): ComputedSize {
  const srcW = Math.max(1, Math.round(src.width))
  const srcH = Math.max(1, Math.round(src.height))
  let width = srcW
  let height = srcH

  switch (spec.mode) {
    case 'none':
      break
    case 'percent': {
      const factor = clampPercent(spec.percent) / 100
      width = srcW * factor
      height = srcH * factor
      break
    }
    case 'exact': {
      const w = positive(spec.width)
      const h = positive(spec.height)
      if (w && h) {
        if (spec.lockAspect) {
          // contain: the whole image inside the box, aspect ratio intact
          const scale = Math.min(w / srcW, h / srcH)
          width = srcW * scale
          height = srcH * scale
        } else {
          width = w
          height = h
        }
      } else if (w) {
        width = w
        height = spec.lockAspect ? (srcH * w) / srcW : srcH
      } else if (h) {
        height = h
        width = spec.lockAspect ? (srcW * h) / srcH : srcW
      }
      break
    }
    case 'longest': {
      const cap = positive(spec.longest)
      if (cap) {
        const scale = cap / Math.max(srcW, srcH)
        width = srcW * scale
        height = srcH * scale
      }
      break
    }
  }

  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  const upscaled = width > srcW || height > srcH

  let clamped = false
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height))
    width = Math.max(1, Math.floor(width * scale))
    height = Math.max(1, Math.floor(height * scale))
    clamped = true
  }

  return { width, height, upscaled, clamped }
}

/** Applies a target-size search's scale factor to an already-computed size. */
export function scaleSize(size: Size, scale: number): Size {
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/**
 * Halving steps to walk before the final draw. One big smooth downscale
 * aliases badly past ~2×; browsers only average a small neighbourhood.
 */
export function downscaleSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = []
  let width = from.width
  let height = from.height
  while (width >= to.width * 2 && height >= to.height * 2) {
    width = Math.max(to.width, Math.floor(width / 2))
    height = Math.max(to.height, Math.floor(height / 2))
    if (width === to.width && height === to.height) break
    steps.push({ width, height })
  }
  return steps
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 100
  return Math.min(1000, percent)
}

function positive(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}
