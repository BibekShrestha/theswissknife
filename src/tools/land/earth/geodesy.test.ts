import { describe, expect, it } from 'vitest'
import { distance, ellipsoidArea, sideLengths } from './geodesy'
import reference from './reference.json'

/**
 * reference.json is pyproj 3.6.1's Geod(ellps='WGS84'): polygon_area_perimeter
 * (Karney's geodesic polygon area) and inv for side lengths.
 */
type Case = { ring: number[][]; area: number; sides?: number[]; perimeter?: number }
const cases = reference as unknown as Record<string, Case>
const flat = (ring: number[][]) => ring.flat()

describe('ellipsoidArea', () => {
  // Straight edges in the equal-area plane vs geodesic edges: tiny at plot scale, growing with size.
  for (const [name, tolerance] of [['small', 1e-7], ['field', 1e-7], ['south', 1e-7], ['large', 5e-7]] as const) {
    it(`matches Karney's geodesic area: ${name}`, () => {
      const { ring, area } = cases[name]
      expect(Math.abs(ellipsoidArea([flat(ring)]) - area) / area).toBeLessThan(tolerance)
    })
  }

  it('ignores winding and subtracts holes', () => {
    const outer = flat(cases.field.ring)
    const reversed = flat([...cases.field.ring].reverse())
    expect(ellipsoidArea([reversed])).toBeCloseTo(ellipsoidArea([outer]), 3)
    const withHole = ellipsoidArea([outer, flat(cases.hole.ring)])
    expect(Math.abs(withHole - (cases.field.area - cases.hole.area)) / cases.field.area).toBeLessThan(1e-6)
  })

  it('keeps an outline across the antimeridian whole', () => {
    const box = [179.999, 0, -179.999, 0, -179.999, 0.002, 179.999, 0.002]
    const shifted = [0.999, 0, 1.001, 0, 1.001, 0.002, 0.999, 0.002]
    expect(ellipsoidArea([box])).toBeCloseTo(ellipsoidArea([shifted]), 1)
  })
})

describe('side lengths', () => {
  for (const name of ['small', 'field', 'large', 'south']) {
    it(`match the geodesic inverse to a millimetre: ${name}`, () => {
      const got = sideLengths(flat(cases[name].ring))
      cases[name].sides!.forEach((s, i) => expect(Math.abs(got[i] - s)).toBeLessThan(0.001))
    })
  }

  it('is zero between identical points', () => {
    expect(distance(85, 27, 85, 27)).toBe(0)
  })
})
