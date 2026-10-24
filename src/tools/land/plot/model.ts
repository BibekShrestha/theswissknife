/**
 * A plot sketch: corners in drawing coordinates (only their order and
 * rough layout matter) plus what was measured on the ground — side lengths,
 * diagonals and corner angles, kept as the text the user typed.
 *
 * `sides[i]` is the side from corner i to corner i + 1; the last one is the
 * closing side and only exists once the outline is closed. Every edit returns
 * a new Plot.
 */

export interface Diagonal {
  a: number
  b: number
  length: string
}

export interface Plot {
  points: [number, number][]
  closed: boolean
  sides: string[]
  diagonals: Diagonal[]
  /** Interior angle at each corner in degrees; '' when not measured. */
  angles: string[]
}

/** The drawing area, in SVG user units. */
export const SKETCH_W = 600
export const SKETCH_H = 400
export const MAX_CORNERS = 26

export const EMPTY_PLOT: Plot = { points: [], closed: false, sides: [], diagonals: [], angles: [] }

export const label = (i: number) => String.fromCharCode(65 + i)
export const sideName = (plot: Plot, i: number) => `${label(i)}–${label((i + 1) % plot.points.length)}`

/** Number of sides that exist: n − 1 while open, n once closed. */
export function sideCount(plot: Plot) {
  const n = plot.points.length
  return plot.closed ? n : Math.max(0, n - 1)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function addCorner(plot: Plot, x: number, y: number): Plot {
  if (plot.closed || plot.points.length >= MAX_CORNERS) return plot
  return {
    ...plot,
    points: [...plot.points, [clamp(Math.round(x), 0, SKETCH_W), clamp(Math.round(y), 0, SKETCH_H)]],
    sides: [...plot.sides, ''],
    angles: [...plot.angles, ''],
  }
}

export function close(plot: Plot): Plot {
  return plot.points.length >= 3 && !plot.closed ? { ...plot, closed: true } : plot
}

/** Reopens a closed outline, or removes the last corner and what touches it. */
export function undo(plot: Plot): Plot {
  if (plot.closed) return { ...plot, closed: false }
  const last = plot.points.length - 1
  if (last < 0) return plot
  return {
    points: plot.points.slice(0, -1),
    closed: false,
    sides: plot.sides.slice(0, -1),
    diagonals: plot.diagonals.filter((d) => d.a !== last && d.b !== last),
    angles: plot.angles.slice(0, -1),
  }
}

export function moveCorner(plot: Plot, i: number, x: number, y: number): Plot {
  const points = plot.points.slice()
  points[i] = [clamp(Math.round(x), 0, SKETCH_W), clamp(Math.round(y), 0, SKETCH_H)]
  return { ...plot, points }
}

export function setSide(plot: Plot, i: number, length: string): Plot {
  const sides = plot.sides.slice()
  sides[i] = length
  return { ...plot, sides }
}

export function setAngle(plot: Plot, i: number, angle: string): Plot {
  const angles = plot.angles.slice()
  angles[i] = angle
  return { ...plot, angles }
}

/** Whether a and b are joined by a side (so a diagonal between them makes no sense). */
export function adjacent(plot: Plot, a: number, b: number) {
  const n = plot.points.length
  return a === b || (a + 1) % n === b || (b + 1) % n === a
}

export function addDiagonal(plot: Plot, a: number, b: number): Plot {
  if (!plot.closed || adjacent(plot, a, b)) return plot
  if (plot.diagonals.some((d) => (d.a === a && d.b === b) || (d.a === b && d.b === a))) return plot
  return { ...plot, diagonals: [...plot.diagonals, { a: Math.min(a, b), b: Math.max(a, b), length: '' }] }
}

export function setDiagonal(plot: Plot, index: number, length: string): Plot {
  return { ...plot, diagonals: plot.diagonals.map((d, i) => (i === index ? { ...d, length } : d)) }
}

export function removeDiagonal(plot: Plot, index: number): Plot {
  return { ...plot, diagonals: plot.diagonals.filter((_, i) => i !== index) }
}

/**
 * A closed regular outline with n corners to start from — the keyboard way
 * in, and a quick start. A rectangle gets its four right angles filled in.
 */
export function template(n: number): Plot {
  const count = clamp(Math.round(n), 3, 12)
  const cx = SKETCH_W / 2, cy = SKETCH_H / 2
  const points: [number, number][] = count === 4
    ? [[150, 90], [450, 90], [450, 310], [150, 310]]
    : Array.from({ length: count }, (_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / count
      return [Math.round(cx + 150 * Math.cos(a)), Math.round(cy + 150 * Math.sin(a))]
    })
  return {
    points,
    closed: true,
    sides: Array(count).fill(''),
    diagonals: [],
    angles: Array(count).fill(count === 4 ? '90' : ''),
  }
}
