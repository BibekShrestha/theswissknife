import { describe, expect, it } from 'vitest'
import {
  clampOffset,
  dividerPercent,
  fitScale,
  MAX_ZOOM,
  MIN_ZOOM,
  sizeDelta,
  zoomLabel,
  zoomToward,
} from './compare'

const stage = { width: 800, height: 600 }

describe('fitScale', () => {
  it('fits a large image by its tighter side', () => {
    expect(fitScale({ width: 4000, height: 3000 }, stage)).toBeCloseTo(0.2)
    expect(fitScale({ width: 1000, height: 3000 }, stage)).toBeCloseTo(0.2)
  })

  it('shows small images at 1:1 rather than blowing them up', () => {
    expect(fitScale({ width: 8, height: 8 }, stage)).toBe(1)
  })

  it('survives a stage or image that has not been measured yet', () => {
    expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1)
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1)
  })
})

describe('clampOffset', () => {
  const natural = { width: 4000, height: 3000 }

  it('pins an image smaller than the stage to the centre', () => {
    expect(clampOffset({ x: 200, y: -90 }, natural, stage, 0.1)).toEqual({ x: 0, y: 0 })
  })

  it('allows panning exactly as far as the overflow', () => {
    // at 1:1 the overflow is (4000-800)/2 = 1600 and (3000-600)/2 = 1200
    expect(clampOffset({ x: 9999, y: -9999 }, natural, stage, 1)).toEqual({ x: 1600, y: -1200 })
    expect(clampOffset({ x: 500, y: 300 }, natural, stage, 1)).toEqual({ x: 500, y: 300 })
  })
})

describe('zoomToward', () => {
  const natural = { width: 1000, height: 1000 }

  it('keeps the point under the cursor still', () => {
    const before = { scale: 1, offset: { x: 0, y: 0 } }
    const pointer = { x: 100, y: 50 }
    const after = zoomToward(before, 2, pointer, natural, stage)

    expect(after.scale).toBe(2)
    // content coordinate under the pointer is unchanged by the zoom
    const contentBefore = { x: (pointer.x - before.offset.x) / before.scale }
    const contentAfter = { x: (pointer.x - after.offset.x) / after.scale }
    expect(contentAfter.x).toBeCloseTo(contentBefore.x, 6)
  })

  it('zooming out and back in returns to where it started', () => {
    // an image with slack at both scales, so no clamping interferes
    const big = { width: 4000, height: 3000 }
    const start = { scale: 1, offset: { x: 0, y: 0 } }
    const out = zoomToward(start, 0.5, { x: 220, y: -80 }, big, stage)
    const back = zoomToward(out, 2, { x: 220, y: -80 }, big, stage)
    expect(back.scale).toBeCloseTo(1, 6)
    expect(back.offset.x).toBeCloseTo(0, 6)
    expect(back.offset.y).toBeCloseTo(0, 6)
  })

  it('does not restore the old offset once zooming out has re-centred it', () => {
    // clamping keeps the image in view, and that discards pan information —
    // worth pinning down so it is not mistaken for drift
    const out = zoomToward({ scale: 1, offset: { x: 90, y: 0 } }, 0.5, { x: 0, y: 0 }, natural, stage)
    expect(out.offset).toEqual({ x: 0, y: 0 })
    const back = zoomToward(out, 2, { x: 0, y: 0 }, natural, stage)
    expect(back.offset).toEqual({ x: 0, y: 0 })
  })

  it('refuses to zoom past its limits', () => {
    const huge = zoomToward({ scale: MAX_ZOOM, offset: { x: 0, y: 0 } }, 4, { x: 0, y: 0 }, natural, stage)
    expect(huge.scale).toBe(MAX_ZOOM)
    const tiny = zoomToward({ scale: MIN_ZOOM, offset: { x: 0, y: 0 } }, 0.25, { x: 0, y: 0 }, natural, stage)
    expect(tiny.scale).toBe(MIN_ZOOM)
  })

  it('re-centres when zooming out below the stage size', () => {
    const zoomed = { scale: 4, offset: { x: 900, y: 700 } }
    const out = zoomToward(zoomed, 0.1, { x: 0, y: 0 }, natural, stage)
    expect(out.offset).toEqual({ x: 0, y: 0 })
  })
})

describe('dividerPercent', () => {
  const rect = { left: 100, width: 400 }

  it('maps a pointer position onto the stage width', () => {
    expect(dividerPercent(100, rect)).toBe(0)
    expect(dividerPercent(300, rect)).toBe(50)
    expect(dividerPercent(500, rect)).toBe(100)
  })

  it('clamps a pointer dragged outside the stage', () => {
    expect(dividerPercent(-500, rect)).toBe(0)
    expect(dividerPercent(5000, rect)).toBe(100)
  })

  it('does not divide by zero before layout', () => {
    expect(dividerPercent(42, { left: 0, width: 0 })).toBe(50)
  })
})

describe('sizeDelta', () => {
  it('reports shrinking, growing and standing still', () => {
    expect(sizeDelta(1000, 530)).toEqual({ text: '−47%', tone: 'good' })
    expect(sizeDelta(1000, 1350)).toEqual({ text: '+35%', tone: 'warn' })
    expect(sizeDelta(1000, 1001)).toEqual({ text: 'no change', tone: 'flat' })
  })

  it('does not invent a percentage for a zero-byte source', () => {
    expect(sizeDelta(0, 500)).toEqual({ text: 'no change', tone: 'flat' })
  })
})

describe('zoomLabel', () => {
  it('reads as a percentage, with a digit when very small', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(4)).toBe('400%')
    expect(zoomLabel(0.42)).toBe('42%')
    expect(zoomLabel(0.075)).toBe('7.5%')
  })
})
