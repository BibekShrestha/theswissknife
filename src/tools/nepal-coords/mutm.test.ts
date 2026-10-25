import { describe, expect, it } from 'vitest'
import { fromGrid, gridProblem, nearestZone, toGrid, warningsFor, type ShiftId, type Zone } from './mutm'
import reference from './reference.json'

interface Case {
  zone: Zone
  shift: ShiftId
  operation: string
  forward: { name: string; lon: number; lat: number; e: number; n: number }[]
  inverse: { e: number; n: number; lon: number; lat: number }[]
}

/**
 * reference.json comes from reference.py: pyproj with the EPSG dataset, MUTM
 * built on EPSG:6207, and the WGS 84 cases through the operation PROJ picks
 * (the script refuses to write unless it is EPSG:6208).
 */
describe('MUTM against pyproj', () => {
  const cases = reference.cases as Case[]

  it('covers all three zones, both shifts and both directions', () => {
    for (const zone of [81, 84, 87]) {
      for (const shift of ['epsg6208', 'none']) {
        const c = cases.find((x) => x.zone === zone && x.shift === shift)
        expect(c?.forward.length).toBeGreaterThanOrEqual(3)
        expect(c?.inverse.length).toBeGreaterThanOrEqual(6)
      }
    }
    const names = new Set(cases.flatMap((c) => c.forward.map((p) => p.name)))
    for (const town of ['Kathmandu', 'Pokhara', 'Biratnagar', 'Nepalgunj', 'Mahendranagar', 'Namche Bazaar']) expect(names).toContain(town)
    for (const c of cases.filter((x) => x.shift === 'epsg6208')) expect(c.operation).toMatch(/Nepal 1981 to WGS 84 \(1\)/)
  })

  for (const c of cases as Case[]) {
    it(`zone ${c.zone}° E, ${c.shift}: latitude/longitude → grid to 1 mm`, () => {
      for (const p of c.forward) {
        const { e, n } = toGrid({ lon: p.lon, lat: p.lat }, c.zone, c.shift)
        expect(Math.abs(e - p.e), `E of ${p.name}`).toBeLessThan(0.001)
        expect(Math.abs(n - p.n), `N of ${p.name}`).toBeLessThan(0.001)
      }
    })
    it(`zone ${c.zone}° E, ${c.shift}: grid → latitude/longitude to 1e-9°`, () => {
      for (const p of c.inverse) {
        const { lon, lat } = fromGrid({ e: p.e, n: p.n }, c.zone, c.shift)
        expect(Math.abs(lon - p.lon), `lon of ${p.e},${p.n}`).toBeLessThan(1e-9)
        expect(Math.abs(lat - p.lat), `lat of ${p.e},${p.n}`).toBeLessThan(1e-9)
      }
    })
  }

  it('agrees with the KML tool’s independent MUTM 84 case', () => {
    // tools/kml/proj/reference.json, pyproj 3.6.1 with +towgs84=293.17,726.18,245.36.
    const { e, n } = toGrid({ lon: 85.32, lat: 27.71 }, 84, 'epsg6208')
    expect(Math.abs(e - 630391.974040985)).toBeLessThan(0.001)
    expect(Math.abs(n - 3066418.734554529)).toBeLessThan(0.001)
  })
})

describe('zones and warnings', () => {
  it('picks the nearest central meridian', () => {
    expect(nearestZone(80.18)).toBe(81)
    expect(nearestZone(82.49)).toBe(81)
    expect(nearestZone(82.5)).toBe(84)
    expect(nearestZone(85.32)).toBe(84)
    expect(nearestZone(85.5)).toBe(87)
    expect(nearestZone(88.1)).toBe(87)
    expect(nearestZone(70)).toBe(81)
    expect(nearestZone(100)).toBe(87)
  })

  it('warns outside Nepal and far from the meridian', () => {
    expect(warningsFor({ lat: 27.7, lon: 85.3 }, 84)).toEqual([])
    expect(warningsFor({ lat: 51.5, lon: 85.3 }, 84).map((w) => w.kind)).toEqual(['outside'])
    const far = warningsFor({ lat: 27.7, lon: 85.3 }, 81)
    expect(far.map((w) => w.kind)).toEqual(['zone'])
    expect(far[0].text).toMatch(/4\.3°.*Its own zone is 84° E/)
    // Just past the zone edge but within the slack: no warning.
    expect(warningsFor({ lat: 27.7, lon: 85.55 }, 84)).toEqual([])
  })

  it('refuses grid values MUTM cannot have', () => {
    expect(gridProblem({ e: 630391, n: 3066418 })).toBeNull()
    expect(gridProblem({ e: 3066418, n: 630391 })).toMatch(/swapped/)
    expect(gridProblem({ e: -5, n: 3066418 })).toMatch(/Easting/)
    expect(gridProblem({ e: 630391, n: 0 })).toMatch(/Northing/)
    expect(gridProblem({ e: NaN, n: 3066418 })).toMatch(/Easting/)
  })
})
