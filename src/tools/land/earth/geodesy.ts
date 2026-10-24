/**
 * Area and side lengths of a lon/lat outline on the WGS84 ellipsoid.
 *
 * Area: the outline is projected with the ellipsoidal Lambert azimuthal
 * equal-area projection centred on it (Snyder, USGS PP 1395, eq. 3-12,
 * 14-15 – 24-21), and the shoelace formula is taken in that plane. An
 * equal-area projection preserves area exactly, so the only difference
 * from a geodesic polygon area is that edges are straight in the plane
 * rather than geodesics — negligible at plot scale (checked against
 * pyproj's Karney area in geodesy.test.ts: under 1e-7 relative for plots
 * and kilometre fields, 3e-7 for a 10 km block).
 *
 * Side lengths: Vincenty's inverse formula (sub-millimetre; it only fails
 * near antipodal points, which no plot has).
 */

const A = 6378137
const F = 1 / 298.257223563
const B = A * (1 - F)
const E2 = F * (2 - F)
const E = Math.sqrt(E2)
const DEG = Math.PI / 180

/** Snyder's q (eq. 3-12): the authalic latitude term. */
function qfn(phi: number) {
  const s = Math.sin(phi)
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)))
}

const QP = qfn(Math.PI / 2)
const RQ = A * Math.sqrt(QP / 2)

/** Lambert azimuthal equal-area projection centred at lon0, lat0 (degrees), in metres. */
export function laea(lon0: number, lat0: number) {
  const phi1 = lat0 * DEG
  const beta1 = Math.asin(qfn(phi1) / QP)
  const m1 = Math.cos(phi1) / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2)
  const D = (A * m1) / (RQ * Math.cos(beta1))
  return (lon: number, lat: number): [number, number] => {
    const beta = Math.asin(Math.max(-1, Math.min(1, qfn(lat * DEG) / QP)))
    const dl = (lon - lon0) * DEG
    const b = RQ * Math.sqrt(2 / (1 + Math.sin(beta1) * Math.sin(beta) + Math.cos(beta1) * Math.cos(beta) * Math.cos(dl)))
    return [b * D * Math.cos(beta) * Math.sin(dl), (b / D) * (Math.cos(beta1) * Math.sin(beta) - Math.sin(beta1) * Math.cos(beta) * Math.cos(dl))]
  }
}

/** Longitudes unwrapped around the first vertex, so an outline across ±180° stays whole. */
function unwrap(ring: number[]): number[] {
  const out = ring.slice()
  for (let i = 2; i < out.length; i += 2) {
    while (out[i] - out[0] > 180) out[i] -= 360
    while (out[i] - out[0] < -180) out[i] += 360
  }
  return out
}

/** The centre of the outer ring's bounding box, for the projection. */
export function centre(rings: number[][]): [number, number] {
  const r = unwrap(rings[0])
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i])
    minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1])
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

/** Each ring projected into the equal-area plane around the outline's centre (metres). */
export function project(rings: number[][]): [number, number][][] {
  const [lon0, lat0] = centre(rings)
  const fwd = laea(lon0, lat0)
  return rings.map((r) => {
    const u = unwrap(r)
    const pts: [number, number][] = []
    for (let i = 0; i < u.length; i += 2) {
      let lon = u[i]
      while (lon - lon0 > 180) lon -= 360
      while (lon - lon0 < -180) lon += 360
      pts.push(fwd(lon, u[i + 1]))
    }
    return pts
  })
}

function shoelace(pts: [number, number][]) {
  let s = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return Math.abs(s) / 2
}

/** Area in m²: the outer ring less its holes. */
export function ellipsoidArea(rings: number[][]): number {
  const planar = project(rings)
  return Math.max(0, planar.reduce((sum, pts, i) => sum + (i === 0 ? 1 : -1) * shoelace(pts), 0))
}

/** Distance in metres between two lon/lat points on WGS84 (Vincenty inverse). */
export function distance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const L = (lon2 - lon1) * DEG
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * DEG))
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * DEG))
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2)
  let lambda = L
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda)
    sinSigma = Math.hypot(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL)
    if (sinSigma === 0) return 0
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma
    cos2Alpha = 1 - sinAlpha * sinAlpha
    cos2SigmaM = cos2Alpha ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha))
    const prev = lambda
    lambda = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
    if (Math.abs(lambda - prev) < 1e-13) break
  }
  const u2 = (cos2Alpha * (A * A - B * B)) / (B * B)
  const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
  const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
  const dSigma = BB * sinSigma * (cos2SigmaM + (BB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - (BB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)))
  return B * AA * (sigma - dSigma)
}

/** Side lengths of a ring (metres), corner i to corner i + 1, closing side last. */
export function sideLengths(ring: number[]): number[] {
  const n = ring.length / 2
  return Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n
    return distance(ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1])
  })
}
