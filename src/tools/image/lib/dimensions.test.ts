import { describe, expect, it } from 'vitest'
import {
  computeSize,
  DEFAULT_RESIZE,
  downscaleSteps,
  scaleSize,
  type ResizeSpec,
} from './dimensions'

const spec = (over: Partial<ResizeSpec> = {}): ResizeSpec => ({ ...DEFAULT_RESIZE, ...over })
const landscape = { width: 4000, height: 3000 }

describe('computeSize', () => {
  it('leaves the size alone in none mode', () => {
    expect(computeSize(landscape, spec())).toEqual({
      width: 4000,
      height: 3000,
      upscaled: false,
      clamped: false,
    })
  })

  it('scales by percentage and rounds to whole pixels', () => {
    expect(computeSize({ width: 1001, height: 667 }, spec({ mode: 'percent', percent: 33 })))
      .toMatchObject({ width: 330, height: 220 })
  })

  it('flags percentages above 100 as upscaling instead of refusing them', () => {
    expect(computeSize(landscape, spec({ mode: 'percent', percent: 150 }))).toMatchObject({
      width: 6000,
      height: 4500,
      upscaled: true,
    })
  })

  it('falls back to 100% for a nonsense percentage', () => {
    expect(computeSize(landscape, spec({ mode: 'percent', percent: 0 }))).toMatchObject({
      width: 4000,
      height: 3000,
    })
  })

  it('derives the missing side from the aspect ratio', () => {
    expect(computeSize(landscape, spec({ mode: 'exact', width: 800 }))).toMatchObject({
      width: 800,
      height: 600,
    })
    expect(computeSize(landscape, spec({ mode: 'exact', height: 600 }))).toMatchObject({
      width: 800,
      height: 600,
    })
  })

  it('keeps the other side when the aspect lock is off and only one side is given', () => {
    expect(
      computeSize(landscape, spec({ mode: 'exact', width: 800, lockAspect: false })),
    ).toMatchObject({ width: 800, height: 3000 })
  })

  it('fits inside the box when both sides are given and the aspect is locked', () => {
    // 4:3 into a 800x800 box is 800x600, not 800x800
    expect(computeSize(landscape, spec({ mode: 'exact', width: 800, height: 800 }))).toMatchObject({
      width: 800,
      height: 600,
    })
  })

  it('stretches to both sides exactly when the aspect lock is off', () => {
    expect(
      computeSize(landscape, spec({ mode: 'exact', width: 800, height: 800, lockAspect: false })),
    ).toMatchObject({ width: 800, height: 800 })
  })

  it('ignores zero and negative exact sides', () => {
    expect(computeSize(landscape, spec({ mode: 'exact', width: 0, height: -5 }))).toMatchObject({
      width: 4000,
      height: 3000,
    })
  })

  it('caps the longest side in longest mode, whichever side that is', () => {
    expect(computeSize(landscape, spec({ mode: 'longest', longest: 1000 }))).toMatchObject({
      width: 1000,
      height: 750,
    })
    expect(
      computeSize({ width: 3000, height: 4000 }, spec({ mode: 'longest', longest: 1000 })),
    ).toMatchObject({ width: 750, height: 1000 })
  })

  it('never produces a zero-pixel side', () => {
    expect(computeSize({ width: 1000, height: 3 }, spec({ mode: 'percent', percent: 1 })))
      .toMatchObject({ width: 10, height: 1 })
  })

  it('clamps requests past the pixel ceiling and says so', () => {
    const out = computeSize(landscape, spec({ mode: 'percent', percent: 1000 }), 1_000_000)
    expect(out.clamped).toBe(true)
    expect(out.width * out.height).toBeLessThanOrEqual(1_000_000)
    // aspect ratio survives the clamp
    expect(out.width / out.height).toBeCloseTo(4 / 3, 2)
  })
})

describe('scaleSize', () => {
  it('applies a target-search scale factor', () => {
    expect(scaleSize({ width: 801, height: 601 }, 0.5)).toEqual({ width: 401, height: 301 })
  })

  it('keeps at least one pixel', () => {
    expect(scaleSize({ width: 10, height: 10 }, 0.001)).toEqual({ width: 1, height: 1 })
  })
})

describe('downscaleSteps', () => {
  it('halves until within 2x of the target', () => {
    expect(downscaleSteps({ width: 4000, height: 3000 }, { width: 400, height: 300 })).toEqual([
      { width: 2000, height: 1500 },
      { width: 1000, height: 750 },
      { width: 500, height: 375 },
    ])
  })

  it('returns no steps for small reductions or upscales', () => {
    expect(downscaleSteps({ width: 1000, height: 1000 }, { width: 800, height: 800 })).toEqual([])
    expect(downscaleSteps({ width: 400, height: 400 }, { width: 800, height: 800 })).toEqual([])
  })

  it('stops exactly at the target instead of overshooting', () => {
    const steps = downscaleSteps({ width: 4096, height: 4096 }, { width: 512, height: 512 })
    for (const step of steps) {
      expect(step.width).toBeGreaterThanOrEqual(512)
      expect(step.height).toBeGreaterThanOrEqual(512)
    }
  })
})
