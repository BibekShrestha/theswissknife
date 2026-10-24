/**
 * The one feature model both directions go through. Coordinates are flat
 * arrays with stride 3 (x, y, z): lon/lat/altitude on the KML side, drawing
 * units on the DXF side.
 */

export interface Rgb { r: number; g: number; b: number }

export type Geometry =
  | { type: 'point'; at: number[] }
  /** An open or closed polyline. */
  | { type: 'line'; coords: number[]; closed: boolean }
  /** First ring is the outer boundary, the rest are holes. Rings are not repeated at the end. */
  | { type: 'polygon'; rings: number[][] }
  | { type: 'text'; at: number[]; text: string; height: number; rotation: number }

export interface Feature {
  geometry: Geometry
  name: string
  layer: string
  /** Line / icon colour; null = by layer. */
  color: Rgb | null
  /** Fill colour with alpha 0–1, KML only. */
  fill?: { color: Rgb; alpha: number } | null
  /** Where it came from, for counts: "Placemark", "LWPOLYLINE", … */
  source: string
}

export interface Layer {
  name: string
  color: Rgb | null
}

export interface Note {
  level: 'info' | 'warn'
  text: string
}

/** Counts things that were skipped or changed, so the notes name each kind once. */
export class Tally {
  private counts = new Map<string, number>()
  add(key: string, n = 1) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n)
  }
  entries() {
    return [...this.counts.entries()].sort((a, b) => b[1] - a[1])
  }
  get size() {
    return this.counts.size
  }
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

export function vertexCount(g: Geometry): number {
  switch (g.type) {
    case 'point': case 'text': return g.at.length / 3
    case 'line': return g.coords.length / 3
    case 'polygon': return g.rings.reduce((sum, ring) => sum + ring.length / 3, 0)
  }
}
