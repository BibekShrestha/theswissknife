/**
 * The drawing's coordinate system: a small PROJ-string reader (the subset
 * epsg.io prints for most national grids) plus the presets the UI offers.
 *
 * Datum handling follows PROJ's legacy rule: a geocentric shift is applied
 * only when the CRS names one (+towgs84 or a +datum with known parameters).
 * Without one, latitude and longitude pass through unchanged — which is what
 * makes Web Mercator's sphere line up with WGS84 — and the caller is told
 * the result may be off by the datum difference. Heights are never shifted.
 */

import { lcc, merc, mercScaleAt, tmerc, type Ellipsoid, type Projection } from './projections'

const DEG = Math.PI / 180

/** PROJ's ellipsoid table (src/ellps.cpp, as of PROJ 9), for the names national grids use. */
const ELLIPSOIDS: Record<string, { a: number; rf?: number; b?: number }> = {
  WGS84: { a: 6378137, rf: 298.257223563 },
  GRS80: { a: 6378137, rf: 298.257222101 },
  WGS72: { a: 6378135, rf: 298.26 },
  WGS66: { a: 6378145, rf: 298.25 },
  GRS67: { a: 6378160, rf: 298.247167427 },
  intl: { a: 6378388, rf: 297 },
  clrk66: { a: 6378206.4, b: 6356583.8 },
  clrk80: { a: 6378249.145, rf: 293.4663 },
  clrk80ign: { a: 6378249.2, rf: 293.4660212936269 },
  bessel: { a: 6377397.155, rf: 299.1528128 },
  bess_nam: { a: 6377483.865, rf: 299.1528128 },
  airy: { a: 6377563.396, rf: 299.3249646 },
  mod_airy: { a: 6377340.189, b: 6356034.446 },
  evrst30: { a: 6377276.345, rf: 300.8017 },
  evrst48: { a: 6377304.063, rf: 300.8017 },
  evrst56: { a: 6377301.243, rf: 300.8017 },
  evrstSS: { a: 6377298.556, rf: 300.8017 },
  krass: { a: 6378245, rf: 298.3 },
  aust_SA: { a: 6378160, rf: 298.25 },
  helmert: { a: 6378200, rf: 298.3 },
  sphere: { a: 6370997, b: 6370997 },
}

/**
 * Datum names PROJ resolves to a single Helmert shift (the EPSG
 * transformation it picks, checked in crs.test.ts). Other datums need an
 * explicit +towgs84, which epsg.io's PROJ strings carry.
 */
const DATUMS: Record<string, { ellps: string; towgs84: number[] }> = {
  WGS84: { ellps: 'WGS84', towgs84: [0, 0, 0] },
  NAD83: { ellps: 'GRS80', towgs84: [0, 0, 0] },
  OSGB36: { ellps: 'airy', towgs84: [446.448, -125.157, 542.06, 0.15, 0.247, 0.842, -20.489] },
}

/** Linear units by PROJ name, in metres. */
export const UNITS: Record<string, { metres: number; label: string }> = {
  m: { metres: 1, label: 'metres' },
  km: { metres: 1000, label: 'kilometres' },
  dm: { metres: 0.1, label: 'decimetres' },
  cm: { metres: 0.01, label: 'centimetres' },
  mm: { metres: 0.001, label: 'millimetres' },
  ft: { metres: 0.3048, label: 'feet' },
  'us-ft': { metres: 1200 / 3937, label: 'US survey feet' },
  yd: { metres: 0.9144, label: 'yards' },
  'us-yd': { metres: 3600 / 3937, label: 'US survey yards' },
  in: { metres: 0.0254, label: 'inches' },
  mi: { metres: 1609.344, label: 'miles' },
  'ind-ft': { metres: 0.30479841, label: 'Indian feet' },
  'ind-yd': { metres: 0.91439523, label: 'Indian yards' },
  link: { metres: 0.201168, label: 'links' },
  ch: { metres: 20.1168, label: 'chains' },
}

const PRIME_MERIDIANS: Record<string, number> = {
  greenwich: 0, lisbon: -9.131906111111, paris: 2.337229166667, bogota: -74.080916666667,
  madrid: -3.687938888889, rome: 12.452333333333, bern: 7.439583333333, jakarta: 106.807719444444,
  ferro: -17.666666666667, brussels: 4.367975, stockholm: 18.058277777778, athens: 23.7163375,
  oslo: 10.722916666667,
}

/** Keys that change nothing for a 2D conversion. */
const IGNORED = new Set(['no_defs', 'type', 'wktext', 'approx', 'over', 'no_uoff', 'no_off'])

export type CrsKind = 'geographic' | 'projected'

export interface Crs {
  kind: CrsKind
  /** Canonical PROJ string, as written into the DXF comment. */
  proj: string
  /** Human label: "UTM zone 33N (WGS 84)". */
  label: string
  /** Size of one CRS unit in metres (projected only). */
  unitMetres: number
  unitLabel: string
  /** Set when lat/lon pass through without a datum shift although the ellipsoid isn't WGS84-like. */
  datumWarning?: string
  /** Central meridian in degrees, for distortion warnings (transverse Mercator only). */
  centralMeridian?: number
  /** Lon/lat in degrees (WGS84) → x, y in CRS units. */
  forward(lon: number, lat: number): [number, number]
  /** x, y in CRS units → lon/lat in degrees (WGS84). */
  inverse(x: number, y: number): [number, number]
}

export class CrsError extends Error {}

interface Geocentric {
  ell: Ellipsoid
  /** Position-vector Helmert: metres, radians, scale factor minus one. */
  shift: { dx: number; dy: number; dz: number; rx: number; ry: number; rz: number; s: number }
}

const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 }

function toEcef(ell: Ellipsoid, lon: number, lat: number): [number, number, number] {
  const e2 = ell.f * (2 - ell.f)
  const sin = Math.sin(lat)
  const N = ell.a / Math.sqrt(1 - e2 * sin * sin)
  return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - e2) * sin]
}

/** ECEF → geodetic (Bowring's start, then iterated; height ignored after use). */
function fromEcef(ell: Ellipsoid, x: number, y: number, z: number): [number, number] {
  const e2 = ell.f * (2 - ell.f)
  const p = Math.hypot(x, y)
  const lon = Math.atan2(y, x)
  let lat = Math.atan2(z, p * (1 - e2))
  for (let i = 0; i < 10; i++) {
    const sin = Math.sin(lat)
    const N = ell.a / Math.sqrt(1 - e2 * sin * sin)
    const h = p / Math.cos(lat) - N
    const next = Math.atan2(z, p * (1 - (e2 * N) / (N + h)))
    if (Math.abs(next - lat) < 1e-14) return [lon, next]
    lat = next
  }
  return [lon, lat]
}

/** Source datum → WGS84, as PROJ's pj_geocentric_to_wgs84 does it. */
function datumToWgs84(g: Geocentric, lon: number, lat: number): [number, number] {
  const [x, y, z] = toEcef(g.ell, lon, lat)
  const { dx, dy, dz, rx, ry, rz, s } = g.shift
  const m = 1 + s
  return fromEcef(WGS84, m * (x - rz * y + ry * z) + dx, m * (rz * x + y - rx * z) + dy, m * (-ry * x + rx * y + z) + dz)
}

/** WGS84 → source datum, as PROJ's pj_geocentric_from_wgs84 does it. */
function datumFromWgs84(g: Geocentric, lon: number, lat: number): [number, number] {
  const [x0, y0, z0] = toEcef(WGS84, lon, lat)
  const { dx, dy, dz, rx, ry, rz, s } = g.shift
  const m = 1 + s
  const x = (x0 - dx) / m, y = (y0 - dy) / m, z = (z0 - dz) / m
  return fromEcef(g.ell, x + rz * y - ry * z, -rz * x + y + rx * z, ry * x - rx * y + z)
}

function number(key: string, value: string | undefined): number {
  if (value === undefined || value.trim() === '') throw new CrsError(`+${key} needs a value`)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new CrsError(`+${key}=${value} is not a number (degrees must be decimal)`)
  return n
}

function parseArgs(text: string): Map<string, string | undefined> {
  const args = new Map<string, string | undefined>()
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue
    const bare = token.replace(/^\+/, '')
    const eq = bare.indexOf('=')
    const key = eq < 0 ? bare : bare.slice(0, eq)
    if (!key) continue
    args.set(key, eq < 0 ? undefined : bare.slice(eq + 1))
  }
  return args
}

function ellipsoidFrom(args: Map<string, string | undefined>, datumEllps?: string): { ell: Ellipsoid; name: string } {
  if (args.has('R')) {
    const r = number('R', args.get('R'))
    return { ell: { a: r, f: 0 }, name: `sphere R=${r}` }
  }
  if (args.has('a')) {
    const a = number('a', args.get('a'))
    let f = 0
    if (args.has('rf')) f = 1 / number('rf', args.get('rf'))
    else if (args.has('f')) f = number('f', args.get('f'))
    else if (args.has('b')) f = 1 - number('b', args.get('b')) / a
    else if (args.has('es')) f = 1 - Math.sqrt(1 - number('es', args.get('es')))
    else if (!args.has('ellps')) f = 0
    if (!args.has('ellps') || args.has('rf') || args.has('f') || args.has('b') || args.has('es')) {
      if (!(a > 0) || !(f >= 0 && f < 1)) throw new CrsError('Ellipsoid axes are out of range')
      return { ell: { a, f }, name: f === 0 ? `sphere R=${a}` : `a=${a}, 1/f=${(1 / f).toFixed(6)}` }
    }
  }
  const name = args.get('ellps') ?? datumEllps ?? 'WGS84'
  const def = ELLIPSOIDS[name]
  if (!def) throw new CrsError(`Unknown ellipsoid +ellps=${name}`)
  const f = def.rf ? 1 / def.rf : 1 - (def.b ?? def.a) / def.a
  return { ell: { a: def.a, f }, name }
}

/**
 * Builds a CRS from a PROJ string. Supports longlat, utm, tmerc/etmerc, lcc
 * and merc, with +ellps/+a/+b/+rf/+R, +datum, +towgs84 (3 or 7 parameters),
 * +units/+to_meter and +pm. Anything else is refused by name rather than
 * silently ignored.
 */
export function parseProj(text: string, label?: string): Crs {
  const args = parseArgs(text)
  const proj = args.get('proj')
  if (!proj) throw new CrsError('A PROJ string starts with +proj=… (for example +proj=utm +zone=33 +datum=WGS84)')

  for (const key of ['nadgrids', 'geoidgrids']) {
    const value = args.get(key)
    if (args.has(key) && value !== '@null') throw new CrsError(`+${key} needs grid shift files, which this tool doesn't have — use a +towgs84 definition instead`)
  }
  const axis = args.get('axis')
  if (axis !== undefined && axis !== 'enu') throw new CrsError(`+axis=${axis} is not supported (only east/north order)`)

  let datumEllps: string | undefined
  let towgs84: number[] | undefined
  const datumName = args.get('datum')
  if (datumName !== undefined) {
    if (datumName === 'NAD27') throw new CrsError('NAD27 needs grid shift files — use a +towgs84 definition instead')
    const datum = DATUMS[datumName]
    if (!datum) throw new CrsError(`Unknown datum +datum=${datumName} — give +ellps and +towgs84 instead`)
    datumEllps = datum.ellps
    towgs84 = datum.towgs84
  }
  if (args.has('towgs84')) {
    const parts = (args.get('towgs84') ?? '').split(',').map((part) => number('towgs84', part))
    if (parts.length !== 3 && parts.length !== 7) throw new CrsError('+towgs84 takes 3 or 7 comma-separated numbers')
    towgs84 = parts
  }
  const { ell, name: ellName } = ellipsoidFrom(args, datumEllps)

  let geocentric: Geocentric | undefined
  // A zero shift between identical ellipsoids is the identity: skip the ECEF round trip.
  const identity = towgs84?.every((v) => v === 0) && ell.a === WGS84.a && Math.abs(ell.f - WGS84.f) < 1e-15
  if (towgs84 && !identity) {
    const [dx, dy, dz, rx = 0, ry = 0, rz = 0, s = 0] = towgs84
    const sec = DEG / 3600
    geocentric = { ell, shift: { dx, dy, dz, rx: rx * sec, ry: ry * sec, rz: rz * sec, s: s / 1e6 } }
  }
  // WGS84 and GRS80 differ by 0.1 mm, so only other ellipsoids need a shift.
  const datumWarning = !towgs84 && ell.f !== 0 && Math.abs(ell.a - 6378137) >= 0.5
    ? `The CRS uses the ${ellName} ellipsoid but gives no datum shift (+towgs84), so latitude and longitude are taken as WGS84 — positions can be off by tens to hundreds of metres. Paste a definition that includes +towgs84 to fix this.`
    : undefined

  let pm = 0
  const pmValue = args.get('pm')
  if (pmValue !== undefined) {
    pm = pmValue in PRIME_MERIDIANS ? PRIME_MERIDIANS[pmValue] : number('pm', pmValue)
  }

  let unitMetres = 1
  let unitLabel = 'metres'
  if (args.has('to_meter')) {
    unitMetres = number('to_meter', args.get('to_meter'))
    if (!(unitMetres > 0)) throw new CrsError('+to_meter must be positive')
    unitLabel = `units of ${unitMetres} m`
  } else if (args.has('units')) {
    const unit = UNITS[args.get('units') ?? '']
    if (!unit) throw new CrsError(`Unknown unit +units=${args.get('units')}`)
    unitMetres = unit.metres
    unitLabel = unit.label
  }

  const known = new Set(['proj', 'datum', 'towgs84', 'ellps', 'a', 'b', 'rf', 'f', 'es', 'R', 'pm', 'units', 'to_meter', 'nadgrids', 'geoidgrids', 'axis', ...IGNORED])
  const deg = (key: string, fallback = 0) => (args.has(key) ? number(key, args.get(key)) : fallback) * DEG
  const lin = (key: string) => (args.has(key) ? number(key, args.get(key)) : 0)

  let projection: Projection | null = null
  let kind: CrsKind = 'projected'
  let centralMeridian: number | undefined
  let projKeys: string[] = []
  let defaultLabel = ''

  switch (proj) {
    case 'longlat': case 'latlong': case 'lonlat': case 'latlon':
      kind = 'geographic'
      defaultLabel = `Longitude / latitude (${ellName})`
      break
    case 'utm': {
      projKeys = ['zone', 'south']
      const zone = number('zone', args.get('zone'))
      if (!Number.isInteger(zone) || zone < 1 || zone > 60) throw new CrsError('+zone must be a whole number from 1 to 60')
      const south = args.has('south')
      centralMeridian = zone * 6 - 183
      projection = tmerc(ell, { lon0: centralMeridian * DEG, lat0: 0, k0: 0.9996, x0: 500000, y0: south ? 10000000 : 0 })
      defaultLabel = `UTM zone ${zone}${south ? 'S' : 'N'} (${ellName})`
      // UTM is defined in metres; PROJ applies +units after, and so do we.
      break
    }
    case 'tmerc': case 'etmerc': {
      projKeys = ['lat_0', 'lon_0', 'k', 'k_0', 'x_0', 'y_0']
      centralMeridian = args.has('lon_0') ? number('lon_0', args.get('lon_0')) : 0
      projection = tmerc(ell, { lon0: deg('lon_0'), lat0: deg('lat_0'), k0: args.has('k_0') ? number('k_0', args.get('k_0')) : args.has('k') ? number('k', args.get('k')) : 1, x0: lin('x_0'), y0: lin('y_0') })
      defaultLabel = `Transverse Mercator, central meridian ${centralMeridian}° (${ellName})`
      break
    }
    case 'lcc': {
      projKeys = ['lat_0', 'lon_0', 'lat_1', 'lat_2', 'k', 'k_0', 'x_0', 'y_0']
      if (!args.has('lat_1')) throw new CrsError('Lambert Conformal Conic needs +lat_1')
      const lat1 = deg('lat_1')
      const lat2 = args.has('lat_2') ? deg('lat_2') : lat1
      const k0 = args.has('k_0') ? number('k_0', args.get('k_0')) : args.has('k') ? number('k', args.get('k')) : 1
      projection = lcc(ell, { lon0: deg('lon_0'), lat0: args.has('lat_0') ? deg('lat_0') : lat1, lat1, lat2, k0, x0: lin('x_0'), y0: lin('y_0') })
      defaultLabel = `Lambert Conformal Conic (${ellName})`
      break
    }
    case 'merc': {
      projKeys = ['lon_0', 'lat_ts', 'k', 'k_0', 'x_0', 'y_0']
      const k0 = args.has('lat_ts') ? mercScaleAt(ell, deg('lat_ts')) : args.has('k_0') ? number('k_0', args.get('k_0')) : args.has('k') ? number('k', args.get('k')) : 1
      projection = merc(ell, { lon0: deg('lon_0'), k0, x0: lin('x_0'), y0: lin('y_0') })
      defaultLabel = ell.f === 0 && ell.a === 6378137 ? 'Web Mercator' : `Mercator (${ellName})`
      break
    }
    default:
      throw new CrsError(`+proj=${proj} is not supported — this tool handles longlat, utm, tmerc, lcc and merc`)
  }

  for (const key of args.keys()) {
    if (!known.has(key) && !projKeys.includes(key)) throw new CrsError(`+${key} is not supported for +proj=${proj}`)
  }

  const pmRad = pm * DEG
  const toLocal = (lon: number, lat: number): [number, number] => {
    const l = lon * DEG, p = lat * DEG
    const [sl, sp] = geocentric ? datumFromWgs84(geocentric, l, p) : [l, p]
    return [sl - pmRad, sp]
  }
  const fromLocal = (lon: number, lat: number): [number, number] => {
    const l = lon + pmRad
    const [wl, wp] = geocentric ? datumToWgs84(geocentric, l, lat) : [l, lat]
    return [wl / DEG, wp / DEG]
  }

  const canonical = text.trim().split(/\s+/).filter(Boolean).map((t) => (t.startsWith('+') ? t : `+${t}`)).join(' ')

  if (kind === 'geographic') {
    return {
      kind, proj: canonical, label: label ?? defaultLabel, unitMetres: 1, unitLabel: 'degrees', datumWarning,
      forward: (lon, lat) => { const [l, p] = toLocal(lon, lat); return [l / DEG, p / DEG] },
      inverse: (x, y) => fromLocal(x * DEG, y * DEG),
    }
  }
  const pr = projection!
  return {
    kind, proj: canonical, label: label ?? defaultLabel, unitMetres, unitLabel, datumWarning, centralMeridian,
    forward: (lon, lat) => {
      const [l, p] = toLocal(lon, lat)
      const [x, y] = pr.forward(l, p)
      return [x / unitMetres, y / unitMetres]
    },
    inverse: (x, y) => {
      const [l, p] = pr.inverse(x * unitMetres, y * unitMetres)
      return fromLocal(l, p)
    },
  }
}

export function utmZoneFor(lon: number, lat: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180
  let zone = Math.min(60, Math.floor((wrapped + 180) / 6) + 1)
  // The two exceptions in the UTM grid: south-west Norway and Svalbard.
  if (lat >= 56 && lat < 64 && wrapped >= 3 && wrapped < 12) zone = 32
  if (lat >= 72 && lat < 84) {
    if (wrapped >= 0 && wrapped < 9) zone = 31
    else if (wrapped >= 9 && wrapped < 21) zone = 33
    else if (wrapped >= 21 && wrapped < 33) zone = 35
    else if (wrapped >= 33 && wrapped < 42) zone = 37
  }
  return zone
}

export function utmProj(zone: number, south: boolean) {
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`
}

export const WEB_MERCATOR = '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs'
export const LONLAT = '+proj=longlat +datum=WGS84 +no_defs'
