/**
 * "Get this under 200 KB" — the search that makes it happen.
 *
 * The encoder is injected, so the strategy is testable against a synthetic
 * model instead of a real canvas, and the same code drives every format:
 * lossy formats trade quality first (keeping the pixels), and whatever is
 * still too big falls back to scaling down — the only lever PNG and GIF have.
 */

export interface Sized {
  size: number
}

export interface SearchParams {
  /** 0–1; ignored by formats without a quality dial. */
  quality: number
  /** Multiplier on the already-computed output size. 1 = no extra scaling. */
  scale: number
}

export interface SearchOptions {
  targetBytes: number
  /** False for PNG/GIF: the quality phase is skipped and only scale moves. */
  searchQuality: boolean
  /** Best quality we are willing to ship — the first attempt uses it. */
  quality: number
  minQuality?: number
  minScale?: number
  qualitySteps?: number
  scaleSteps?: number
}

export interface SearchResult<T extends Sized> {
  /** Largest result that fits the target, or the smallest we managed. */
  best: T
  params: SearchParams
  attempts: number
  met: boolean
}

const DEFAULTS = {
  minQuality: 0.3,
  minScale: 0.1,
  qualitySteps: 5,
  scaleSteps: 4,
}

interface Hit<T> {
  out: T
  params: SearchParams
}

export async function searchForTarget<T extends Sized>(
  encode: (params: SearchParams) => Promise<T>,
  opts: SearchOptions,
): Promise<SearchResult<T>> {
  const minQuality = opts.minQuality ?? DEFAULTS.minQuality
  const minScale = opts.minScale ?? DEFAULTS.minScale
  const qualitySteps = opts.qualitySteps ?? DEFAULTS.qualitySteps
  const scaleSteps = opts.scaleSteps ?? DEFAULTS.scaleSteps
  const target = opts.targetBytes
  const maxQuality = clamp(opts.quality, minQuality, 1)

  const seen = new Map<string, T>()
  // A state object rather than plain locals: the tracking happens inside
  // run(), and the compiler cannot follow narrowing through a closure.
  const state = { attempts: 0, fits: null as Hit<T> | null, smallest: null as Hit<T> | null }

  const run = async (params: SearchParams): Promise<T> => {
    const key = `${params.quality.toFixed(2)}@${params.scale.toFixed(4)}`
    const cached = seen.get(key)
    if (cached) return cached
    const out = await encode(params)
    seen.set(key, out)
    state.attempts++
    if (!state.smallest || out.size < state.smallest.out.size) state.smallest = { out, params }
    if (out.size <= target && (!state.fits || out.size > state.fits.out.size)) {
      state.fits = { out, params }
    }
    return out
  }

  // 1. Best case: full size at the requested quality already fits.
  const first = await run({ quality: round2(maxQuality), scale: 1 })
  if (first.size <= target) return done()

  // 2. Trade quality before pixels — binary search the quality dial.
  if (opts.searchQuality) {
    let lo = minQuality
    let hi = maxQuality
    for (let i = 0; i < qualitySteps; i++) {
      const mid = round2((lo + hi) / 2)
      if (mid <= lo || mid >= hi) break
      const out = await run({ quality: mid, scale: 1 })
      if (out.size <= target) lo = mid
      else hi = mid
    }
    if (state.fits) return done()
  }

  // 3. Scale down. Bytes track area, so sqrt(target/actual) is a good jump —
  //    measure, jump, repeat.
  const scaleQuality = round2(
    opts.searchQuality ? Math.max(minQuality, maxQuality * 0.9) : maxQuality,
  )
  let scale = 1
  let bytes = Math.max(1, state.smallest ? state.smallest.out.size : first.size)
  let failedAt = 1
  for (let i = 0; i < scaleSteps; i++) {
    const next = round4(clamp(scale * Math.sqrt(target / bytes) * 0.95, minScale, scale * 0.95))
    if (next >= scale) break
    const out = await run({ quality: scaleQuality, scale: next })
    scale = next
    bytes = out.size
    if (out.size <= target) break
    failedAt = scale
    if (scale <= minScale) break
  }

  // 4. One refinement: split the difference between the last size that was too
  //    big and the one that fit, so we do not hand back a needlessly tiny image.
  const fits = state.fits
  if (fits && fits.params.scale < failedAt) {
    const mid = round4((fits.params.scale + failedAt) / 2)
    if (mid > fits.params.scale && mid < failedAt) await run({ quality: scaleQuality, scale: mid })
  }

  return done()

  function done(): SearchResult<T> {
    const winner = state.fits ?? state.smallest
    if (!winner) throw new Error('target search produced no result')
    return { best: winner.out, params: winner.params, attempts: state.attempts, met: winner.out.size <= target }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
