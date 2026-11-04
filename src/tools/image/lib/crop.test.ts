import { describe, expect, it } from 'vitest'
import {
  aspectRatio,
  clampRect,
  containAspect,
  defaultRect,
  drawRect,
  isFull,
  moveRect,
  refitEntries,
  resizeRect,
  resolveCrop,
  sizeRect,
  type Rect,
} from './crop'

const photo = { width: 4000, height: 3000 }
const ratioOf = (r: Rect) => r.width / r.height
const inside = (r: Rect, b = photo) =>
  r.x >= 0 && r.y >= 0 && r.width >= 1 && r.height >= 1 && r.x + r.width <= b.width && r.y + r.height <= b.height

describe('aspectRatio', () => {
  it('is null for free, the image’s own for original, and w ÷ h otherwise', () => {
    expect(aspectRatio('free', photo)).toBeNull()
    expect(aspectRatio('original', photo)).toBeCloseTo(4 / 3)
    expect(aspectRatio('16:9', photo)).toBeCloseTo(16 / 9)
    expect(aspectRatio('9:16', photo)).toBeCloseTo(9 / 16)
  })
})

describe('defaultRect', () => {
  it('keeps the whole image when the box is free', () => {
    const rect = defaultRect(photo, null)
    expect(rect).toEqual({ x: 0, y: 0, width: 4000, height: 3000 })
    expect(isFull(rect, photo)).toBe(true)
  })

  it('centres the largest box of the ratio', () => {
    expect(defaultRect(photo, 1)).toEqual({ x: 500, y: 0, width: 3000, height: 3000 })
    expect(defaultRect(photo, 16 / 9)).toEqual({ x: 0, y: 375, width: 4000, height: 2250 })
    expect(defaultRect({ width: 1080, height: 1920 }, 1)).toEqual({ x: 0, y: 420, width: 1080, height: 1080 })
  })
})

describe('containAspect', () => {
  it('never comes out bigger than the box, even after rounding', () => {
    for (let w = 1; w < 40; w++) {
      for (const ratio of [1, 4 / 3, 16 / 9, 9 / 16, 2 / 3]) {
        const box = { x: 3, y: 5, width: w, height: 17 }
        const out = containAspect(box, ratio)
        expect(out.width).toBeLessThanOrEqual(box.width)
        expect(out.height).toBeLessThanOrEqual(box.height)
        expect(out.width).toBeGreaterThanOrEqual(1)
        expect(out.height).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('clampRect', () => {
  it('rounds, shrinks to the image and slides back inside', () => {
    expect(clampRect({ x: -10.4, y: 2990, width: 100.6, height: 50 }, photo)).toEqual({
      x: 0,
      y: 2950,
      width: 101,
      height: 50,
    })
    expect(clampRect({ x: 10, y: 10, width: 9000, height: 0 }, photo)).toEqual({
      x: 0,
      y: 10,
      width: 4000,
      height: 1,
    })
  })
})

describe('moveRect', () => {
  it('stops at the edge instead of shrinking the box', () => {
    const start = { x: 100, y: 100, width: 1000, height: 500 }
    expect(moveRect(start, 50, -20, photo)).toEqual({ x: 150, y: 80, width: 1000, height: 500 })
    expect(moveRect(start, 99_999, 99_999, photo)).toEqual({ x: 3000, y: 2500, width: 1000, height: 500 })
    expect(moveRect(start, -99_999, 0, photo)).toEqual({ x: 0, y: 100, width: 1000, height: 500 })
  })
})

describe('resizeRect', () => {
  const start = { x: 1000, y: 1000, width: 1000, height: 1000 }

  it('moves only the dragged edges when free', () => {
    expect(resizeRect(start, 'e', 200, 999, null, photo)).toEqual({ x: 1000, y: 1000, width: 1200, height: 1000 })
    expect(resizeRect(start, 'nw', -100, -50, null, photo)).toEqual({ x: 900, y: 950, width: 1100, height: 1050 })
  })

  it('does not flip past the anchor or leave the image', () => {
    expect(resizeRect(start, 'w', 5000, 0, null, photo)).toEqual({ x: 1999, y: 1000, width: 1, height: 1000 })
    expect(resizeRect(start, 'se', 99_999, 99_999, null, photo)).toEqual({ x: 1000, y: 1000, width: 3000, height: 2000 })
  })

  it('keeps the opposite corner fixed and the ratio locked on a corner', () => {
    const out = resizeRect(start, 'se', 500, 100, 1, photo)
    expect(out).toEqual({ x: 1000, y: 1000, width: 1500, height: 1500 })
    const nw = resizeRect(start, 'nw', -100, -400, 1, photo)
    expect(nw).toEqual({ x: 600, y: 600, width: 1400, height: 1400 })
  })

  it('grows about the middle of the edge for an edge handle with a ratio', () => {
    expect(resizeRect(start, 'e', 200, 0, 1, photo)).toEqual({ x: 1000, y: 900, width: 1200, height: 1200 })
    expect(resizeRect(start, 's', 0, 400, 2, photo)).toEqual({ x: 100, y: 1000, width: 2800, height: 1400 })
  })

  it('stops at whichever edge a locked ratio reaches first', () => {
    const out = resizeRect(start, 'se', 99_999, 0, 16 / 9, photo)
    expect(inside(out)).toBe(true)
    expect(out.x).toBe(1000)
    expect(out.y).toBe(1000)
    expect(out.width).toBe(3000)
    expect(Math.abs(out.width / out.height - 16 / 9) * out.height).toBeLessThan(1)
  })
})

describe('drawRect', () => {
  it('drags out a box in any direction', () => {
    expect(drawRect({ x: 500, y: 500 }, 300, 200, null, photo)).toEqual({ x: 500, y: 500, width: 300, height: 200 })
    expect(drawRect({ x: 500, y: 500 }, -300, -200, null, photo)).toEqual({ x: 200, y: 300, width: 300, height: 200 })
  })

  it('locks to the ratio, following the longer pull', () => {
    expect(drawRect({ x: 500, y: 500 }, 300, 100, 1, photo)).toEqual({ x: 500, y: 500, width: 300, height: 300 })
    expect(drawRect({ x: 500, y: 500 }, -100, -300, 1, photo)).toEqual({ x: 200, y: 200, width: 300, height: 300 })
  })

  it('stays inside when dragged off the picture', () => {
    expect(drawRect({ x: 3900, y: 100 }, 5000, -5000, null, photo)).toEqual({ x: 3900, y: 0, width: 100, height: 100 })
  })
})

describe('sizeRect', () => {
  const rect = { x: 3000, y: 100, width: 500, height: 500 }

  it('keeps the top-left corner and slides back in when the size runs off', () => {
    expect(sizeRect(rect, { width: 800 }, null, photo)).toEqual({ x: 3000, y: 100, width: 800, height: 500 })
    expect(sizeRect(rect, { width: 1500 }, null, photo)).toEqual({ x: 2500, y: 100, width: 1500, height: 500 })
  })

  it('derives the other side from a fixed ratio, capped by the image', () => {
    expect(sizeRect(rect, { width: 1600 }, 16 / 9, photo)).toEqual({ x: 2400, y: 100, width: 1600, height: 900 })
    expect(sizeRect(rect, { height: 9999 }, 1, photo)).toEqual({ x: 1000, y: 0, width: 3000, height: 3000 })
  })
})

describe('resolveCrop', () => {
  it('is the centred default when the file has no crop of its own', () => {
    expect(resolveCrop(photo, { aspect: '1:1', entry: null })).toEqual(defaultRect(photo, 1))
    expect(isFull(resolveCrop(photo, { aspect: 'free', entry: null }), photo)).toBe(true)
  })

  it('uses a crop drawn on the same size as it is', () => {
    const rect = { x: 11, y: 22, width: 333, height: 444 }
    expect(resolveCrop(photo, { aspect: 'free', entry: { rect, ref: photo } })).toEqual(rect)
  })

  it('scales a crop drawn on another size', () => {
    const rect = { x: 400, y: 300, width: 2000, height: 1500 }
    expect(resolveCrop({ width: 2000, height: 1500 }, { aspect: 'free', entry: { rect, ref: photo } })).toEqual({
      x: 200,
      y: 150,
      width: 1000,
      height: 750,
    })
  })

  it('pulls a stretched crop back to a fixed ratio', () => {
    const rect = { x: 500, y: 0, width: 3000, height: 3000 }
    const out = resolveCrop({ width: 1080, height: 1920 }, { aspect: '1:1', entry: { rect, ref: photo } })
    expect(out.width).toBe(out.height)
    expect(inside(out, { width: 1080, height: 1920 })).toBe(true)
  })

  it('reads original as each image’s own ratio', () => {
    const portrait = { width: 3000, height: 4000 }
    const rect = { x: 0, y: 0, width: 4000, height: 3000 }
    const out = resolveCrop(portrait, { aspect: 'original', entry: { rect, ref: photo } })
    expect(ratioOf(out)).toBeCloseTo(3 / 4, 2)
  })
})

describe('refitEntries', () => {
  it('re-centres each placed crop as the largest box of the new ratio', () => {
    const rects = { a: { rect: { x: 3000, y: 2000, width: 400, height: 400 }, ref: photo } }
    const out = refitEntries(rects, '16:9')
    expect(out.a.rect).toEqual({ x: 0, y: 750, width: 4000, height: 2250 })
    const square = refitEntries(rects, '1:1')
    expect(square.a.rect).toEqual({ x: 1000, y: 0, width: 3000, height: 3000 })
  })

  it('leaves crops alone when the box becomes free', () => {
    const rects = { a: { rect: { x: 1, y: 2, width: 3, height: 4 }, ref: photo } }
    expect(refitEntries(rects, 'free')).toEqual(rects)
  })
})
