/**
 * Transverse Mercator and a geocentric datum shift, copied from
 * tools/kml/proj/projections.ts (tmerc, Krüger's series to sixth order in n,
 * Karney 2011 — the algorithm PROJ uses) and tools/kml/proj/crs.ts (ECEF
 * conversion and the Helmert shift, as PROJ does it). Copied, not imported:
 * tools never import from each other. Only what MUTM needs is here — no
 * rotations or scale, since the one shift offered is translations only.
 */

export interface Ellipsoid {
  a: number
  /** Flattening. */
  f: number
}

export interface Projection {
  /** Longitude, latitude in radians on the projection's ellipsoid → x, y in metres. */
  forward(lon: number, lat: number): [number, number]
  inverse(x: number, y: number): [number, number]
}

export interface TmercParams {
  lon0: number
  lat0: number
  k0: number
  x0: number
  y0: number
}

/** Conformal latitude parameter τ' from τ = tan φ (Karney 2011, eq. 7–9). */
function tauPrime(tau: number, e: number) {
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.hypot(1, tau)))
  return tau * Math.hypot(1, sigma) - sigma * Math.hypot(1, tau)
}

/** Inverse of tauPrime by Newton's method (Karney 2011, eq. 19–21). */
function tauFromPrime(taup: number, e: number) {
  const e2m = 1 - e * e
  let tau = taup / e2m
  for (let i = 0; i < 12; i++) {
    const tp = tauPrime(tau, e)
    const delta = ((taup - tp) / Math.hypot(1, tp)) * ((1 + e2m * tau * tau) / (e2m * Math.hypot(1, tau)))
    tau += delta
    if (Math.abs(delta) <= 1e-14 * Math.max(1, Math.abs(tau))) break
  }
  return tau
}

export function tmerc(ell: Ellipsoid, p: TmercParams): Projection {
  const e = Math.sqrt(ell.f * (2 - ell.f))
  const n = ell.f / (2 - ell.f)
  const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256)
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
    (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
    (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
    (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
    (212378941 * n6) / 319334400,
  ]
  const beta = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
    (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
    (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
    (4583 * n5) / 161280 - (108847 * n6) / 3991680,
    (20648693 * n6) / 638668800,
  ]
  const scale = p.k0 * A

  const toXiEta = (lam: number, phi: number): [number, number] => {
    const taup = tauPrime(Math.tan(phi), e)
    const xip = Math.atan2(taup, Math.cos(lam))
    const etap = Math.asinh(Math.sin(lam) / Math.hypot(taup, Math.cos(lam)))
    let xi = xip, eta = etap
    for (let j = 1; j <= 6; j++) {
      xi += alpha[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap)
      eta += alpha[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap)
    }
    return [xi, eta]
  }
  const xi0 = p.lat0 === 0 ? 0 : toXiEta(0, p.lat0)[0]

  return {
    forward(lon, lat) {
      const [xi, eta] = toXiEta(lon - p.lon0, lat)
      return [p.x0 + scale * eta, p.y0 + scale * (xi - xi0)]
    },
    inverse(x, y) {
      const xi = (y - p.y0) / scale + xi0
      const eta = (x - p.x0) / scale
      let xip = xi, etap = eta
      for (let j = 1; j <= 6; j++) {
        xip -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta)
        etap -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta)
      }
      const taup = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip))
      const lam = Math.atan2(Math.sinh(etap), Math.cos(xip))
      return [p.lon0 + lam, Math.atan(tauFromPrime(taup, e))]
    },
  }
}

export const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 }

function toEcef(ell: Ellipsoid, lon: number, lat: number): [number, number, number] {
  const e2 = ell.f * (2 - ell.f)
  const sin = Math.sin(lat)
  const N = ell.a / Math.sqrt(1 - e2 * sin * sin)
  return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - e2) * sin]
}

/** ECEF → geodetic (Bowring's start, then iterated; the height is dropped). */
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

/**
 * Geocentric translations (EPSG method 9603, geog2D domain): the point is
 * taken at height 0 on the side it starts from, shifted through ECEF, and
 * its new height dropped — what PROJ's pipeline does for a 2D CRS.
 */
export interface Translation {
  ell: Ellipsoid
  dx: number
  dy: number
  dz: number
}

/** Source datum → WGS84, radians. */
export function shiftToWgs84(t: Translation, lon: number, lat: number): [number, number] {
  const [x, y, z] = toEcef(t.ell, lon, lat)
  return fromEcef(WGS84, x + t.dx, y + t.dy, z + t.dz)
}

/** WGS84 → source datum, radians. */
export function shiftFromWgs84(t: Translation, lon: number, lat: number): [number, number] {
  const [x, y, z] = toEcef(WGS84, lon, lat)
  return fromEcef(t.ell, x - t.dx, y - t.dy, z - t.dz)
}
