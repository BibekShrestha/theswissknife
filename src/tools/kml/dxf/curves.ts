/**
 * Curves flattened to polylines. Arcs use a fixed angular step, so the
 * chord error is a fixed fraction of the radius (1 − cos 1.5° ≈ 0.034%):
 * about 3.4 cm on a 100 m curve, well under what a map shows.
 */

const STEP = (3 * Math.PI) / 180
const TAU = Math.PI * 2

export function arcSegments(sweep: number) {
  return Math.max(4, Math.min(720, Math.ceil(Math.abs(sweep) / STEP)))
}

/**
 * Appends points along an arc (angles in radians, sweep signed: positive is
 * counter-clockwise), excluding the start point and including the end.
 */
export function pushArc(out: number[], cx: number, cy: number, z: number, r: number, start: number, sweep: number, includeStart = false) {
  const n = arcSegments(sweep)
  for (let k = includeStart ? 0 : 1; k <= n; k++) {
    const a = start + (sweep * k) / n
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z)
  }
}

/**
 * The arc a bulge describes between two vertices (bulge = tan(θ/4), positive
 * counter-clockwise): appends the interior points only.
 */
export function pushBulge(out: number[], x1: number, y1: number, x2: number, y2: number, z: number, bulge: number) {
  const dx = x2 - x1, dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  if (!bulge || chord === 0 || !Number.isFinite(bulge)) return
  const theta = 4 * Math.atan(bulge)
  const r = chord / (2 * Math.sin(theta / 2))
  const h = r * Math.cos(theta / 2)
  const cx = (x1 + x2) / 2 - (dy / chord) * h
  const cy = (y1 + y2) / 2 + (dx / chord) * h
  const start = Math.atan2(y1 - cy, x1 - cx)
  const n = arcSegments(theta)
  const radius = Math.abs(r)
  for (let k = 1; k < n; k++) {
    const a = start + (theta * k) / n
    out.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a), z)
  }
}

/** Counter-clockwise sweep from start to end (radians), in (0, 2π]. */
export function ccwSweep(start: number, end: number) {
  let sweep = (end - start) % TAU
  if (sweep <= 1e-12) sweep += TAU
  return sweep
}

/**
 * A NURBS curve sampled by de Boor's algorithm in homogeneous coordinates.
 * Returns null when the knot vector doesn't fit the control points.
 */
export function sampleNurbs(degree: number, knots: number[], control: number[], weights: number[] | null, samples: number): number[] | null {
  const n = control.length / 3
  if (degree < 1 || n <= degree || knots.length !== n + degree + 1) return null
  for (let i = 1; i < knots.length; i++) if (knots[i] < knots[i - 1]) return null
  const lo = knots[degree], hi = knots[n]
  if (!(hi > lo)) return null
  const w = (i: number) => (weights && weights.length === n ? weights[i] : 1)
  const out: number[] = []
  const d: number[] = new Array((degree + 1) * 4)
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? hi : lo + ((hi - lo) * s) / samples
    // Knot span: the last k with knots[k] <= t < knots[k + 1], clamped to the domain.
    let k = degree
    while (k < n - 1 && knots[k + 1] <= t) k++
    for (let j = 0; j <= degree; j++) {
      const i = k - degree + j
      const wi = w(i)
      d[j * 4] = control[i * 3] * wi
      d[j * 4 + 1] = control[i * 3 + 1] * wi
      d[j * 4 + 2] = control[i * 3 + 2] * wi
      d[j * 4 + 3] = wi
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j
        const denom = knots[i + degree - r + 1] - knots[i]
        const alpha = denom === 0 ? 0 : (t - knots[i]) / denom
        for (let c = 0; c < 4; c++) d[j * 4 + c] = (1 - alpha) * d[(j - 1) * 4 + c] + alpha * d[j * 4 + c]
      }
    }
    const wt = d[degree * 4 + 3]
    if (!wt) return null
    out.push(d[degree * 4] / wt, d[degree * 4 + 1] / wt, d[degree * 4 + 2] / wt)
  }
  return out
}

/** Signed area of a ring (x, y of a stride-3 array); positive is counter-clockwise. */
export function ringArea(c: number[]) {
  let a = 0
  for (let i = 0, j = c.length - 3; i < c.length; j = i, i += 3) a += c[j] * c[i + 1] - c[i] * c[j + 1]
  return a / 2
}

export function pointInRing(x: number, y: number, c: number[]) {
  let inside = false
  for (let i = 0, j = c.length - 3; i < c.length; j = i, i += 3) {
    const xi = c[i], yi = c[i + 1], xj = c[j], yj = c[j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
