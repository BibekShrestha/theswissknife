/**
 * Builds a plot's true shape from what was measured and takes its area.
 *
 * Side lengths alone don't fix a shape (a 30-40-30-40 outline can be a
 * rectangle or a flattened parallelogram), so diagonals and corner angles
 * complete it — the tape-and-triangles method of field measurement. An
 * angle at corner k is turned into the distance between its two neighbours
 * by the law of cosines.
 *
 * Corners are then placed one at a time: each new corner needs measured
 * distances to two corners already placed, and of the two positions the
 * circles allow, the one on the same side as in the sketch is taken. The
 * area is the shoelace formula on the placed corners, so concave plots come
 * out right. Measurements beyond what the placement used are checked
 * against the result.
 */

import { asciiDigits } from '../units'
import { label, sideCount, type Plot } from './model'

export type LengthUnit = 'ft' | 'm'

/**
 * A measured length: a decimal, or in feet also feet-and-inches (30'6",
 * 30' 6, 30ft 6in). '' is "not measured" (undefined); anything else
 * unreadable is null.
 */
export function parseLength(raw: string, unit: LengthUnit): number | null | undefined {
  const text = asciiDigits(raw).trim().replace(/,/g, '')
  if (text === '') return undefined
  const num = '(\\d+(?:\\.\\d*)?|\\.\\d+)'
  if (new RegExp(`^${num}$`).test(text)) return Number(text)
  if (unit === 'ft') {
    const m = new RegExp(`^${num}\\s*(?:'|ft)\\s*(?:${num}\\s*(?:"|in)?)?$`).exec(text)
    if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0)
  }
  return null
}

export interface Solved {
  ok: true
  /** Corner positions in length units, same handedness as the sketch. */
  coords: [number, number][]
  /** Area in square length units. */
  area: number
  perimeter: number
  /** Measurements that disagree with the shape the others give. */
  conflicts: { what: string; measured: number; implied: number }[]
  /** True when the outline crosses itself. */
  crossing: boolean
}

export interface Unsolved {
  ok: false
  /** Which fields are unreadable or missing, for highlighting. */
  bad: { sides: number[]; diagonals: number[]; angles: number[] }
  message: string
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Relative disagreement above which measurements are reported. */
const TOLERANCE = 0.002

export function solvePlot(plot: Plot, unit: LengthUnit): Solved | Unsolved {
  const n = plot.points.length
  const bad = { sides: [] as number[], diagonals: [] as number[], angles: [] as number[] }
  if (!plot.closed || n < 3) return { ok: false, bad, message: n < 3 ? 'Draw at least three corners, then click the first corner to close the outline.' : 'Close the outline: click the first corner (A).' }

  const sides: number[] = []
  const missing: string[] = []
  for (let i = 0; i < sideCount(plot); i++) {
    const v = parseLength(plot.sides[i] ?? '', unit)
    // Missing is not wrong: only unreadable values are flagged on the field.
    if (v === undefined) missing.push(`${label(i)}–${label((i + 1) % n)}`)
    else if (v === null || !(v > 0)) bad.sides.push(i)
    sides.push(v ?? NaN)
  }
  const unreadable: string[] = []
  plot.diagonals.forEach((d, i) => {
    const v = parseLength(d.length, unit)
    if (v === null || (v !== undefined && !(v > 0))) { bad.diagonals.push(i); unreadable.push(`${label(d.a)}–${label(d.b)}`) }
  })
  plot.angles.forEach((a, i) => {
    if (a.trim() === '') return
    const v = Number(asciiDigits(a).trim())
    if (!Number.isFinite(v) || v <= 0 || v >= 360 || v === 180) { bad.angles.push(i); unreadable.push(`angle at ${label(i)}`) }
  })
  if (bad.sides.length || unreadable.length) {
    return { ok: false, bad, message: `Some measurements aren't numbers${unit === 'ft' ? ' (decimal feet, or feet and inches like 30\'6")' : ''}${unreadable.length ? `: ${unreadable.join(', ')}` : ''}. Angles are interior degrees between 0 and 360.` }
  }
  if (missing.length) return { ok: false, bad, message: `Enter the length of every side — missing: ${missing.join(', ')}.` }

  // Every known distance between corners, and where it came from.
  const known = new Map<string, { length: number; what: string }>()
  // Each measurement, checked against the placed shape at the end. An angle
  // is checked as an angle (in degrees), not as the distance it stands for.
  const constraints: { a: number; b: number; length: number; what: string; angle?: { at: number; degrees: number } }[] = []
  const know = (a: number, b: number, length: number, what: string, angle?: { at: number; degrees: number }) => {
    constraints.push({ a, b, length, what, angle })
    if (!known.has(key(a, b))) known.set(key(a, b), { length, what })
  }
  for (let i = 0; i < n; i++) know(i, (i + 1) % n, sides[i], `side ${label(i)}–${label((i + 1) % n)}`)
  plot.diagonals.forEach((d) => {
    const v = parseLength(d.length, unit)
    if (v !== undefined && v !== null) know(d.a, d.b, v, `diagonal ${label(d.a)}–${label(d.b)}`)
  })
  plot.angles.forEach((a, k) => {
    if (a.trim() === '') return
    const degrees = Number(asciiDigits(a).trim())
    const theta = (degrees * Math.PI) / 180
    const p = (k - 1 + n) % n, q = (k + 1) % n
    const x = sides[p], y = sides[k]
    know(p, q, Math.sqrt(Math.max(0, x * x + y * y - 2 * x * y * Math.cos(theta))), `angle at ${label(k)}`, { at: k, degrees })
  })

  const sketch = plot.points
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const dist = (i: number, j: number) => known.get(key(i, j))?.length

  // Try every known distance as the starting edge; keep the start that places most corners.
  let best: { coords: ([number, number] | null)[]; placed: number; error?: string } = { coords: [], placed: 0 }
  for (const start of known.keys()) {
    const [i0, j0] = start.split('-').map(Number)
    const coords: ([number, number] | null)[] = Array(n).fill(null)
    coords[i0] = [0, 0]
    coords[j0] = [known.get(start)!.length, 0]
    let placed = 2
    let error: string | undefined
    for (let progress = true; progress && placed < n && !error;) {
      progress = false
      for (let k = 0; k < n && !error; k++) {
        if (coords[k]) continue
        // The pair of placed corners with distances to k that is least flat in the sketch.
        let pick: [number, number] | null = null, pickWeight = -1
        for (let i = 0; i < n; i++) {
          if (!coords[i] || dist(i, k) === undefined) continue
          for (let j = 0; j < n; j++) {
            if (j === i || !coords[j] || dist(j, k) === undefined) continue
            const w = Math.abs(cross(sketch[i], sketch[j], sketch[k]))
            if (w > pickWeight) { pickWeight = w; pick = [i, j] }
          }
        }
        if (!pick) continue
        const [i, j] = pick
        const pi = coords[i]!, pj = coords[j]!
        const dx = pj[0] - pi[0], dy = pj[1] - pi[1]
        const d = Math.hypot(dx, dy)
        const ri = dist(i, k)!, rj = dist(j, k)!
        const along = (ri * ri - rj * rj + d * d) / (2 * d)
        const h2 = ri * ri - along * along
        if (h2 < -1e-9 * ri * ri) {
          error = `${label(i)}, ${label(j)} and ${label(k)} can't form a triangle: ${known.get(key(i, k))!.what} (${fmt(ri)}), ${known.get(key(j, k))!.what} (${fmt(rj)}) and the ${fmt(d)} between ${label(i)} and ${label(j)} don't fit together. Check those measurements.`
          break
        }
        const h = Math.sqrt(Math.max(0, h2)) * (cross(sketch[i], sketch[j], sketch[k]) >= 0 ? 1 : -1)
        coords[k] = [pi[0] + (along * dx - h * dy) / d, pi[1] + (along * dy + h * dx) / d]
        placed++
        progress = true
      }
    }
    if (placed > best.placed || (placed === best.placed && error && !best.error)) best = { coords, placed, error }
    if (placed === n && !error) break
  }

  if (best.error && best.placed < n) return { ok: false, bad, message: best.error }
  if (best.placed < n) {
    const loose = best.coords.map((c, i) => (c ? null : label(i))).filter(Boolean)
    const fixed = best.coords.map((c, i) => (c ? i : -1)).filter((i) => i >= 0)
    const u = best.coords.findIndex((c) => !c)
    const target = fixed.find((i) => i !== (u + 1) % n && i !== (u - 1 + n) % n)
    const hint = target !== undefined ? ` For example, measure the diagonal ${label(Math.min(u, target))}–${label(Math.max(u, target))}, or enter a corner angle.` : ' Measure a diagonal or enter a corner angle.'
    return { ok: false, bad, message: `The sides don't fix the shape yet — corner${loose.length > 1 ? 's' : ''} ${loose.join(', ')} could still swing.${hint}` }
  }

  const coords = best.coords as [number, number][]
  let area = 0
  for (let i = 0, j = n - 1; i < n; j = i++) area += coords[j][0] * coords[i][1] - coords[i][0] * coords[j][1]
  area = Math.abs(area) / 2

  const conflicts: Solved['conflicts'] = []
  for (const c of constraints) {
    if (c.angle) {
      const implied = interiorAngle(coords, c.angle.at)
      if (Math.abs(implied - c.angle.degrees) > 0.2) conflicts.push({ what: c.what, measured: c.angle.degrees, implied })
    } else {
      const implied = Math.hypot(coords[c.a][0] - coords[c.b][0], coords[c.a][1] - coords[c.b][1])
      if (Math.abs(implied - c.length) > TOLERANCE * c.length) conflicts.push({ what: c.what, measured: c.length, implied })
    }
  }

  return { ok: true, coords, area, perimeter: sides.reduce((s, v) => s + v, 0), conflicts, crossing: selfCrossing(coords) }
}

/** Interior angle at corner k of the placed outline, in degrees, for either winding. */
export function interiorAngle(coords: [number, number][], k: number): number {
  const n = coords.length
  const p = coords[(k - 1 + n) % n], c = coords[k], q = coords[(k + 1) % n]
  const v1 = [q[0] - c[0], q[1] - c[1]], v2 = [p[0] - c[0], p[1] - c[1]]
  let deg = (Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * 180) / Math.PI
  if (deg < 0) deg += 360
  let signed = 0
  for (let i = 0, j = n - 1; i < n; j = i++) signed += coords[j][0] * coords[i][1] - coords[i][0] * coords[j][1]
  return signed > 0 ? deg : 360 - deg
}

function selfCrossing(c: [number, number][]): boolean {
  const n = c.length
  const orient = (a: [number, number], b: [number, number], p: [number, number]) => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      const a = c[i], b = c[(i + 1) % n], p = c[j], q = c[(j + 1) % n]
      if (orient(a, b, p) * orient(a, b, q) < 0 && orient(p, q, a) * orient(p, q, b) < 0) return true
    }
  }
  return false
}

function fmt(v: number) {
  return Number(v.toFixed(3)).toString()
}
