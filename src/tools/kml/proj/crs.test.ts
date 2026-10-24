import { describe, expect, it } from 'vitest'
import { CrsError, LONLAT, parseProj, utmProj, utmZoneFor, WEB_MERCATOR } from './crs'
import reference from './reference.json'

/**
 * reference.json was computed with pyproj 3.6.1 / PROJ 9.3.0: each row is
 * [lon, lat, x, y, lon', lat'] where x, y is
 * Transformer.from_crs("EPSG:4326", CRS.from_proj4(proj), always_xy=True)
 * of lon, lat and lon', lat' is the reverse transformer applied to x, y. The
 * reverse is not an exact round trip when a datum shift is involved: a 2D
 * transform assumes height 0 on whichever side it starts from.
 */
describe('projections against PROJ', () => {
  for (const { proj, points } of reference as { proj: string; points: number[][] }[]) {
    it(proj, () => {
      const crs = parseProj(proj)
      for (const [lon, lat, x, y, backLon, backLat] of points) {
        const [px, py] = crs.forward(lon, lat)
        const tolerance = crs.kind === 'geographic' ? 1e-9 : 0.001 / crs.unitMetres
        expect(Math.abs(px - x), `x of ${lon},${lat}`).toBeLessThan(tolerance)
        expect(Math.abs(py - y), `y of ${lon},${lat}`).toBeLessThan(tolerance)
        const [blon, blat] = crs.inverse(x, y)
        expect(Math.abs(blon - backLon), `lon back from ${x},${y}`).toBeLessThan(1e-9)
        expect(Math.abs(blat - backLat), `lat back from ${x},${y}`).toBeLessThan(1e-9)
      }
    })
  }
})

describe('parseProj', () => {
  it('labels the presets', () => {
    expect(parseProj(utmProj(33, false)).label).toBe('UTM zone 33N (WGS84)')
    expect(parseProj(utmProj(18, true)).label).toBe('UTM zone 18S (WGS84)')
    expect(parseProj(WEB_MERCATOR).label).toBe('Web Mercator')
    expect(parseProj(LONLAT).kind).toBe('geographic')
  })

  it('reads units', () => {
    const crs = parseProj('+proj=tmerc +lon_0=0 +units=us-ft')
    expect(crs.unitLabel).toBe('US survey feet')
    expect(crs.forward(0.001, 0)[0]).toBeCloseTo(111.319 / 0.3048006096, 1)
  })

  it('refuses what it cannot do, by name', () => {
    expect(() => parseProj('+proj=omerc +lat_0=4')).toThrow(/omerc is not supported/)
    expect(() => parseProj('+proj=utm +zone=61')).toThrow(/1 to 60/)
    expect(() => parseProj('+proj=tmerc +nadgrids=ntv2.gsb')).toThrow(/grid shift/)
    expect(() => parseProj('+proj=longlat +datum=NAD27')).toThrow(/NAD27/)
    expect(() => parseProj('+proj=utm +zone=3 +lat_1=4')).toThrow(/\+lat_1 is not supported/)
    expect(() => parseProj('+proj=tmerc +lon_0=13d20')).toThrow(/decimal/)
    expect(() => parseProj('+proj=tmerc +ellps=foo')).toThrow(CrsError)
    expect(() => parseProj('utm')).toThrow(/\+proj=/)
  })

  it('warns when a non-WGS84 ellipsoid has no datum shift', () => {
    expect(parseProj('+proj=tmerc +lon_0=9 +ellps=bessel').datumWarning).toMatch(/bessel/)
    expect(parseProj('+proj=tmerc +lon_0=9 +ellps=bessel +towgs84=598.1,73.7,418.2').datumWarning).toBeUndefined()
    expect(parseProj('+proj=utm +zone=32 +ellps=GRS80').datumWarning).toBeUndefined()
    expect(parseProj(WEB_MERCATOR).datumWarning).toBeUndefined()
  })
})

describe('utmZoneFor', () => {
  it('follows the grid, with the Norway and Svalbard exceptions', () => {
    expect(utmZoneFor(-180, 0)).toBe(1)
    expect(utmZoneFor(179.99, 0)).toBe(60)
    expect(utmZoneFor(180, 0)).toBe(1)
    expect(utmZoneFor(85.32, 27.71)).toBe(45)
    expect(utmZoneFor(5, 60)).toBe(32)
    expect(utmZoneFor(5, 50)).toBe(31)
    expect(utmZoneFor(10, 78)).toBe(33)
    expect(utmZoneFor(-0.1, 51.5)).toBe(30)
  })
})
