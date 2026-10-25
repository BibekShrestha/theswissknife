/**
 * Nepal's Modified UTM grid (MUTM): Transverse Mercator on the Everest 1830
 * (1937 adjustment) ellipsoid, a = 6377276.345 m, 1/f = 300.8017, scale
 * 0.9999 on central meridians 81°, 84° and 87° E, false easting 500 000 m,
 * false northing 0. The datum is Nepal 1981 (Nagarkot), EPSG:6207.
 *
 * MUTM itself is not in the EPSG dataset; reference.py builds it on
 * EPSG:6207 and checks this module against pyproj (mutm.test.ts, 1 mm and
 * 1e-9°).
 */

import { shiftFromWgs84, shiftToWgs84, tmerc, type Ellipsoid, type Projection, type Translation } from './proj'

const DEG = Math.PI / 180

export const ZONES = [81, 84, 87] as const
export type Zone = (typeof ZONES)[number]

export const EVEREST_1830: Ellipsoid = { a: 6377276.345, f: 1 / 300.8017 }
export const K0 = 0.9999
export const FALSE_EASTING = 500000

const PROJECTIONS = new Map<Zone, Projection>(
  ZONES.map((zone) => [zone, tmerc(EVEREST_1830, { lon0: zone * DEG, lat0: 0, k0: K0, x0: FALSE_EASTING, y0: 0 })]),
)

export type ShiftId = 'epsg6208' | 'none'

export interface Shift {
  id: ShiftId
  /** Short name for the picker. */
  label: string
  /** What the latitude/longitude side is called. */
  geoName: string
  translation?: Translation
  /** Parameters as published. */
  parameters: string
  source: string
  /** Expected accuracy, in the source's own words where it gives one. */
  accuracy: string
}

/**
 * Only shifts with a single published value and a named source. EPSG:6208
 * is the one EPSG holds for Nepal 1981 → WGS 84 (EPSG dataset v12.029,
 * checked with pyproj in reference.py).
 */
export const SHIFTS: Record<ShiftId, Shift> = {
  epsg6208: {
    id: 'epsg6208',
    label: 'EPSG:6208 — Nepal 1981 to WGS 84',
    geoName: 'WGS84 (GPS, Google Earth)',
    translation: { ell: EVEREST_1830, dx: 293.17, dy: 726.18, dz: 245.36 },
    parameters: 'Geocentric translations (EPSG method 9603): ΔX = +293.17 m, ΔY = +726.18 m, ΔZ = +245.36 m, no rotation or scale.',
    source: 'EPSG Geodetic Parameter Dataset, transformation 6208 "Nepal 1981 to WGS 84 (1)", operation version SD-Npl. Information source: Nepalese Journal on Geoinformatics, June 2011. Derived at 11 points.',
    accuracy: 'about 0.3 m (EPSG’s accuracy for this transformation; 0.26 m at one sigma)',
  },
  none: {
    id: 'none',
    label: 'No datum shift — Nepal 1981 latitude/longitude',
    geoName: 'Nepal 1981 (Everest 1830) — not GPS',
    parameters: 'None: latitude and longitude stay on the Nepal 1981 datum. Only the map projection is applied.',
    source: 'The MUTM definition alone.',
    accuracy: 'not comparable with GPS — these latitudes and longitudes differ from WGS84 by about 165–275 m across Nepal',
  },
}

export interface Geo {
  /** Degrees. */
  lon: number
  lat: number
}

export interface Grid {
  e: number
  n: number
}

/** Latitude/longitude (on the shift's side: WGS84, or Nepal 1981 for "none") → MUTM. */
export function toGrid(geo: Geo, zone: Zone, shift: ShiftId): Grid {
  let lon = geo.lon * DEG, lat = geo.lat * DEG
  const t = SHIFTS[shift].translation
  if (t) [lon, lat] = shiftFromWgs84(t, lon, lat)
  const [e, n] = PROJECTIONS.get(zone)!.forward(lon, lat)
  return { e, n }
}

/** MUTM → latitude/longitude on the shift's side. */
export function fromGrid(grid: Grid, zone: Zone, shift: ShiftId): Geo {
  let [lon, lat] = PROJECTIONS.get(zone)!.inverse(grid.e, grid.n)
  const t = SHIFTS[shift].translation
  if (t) [lon, lat] = shiftToWgs84(t, lon, lat)
  return { lon: lon / DEG, lat: lat / DEG }
}

/** The zone whose central meridian is nearest (a tie at 82.5° or 85.5° goes east). */
export function nearestZone(lon: number): Zone {
  const index = Math.round((lon - 81) / 3)
  return ZONES[Math.min(2, Math.max(0, index))]
}

/** EPSG's area of use for Nepal 1981 and EPSG:6208. */
export const NEPAL = { south: 26.34, north: 30.43, west: 80.06, east: 88.21 }
/** How far outside that box a point may be before it is called "outside Nepal". */
const NEPAL_MARGIN = 0.25
/** Each zone covers ±1.5° from its meridian; past this the warning shows. */
const ZONE_HALF_WIDTH = 1.5
const ZONE_SLACK = 0.1

export type WarningKind = 'outside' | 'zone'

export interface Warning {
  kind: WarningKind
  text: string
}

export function warningsFor(geo: Geo, zone: Zone): Warning[] {
  const warnings: Warning[] = []
  const { south, north, west, east } = NEPAL
  if (geo.lat < south - NEPAL_MARGIN || geo.lat > north + NEPAL_MARGIN || geo.lon < west - NEPAL_MARGIN || geo.lon > east + NEPAL_MARGIN) {
    warnings.push({
      kind: 'outside',
      text: `This point is outside Nepal (${south}–${north}° N, ${west}–${east}° E). MUTM and the Nepal 1981 datum shift are only defined there, so the result means little.`,
    })
  }
  const off = Math.abs(geo.lon - zone)
  if (off > ZONE_HALF_WIDTH + ZONE_SLACK) {
    const better = nearestZone(geo.lon)
    warnings.push({
      kind: 'zone',
      text: `This point is ${off.toFixed(1)}° from zone ${zone}° E’s central meridian; MUTM zones reach ±1.5°.${better !== zone ? ` Its own zone is ${better}° E — keep ${zone}° only if your maps are all in that zone.` : ''}`,
    })
  }
  return warnings
}

/** Grid values that cannot be MUTM in Nepal, with the reason; null when fine. */
export function gridProblem(grid: Grid): string | null {
  if (grid.e > 1_000_000 && grid.n < 1_000_000) return 'Easting and northing look swapped — in Nepal the northing is the larger number (about 2,900,000–3,400,000 m).'
  if (!(grid.e > 0 && grid.e < 1_000_000)) return 'Easting must be between 0 and 1,000,000 m (MUTM eastings in Nepal are about 300,000–700,000 m).'
  if (!(grid.n > 0 && grid.n < 10_000_000)) return 'Northing must be between 0 and 10,000,000 m (MUTM northings in Nepal are about 2,900,000–3,400,000 m).'
  return null
}

/** Rough ground distance in metres between two lat/lon points (spherical; for "about N m" only). */
export function roughDistance(a: Geo, b: Geo): number {
  const R = 6371008.8
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
