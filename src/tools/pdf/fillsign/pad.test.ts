import { describe, expect, it } from 'vitest'
import { addPoint, endStroke, alphaBounds, carryTo, centreOn, clampBox, fitSize, MIN_ITEM, nudge, resizeBox, strokeSegments, strokesBounds, whiteToAlpha, type Pt } from './pad'

const view = { width: 600, height: 800 }

describe('drawing pad strokes', () => {
  it('keeps the first sample, drops jitter and smooths the rest towards the pointer', () => {
    const stroke: Pt[] = []
    expect(addPoint(stroke, { x: 10, y: 10 })).toBe(true)
    expect(addPoint(stroke, { x: 10.5, y: 10.5 })).toBe(false)
    expect(addPoint(stroke, { x: 20, y: 10 }, 1.5, 0.5)).toBe(true)
    expect(stroke).toEqual([{ x: 10, y: 10 }, { x: 15, y: 10 }])
    expect(addPoint(stroke, { x: 20, y: 10 }, 1.5, 1)).toBe(true)
    expect(stroke[2]).toEqual({ x: 20, y: 10 })
  })

  it('ends a stroke at the last raw sample, which smoothing lags behind', () => {
    const stroke: Pt[] = []
    addPoint(stroke, { x: 0, y: 0 })
    addPoint(stroke, { x: 100, y: 0 }, 1.5, 0.5)
    expect(stroke[1]).toEqual({ x: 50, y: 0 })
    endStroke(stroke, { x: 100, y: 0 })
    expect(stroke[2]).toEqual({ x: 100, y: 0 })
    endStroke(stroke, { x: 100.2, y: 0 })
    expect(stroke).toHaveLength(3)
    endStroke([], { x: 1, y: 1 })
  })

  it('turns a tap into a dot and two points into a line', () => {
    expect(strokeSegments([])).toEqual([])
    expect(strokeSegments([{ x: 1, y: 2 }])).toEqual([{ kind: 'dot', at: { x: 1, y: 2 } }])
    expect(strokeSegments([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([{ kind: 'line', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }])
  })

  it('draws longer strokes as joined quadratic curves from the first point to the last', () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 0 }]
    const segments = strokeSegments(points)
    expect(segments).toHaveLength(3)
    expect(segments.every((s) => s.kind === 'quad')).toBe(true)
    const quads = segments as Extract<(typeof segments)[number], { kind: 'quad' }>[]
    expect(quads[0].from).toEqual(points[0])
    expect(quads[quads.length - 1].to).toEqual(points[4])
    // each piece starts where the last ended, and every inner sample is a control point
    for (let i = 1; i < quads.length; i++) expect(quads[i].from).toEqual(quads[i - 1].to)
    expect(quads.map((q) => q.ctrl)).toEqual(points.slice(1, 4))
    // joins are midpoints, so consecutive pieces share a tangent there
    expect(quads[0].to).toEqual({ x: 15, y: 5 })
  })

  it('bounds the ink, padded by half the pen and kept on the canvas', () => {
    expect(strokesBounds([], 2, 100, 100)).toBeNull()
    expect(strokesBounds([[{ x: 10, y: 20 }, { x: 50, y: 30 }], [{ x: 30, y: 60 }]], 2, 100, 100)).toEqual({ x: 8, y: 18, width: 44, height: 44 })
    expect(strokesBounds([[{ x: 1, y: 1 }, { x: 99, y: 99 }]], 4, 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })
})

describe('image trimming', () => {
  const rgba = (w: number, h: number, opaque: [number, number][]) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (const [x, y] of opaque) data[(y * w + x) * 4 + 3] = 255
    return data
  }

  it('finds the box of the opaque pixels', () => {
    expect(alphaBounds(rgba(10, 10, []), 10, 10)).toBeNull()
    expect(alphaBounds(rgba(10, 10, [[3, 2], [7, 5], [4, 8]]), 10, 10)).toEqual({ x: 3, y: 2, width: 5, height: 7 })
    expect(alphaBounds(rgba(4, 4, [[0, 0], [3, 3]]), 4, 4)).toEqual({ x: 0, y: 0, width: 4, height: 4 })
  })

  it('makes paper transparent, keeps ink and fades the edge between', () => {
    const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255])
    const paper = px(250, 250, 245)
    const ink = px(20, 30, 90)
    const edge = px(190, 190, 190)
    for (const d of [paper, ink, edge]) whiteToAlpha(d)
    expect(paper[3]).toBe(0)
    expect(ink[3]).toBe(255)
    expect(edge[3]).toBeGreaterThan(0)
    expect(edge[3]).toBeLessThan(255)
    // colour is untouched
    expect([...ink.slice(0, 3)]).toEqual([20, 30, 90])
  })
})

describe('placing items', () => {
  it('fits a size within limits without enlarging it', () => {
    expect(fitSize(400, 100, 200, 200)).toEqual({ width: 200, height: 50 })
    expect(fitSize(50, 20, 200, 200)).toEqual({ width: 50, height: 20 })
    expect(fitSize(100, 400, 200, 200)).toEqual({ width: 50, height: 200 })
  })

  it('keeps boxes on the page', () => {
    expect(clampBox({ x: -10, y: 790, width: 100, height: 40 }, view)).toEqual({ x: 0, y: 760, width: 100, height: 40 })
    expect(clampBox({ x: 0, y: 0, width: 900, height: 40 }, view)).toEqual({ x: 0, y: 0, width: 600, height: 40 })
  })

  it('nudges by 1 pt, or 10 with Shift, and ignores other keys', () => {
    const box = { x: 100, y: 100, width: 50, height: 20 }
    expect(nudge(box, 'ArrowRight', false, view)).toEqual({ ...box, x: 101 })
    expect(nudge(box, 'ArrowUp', true, view)).toEqual({ ...box, y: 90 })
    expect(nudge(box, 'ArrowLeft', true, view)).toEqual({ ...box, x: 90 })
    expect(nudge(box, 'ArrowDown', false, view)).toEqual({ ...box, y: 101 })
    expect(nudge({ ...box, x: 0 }, 'ArrowLeft', true, view)).toEqual({ ...box, x: 0 })
    expect(nudge(box, 'a', false, view)).toBeNull()
  })

  it('resizes keeping the shape, within a minimum and the page', () => {
    const box = { x: 100, y: 100, width: 100, height: 40 }
    expect(resizeBox(box, 1.5, view)).toEqual({ x: 100, y: 100, width: 150, height: 60 })
    const tiny = resizeBox(box, 0.01, view)
    expect(tiny.height).toBeCloseTo(MIN_ITEM)
    expect(tiny.width / tiny.height).toBeCloseTo(2.5)
    // growing past the right edge moves it back; past the page size stops at the page
    const big = resizeBox({ x: 500, y: 0, width: 100, height: 40 }, 3, view)
    expect(big).toEqual({ x: 300, y: 0, width: 300, height: 120 })
    const huge = resizeBox(box, 100, view)
    expect(huge.width).toBe(600)
    expect(huge.x).toBe(0)
  })

  it('drops a box centred on a click, and carries it to a page of another size', () => {
    const box = { x: 0, y: 0, width: 100, height: 40 }
    expect(centreOn(box, { x: 300, y: 400 }, view)).toEqual({ x: 250, y: 380, width: 100, height: 40 })
    expect(centreOn(box, { x: 10, y: 10 }, view)).toEqual({ x: 0, y: 0, width: 100, height: 40 })
    expect(carryTo({ x: 300, y: 400, width: 100, height: 40 }, view, { width: 300, height: 400 })).toEqual({ x: 150, y: 200, width: 100, height: 40 })
  })
})
