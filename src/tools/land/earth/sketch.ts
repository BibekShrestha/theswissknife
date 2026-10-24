/**
 * A traced outline as a plot sketch: corners laid out north-up in the
 * sketch box, each side's length, and diagonals fanned from corner A — the
 * n − 3 measurements that fix the shape — so the sketch solves to the same
 * area and the user can overwrite any length with a tape measurement.
 */

import { MAX_CORNERS, SKETCH_H, SKETCH_W, type Plot } from '../plot/model'
import type { LengthUnit } from '../plot/solve'
import { distance, project, sideLengths } from './geodesy'

const FOOT = 0.3048

export function toPlot(outer: number[], unit: LengthUnit): Plot | null {
  const n = outer.length / 2
  if (n < 3 || n > MAX_CORNERS) return null
  const [pts] = project([outer])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const minX = Math.min(...xs), maxY = Math.max(...ys)
  const span = Math.max(Math.max(...xs) - minX, maxY - Math.min(...ys)) || 1
  const k = Math.min((SKETCH_W - 80) / span, (SKETCH_H - 80) / span)
  const ox = (SKETCH_W - (Math.max(...xs) - minX) * k) / 2, oy = (SKETCH_H - (maxY - Math.min(...ys)) * k) / 2
  const len = (metres: number) => String(Number((unit === 'ft' ? metres / FOOT : metres).toFixed(2)))
  const at = (i: number) => [outer[i * 2], outer[i * 2 + 1]] as const
  return {
    // North is up: the sketch's y grows downward.
    points: pts.map(([x, y]) => [Math.round(ox + (x - minX) * k), Math.round(oy + (maxY - y) * k)] as [number, number]),
    closed: true,
    sides: sideLengths(outer).map(len),
    diagonals: Array.from({ length: Math.max(0, n - 3) }, (_, i) => {
      const b = i + 2
      return { a: 0, b, length: len(distance(...at(0), ...at(b))) }
    }),
    angles: Array(n).fill(''),
  }
}
