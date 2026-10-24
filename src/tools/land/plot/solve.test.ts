import { describe, expect, it } from 'vitest'
import { addCorner, addDiagonal, close, EMPTY_PLOT, setAngle, setDiagonal, setSide, template, undo, type Plot } from './model'
import { interiorAngle, parseLength, solvePlot, type Solved } from './solve'

/** A closed plot from sketch points, side lengths and diagonals ([a, b, length]). */
function plot(points: [number, number][], sides: (number | string)[], diagonals: [number, number, number | string][] = [], angles: Record<number, string> = {}): Plot {
  let p = EMPTY_PLOT
  for (const [x, y] of points) p = addCorner(p, x, y)
  p = close(p)
  sides.forEach((s, i) => { p = setSide(p, i, String(s)) })
  diagonals.forEach(([a, b, len]) => {
    p = addDiagonal(p, a, b)
    p = setDiagonal(p, p.diagonals.length - 1, String(len))
  })
  for (const [k, v] of Object.entries(angles)) p = setAngle(p, Number(k), v)
  return p
}

const solved = (p: Plot, unit: 'ft' | 'm' = 'ft') => {
  const r = solvePlot(p, unit)
  if (!r.ok) throw new Error(r.message)
  return r as Solved
}

const RECT: [number, number][] = [[100, 100], [400, 100], [400, 300], [100, 300]]
const shoelace = (c: [number, number][]) => Math.abs(c.reduce((s, p, i) => { const q = c[(i + 1) % c.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2

describe('solvePlot', () => {
  it('needs more than the sides of a four-sided plot, and says what to add', () => {
    const r = solvePlot(plot(RECT, [30, 40, 30, 40]), 'ft')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/could still swing.*diagonal [A-D]–[A-D]/)
  })

  it('fixes a rectangle with one right angle or one diagonal', () => {
    expect(solved(plot(RECT, [30, 40, 30, 40], [], { 0: '90' })).area).toBeCloseTo(1200, 9)
    expect(solved(plot(RECT, [30, 40, 30, 40], [[0, 2, 50]])).area).toBeCloseTo(1200, 9)
    const all = solved(plot(RECT, [30, 40, 30, 40], [], { 0: '90', 1: '90', 2: '90', 3: '90' }))
    expect(all.area).toBeCloseTo(1200, 9)
    expect(all.conflicts).toEqual([])
    expect(all.perimeter).toBe(140)
  })

  it('solves a triangle from its sides alone (Heron)', () => {
    expect(solved(plot([[0, 0], [300, 0], [0, 200]], [3, 5, 4])).area).toBeCloseTo(6, 12)
  })

  it('gets a concave plot right', () => {
    // An L: 40 × 10 plus a 10 × 20 arm = 600.
    const L: [number, number][] = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]]
    const sides = L.map((p, i) => Math.hypot(L[(i + 1) % 6][0] - p[0], L[(i + 1) % 6][1] - p[1]))
    const d = (a: number, b: number): [number, number, number] => [a, b, Math.hypot(L[a][0] - L[b][0], L[a][1] - L[b][1])]
    const r = solved(plot(L.map(([x, y]) => [x * 10, y * 10]), sides, [d(0, 2), d(0, 3), d(0, 4)]))
    expect(r.area).toBeCloseTo(600, 9)
    expect(interiorAngle(r.coords, 3)).toBeCloseTo(270, 9)
    expect(r.crossing).toBe(false)
  })

  it('matches the true area of an irregular plot sketched only roughly', () => {
    const truth: [number, number][] = [[0, 0], [52.3, 4.1], [61.7, 38.2], [30.4, 55.9], [-6.2, 31.5]]
    const sides = truth.map((p, i) => Math.hypot(truth[(i + 1) % 5][0] - p[0], truth[(i + 1) % 5][1] - p[1]))
    const diag = (a: number, b: number): [number, number, number] => [a, b, Math.hypot(truth[a][0] - truth[b][0], truth[a][1] - truth[b][1])]
    // The sketch is a regular pentagon: only order and handedness carry over.
    const sketch = template(5).points.map(([x, y]) => [x, -y] as [number, number]).reverse()
    const r = solved(plot(sketch.map(([x, y]) => [x, y + 400]), sides, [diag(0, 2), diag(0, 3)]))
    expect(r.area).toBeCloseTo(shoelace(truth), 6)
  })

  it('names a triangle that cannot exist', () => {
    const r = solvePlot(plot([[0, 0], [300, 0], [0, 200]], [1, 1, 5]), 'm')
    expect(!r.ok && r.message).toMatch(/can't form a triangle/)
  })

  it('reports measurements that disagree with the rest', () => {
    const r = solved(plot(RECT, [30, 40, 30, 40], [[0, 2, 52]], { 1: '90' }))
    expect(r.conflicts.length).toBeGreaterThan(0)
    expect(r.conflicts.map((c) => c.what).join()).toMatch(/diagonal A–C|angle at B/)
  })

  it('flags an outline that crosses itself', () => {
    const r = solved(plot([[0, 0], [100, 100], [100, 0], [0, 100]], [Math.SQRT2 * 10, 10, Math.SQRT2 * 10, 10], [[0, 2, 10]]))
    expect(r.crossing).toBe(true)
  })

  it('asks for missing and unreadable values', () => {
    expect(solvePlot(plot(RECT, [30, '', 30, 40]), 'ft')).toMatchObject({ ok: false, bad: { sides: [] }, message: expect.stringMatching(/missing: B–C/) })
    expect(solvePlot(plot(RECT, [30, 'x', 30, 40]), 'ft')).toMatchObject({ ok: false, bad: { sides: [1] } })
    expect(solvePlot(plot(RECT, [30, 40, 30, 40], [], { 0: '180' }), 'ft')).toMatchObject({ ok: false, bad: { angles: [0] } })
    expect(solvePlot({ ...plot(RECT, [1, 1, 1, 1]), closed: false }, 'ft')).toMatchObject({ ok: false, message: expect.stringMatching(/Close the outline/) })
  })
})

describe('parseLength', () => {
  it('reads decimals, and feet with inches', () => {
    expect(parseLength('30.5', 'm')).toBe(30.5)
    expect(parseLength("30'6\"", 'ft')).toBe(30.5)
    expect(parseLength("30' 6", 'ft')).toBe(30.5)
    expect(parseLength('30ft 6in', 'ft')).toBe(30.5)
    expect(parseLength("12'", 'ft')).toBe(12)
    expect(parseLength('३०', 'ft')).toBe(30)
    expect(parseLength('', 'ft')).toBeUndefined()
    expect(parseLength("30'6\"", 'm')).toBeNull()
    expect(parseLength('abc', 'ft')).toBeNull()
  })
})

describe('plot edits', () => {
  it('adds, closes and undoes corners with their measurements', () => {
    let p = EMPTY_PLOT
    p = addCorner(p, 10, 10); p = addCorner(p, 50, 10); p = addCorner(p, 50, 50)
    expect(close(addCorner(EMPTY_PLOT, 1, 1)).closed).toBe(false)
    p = close(p)
    expect(p.closed).toBe(true)
    expect(addCorner(p, 5, 5)).toBe(p)
    p = undo(p)
    expect(p.closed).toBe(false)
    p = undo(p)
    expect(p.points).toHaveLength(2)
    expect(p.sides).toHaveLength(2)
  })

  it('only allows diagonals between corners that are not neighbours, once', () => {
    let p = template(5)
    p = addDiagonal(p, 0, 1)
    expect(p.diagonals).toEqual([])
    p = addDiagonal(addDiagonal(p, 3, 0), 0, 3)
    expect(p.diagonals).toEqual([{ a: 0, b: 3, length: '' }])
    expect(undo(undo(p)).diagonals).toHaveLength(1)
    expect(undo(undo(undo(p))).diagonals).toEqual([])
  })

  it('starts a rectangle with right angles', () => {
    expect(template(4).angles).toEqual(['90', '90', '90', '90'])
    expect(template(6).points).toHaveLength(6)
  })
})
