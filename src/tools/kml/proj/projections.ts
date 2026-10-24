/**
 * Map projections, hand-written: every one is forward (lon, lat in radians
 * on the CRS's own ellipsoid → x, y in metres) and inverse. Constants are
 * computed once per CRS in the factory, not per point.
 *
 * Transverse Mercator is Krüger's series to sixth order in n (Karney 2011,
 * the algorithm PROJ uses for tmerc/utm): millimetre-exact within a few
 * thousand km of the central meridian. Lambert Conformal Conic and Mercator
 * are Snyder's ellipsoidal formulas (USGS PP 1395, §15 and §7).
 */

export interface Ellipsoid {
  a: number
  /** Flattening; 0 for a sphere. */
  f: number
}

export interface Projection {
  forward(lon: number, lat: number): [number, number]
  inverse(x: number, y: number): [number, number]
}

const HALF_PI = Math.PI / 2

function eccentricity(ell: Ellipsoid) {
  return Math.sqrt(ell.f * (2 - ell.f))
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

export interface TmercParams {
  lon0: number
  lat0: number
  k0: number
  x0: number
  y0: number
}

export function tmerc(ell: Ellipsoid, p: TmercParams): Projection {
  const e = eccentricity(ell)
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

/** Snyder's t (eq. 15-9): the isometric-latitude term shared by LCC and Mercator. */
function tsfn(phi: number, e: number) {
  const s = e * Math.sin(phi)
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - s) / (1 + s), e / 2)
}

/** Latitude from t (Snyder eq. 7-9), iterated. */
function phiFromTs(ts: number, e: number) {
  let phi = HALF_PI - 2 * Math.atan(ts)
  for (let i = 0; i < 20; i++) {
    const s = e * Math.sin(phi)
    const next = HALF_PI - 2 * Math.atan(ts * Math.pow((1 - s) / (1 + s), e / 2))
    if (Math.abs(next - phi) < 1e-14) return next
    phi = next
  }
  return phi
}

function msfn(phi: number, e: number) {
  const s = e * Math.sin(phi)
  return Math.cos(phi) / Math.sqrt(1 - s * s)
}

export interface LccParams {
  lon0: number
  lat0: number
  lat1: number
  lat2: number
  k0: number
  x0: number
  y0: number
}

export function lcc(ell: Ellipsoid, p: LccParams): Projection {
  const e = eccentricity(ell)
  const m1 = msfn(p.lat1, e), t1 = tsfn(p.lat1, e)
  const n = Math.abs(p.lat1 - p.lat2) < 1e-10
    ? Math.sin(p.lat1)
    : (Math.log(m1) - Math.log(msfn(p.lat2, e))) / (Math.log(t1) - Math.log(tsfn(p.lat2, e)))
  if (Math.abs(n) < 1e-10) throw new Error('Lambert Conformal Conic needs standard parallels off the equator (lat_1 = -lat_2 gives a cylinder)')
  const F = m1 / (n * Math.pow(t1, n))
  const aF = ell.a * p.k0 * F
  const rho0 = Math.abs(Math.abs(p.lat0) - HALF_PI) < 1e-12 ? 0 : aF * Math.pow(tsfn(p.lat0, e), n)
  return {
    forward(lon, lat) {
      const rho = Math.abs(Math.abs(lat) - HALF_PI) < 1e-12
        ? (lat * n > 0 ? 0 : Infinity)
        : aF * Math.pow(tsfn(lat, e), n)
      const theta = n * (lon - p.lon0)
      return [p.x0 + rho * Math.sin(theta), p.y0 + rho0 - rho * Math.cos(theta)]
    },
    inverse(x, y) {
      let dx = x - p.x0
      let dy = rho0 - (y - p.y0)
      let rho = Math.hypot(dx, dy)
      if (n < 0) { rho = -rho; dx = -dx; dy = -dy }
      if (rho === 0) return [p.lon0, n > 0 ? HALF_PI : -HALF_PI]
      const theta = Math.atan2(dx, dy)
      const ts = Math.pow(rho / aF, 1 / n)
      return [p.lon0 + theta / n, phiFromTs(ts, e)]
    },
  }
}

export interface MercParams {
  lon0: number
  k0: number
  x0: number
  y0: number
}

/** Mercator; a spherical ellipsoid (f = 0) gives Web Mercator. */
export function merc(ell: Ellipsoid, p: MercParams): Projection {
  const e = eccentricity(ell)
  const ak = ell.a * p.k0
  return {
    forward(lon, lat) {
      return [p.x0 + ak * (lon - p.lon0), p.y0 - ak * Math.log(tsfn(lat, e))]
    },
    inverse(x, y) {
      return [p.lon0 + (x - p.x0) / ak, phiFromTs(Math.exp(-(y - p.y0) / ak), e)]
    },
  }
}

/** Mercator scale at a latitude of true scale (Snyder eq. 7-8 / msfn). */
export function mercScaleAt(ell: Ellipsoid, latTs: number) {
  return msfn(latTs, eccentricity(ell))
}
