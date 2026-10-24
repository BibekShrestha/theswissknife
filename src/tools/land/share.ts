/**
 * The URL fragment: `#m=<mode>&v=<values>`, readable and short, like the
 * CIDR tool's. A sketched plot adds its corners (`p`), sides (`s`),
 * diagonals (`d`), angles (`g`) and length unit (`u`). Areas are not
 * secrets, but the fragment never reaches a server anyway; a dropped KML
 * file is never put in it. Everything read
 * back is clipped and checked; anything odd falls back to the defaults.
 */

import { adjacent, EMPTY_PLOT, MAX_CORNERS, SKETCH_H, SKETCH_W, template, type Plot } from './plot/model'
import type { LengthUnit } from './plot/solve'
import { asciiDigits, UNIT, type UnitId } from './units'

export type Mode = 'hill' | 'terai' | 'unit' | 'plot' | 'earth'

export interface State {
  mode: Mode
  /** Compound parts or the single value. */
  values: string[]
  unit: UnitId
  plot: Plot
  lengthUnit: LengthUnit
}

export const DEFAULTS: State = { mode: 'hill', values: ['0', '4', '2', '1'], unit: 'm2', plot: EMPTY_PLOT, lengthUnit: 'ft' }

/** The plot a fresh "Sketch a plot" starts with: a rectangle with square corners. */
export const START_PLOT = template(4)

const MODES: Mode[] = ['hill', 'terai', 'unit', 'plot', 'earth']
export const SIZE: Record<Mode, number> = { hill: 4, terai: 3, unit: 1, plot: 0, earth: 0 }
const VALUE = /^[0-9.,]{0,20}$/
/** A typed length or angle: digits, a decimal point, feet-and-inches marks. */
const MEASURE = /^[0-9.,'" a-z]{0,20}$/i

function readPlot(params: URLSearchParams): Plot | null {
  const raw = params.get('p')
  if (!raw) return null
  const points = raw.split('_').map((pair) => pair.split('.').map(Number) as [number, number])
  const n = points.length
  if (n < 1 || n > MAX_CORNERS) return null
  if (points.some((p) => p.length !== 2 || !p.every(Number.isInteger) || p[0] < 0 || p[0] > SKETCH_W || p[1] < 0 || p[1] > SKETCH_H)) return null
  const closed = params.get('c') === '1' && n >= 3
  const list = (key: string) => {
    const values = (params.get(key) ?? '').split('_').slice(0, n).map(asciiDigits)
    while (values.length < n) values.push('')
    return values.every((v) => MEASURE.test(v)) ? values : null
  }
  const sides = list('s'), angles = list('g')
  if (!sides || !angles) return null
  const plot: Plot = { points, closed, sides, angles, diagonals: [] }
  for (const entry of (params.get('d') ?? '').split('_').filter(Boolean).slice(0, 100)) {
    const [a, b, length = ''] = entry.split('~')
    const ia = Number(a), ib = Number(b)
    if (!closed || !Number.isInteger(ia) || !Number.isInteger(ib) || ia < 0 || ib < 0 || ia >= n || ib >= n || adjacent(plot, ia, ib) || !MEASURE.test(length)) return null
    if (plot.diagonals.some((d) => d.a === Math.min(ia, ib) && d.b === Math.max(ia, ib))) continue
    plot.diagonals.push({ a: Math.min(ia, ib), b: Math.max(ia, ib), length })
  }
  return plot
}

export function readFragment(hash: string): State {
  if (!hash.startsWith('#m=')) return DEFAULTS
  let params: URLSearchParams
  try { params = new URLSearchParams(hash.slice(1)) } catch { return DEFAULTS }
  const mode = params.get('m') as Mode
  if (!MODES.includes(mode)) return DEFAULTS
  // A dropped file is the user's own data: it never goes into the link.
  if (mode === 'earth') return { ...DEFAULTS, mode, values: [] }
  if (mode === 'plot') {
    const plot = params.has('p') ? readPlot(params) : EMPTY_PLOT
    if (!plot) return DEFAULTS
    return { ...DEFAULTS, mode, values: [], plot, lengthUnit: params.get('u') === 'm' ? 'm' : 'ft' }
  }
  const values = (params.get('v') ?? '').split('_').slice(0, SIZE[mode])
  if (values.some((v) => !VALUE.test(v))) return DEFAULTS
  while (values.length < SIZE[mode]) values.push('')
  const unit = params.get('u') as UnitId
  return { ...DEFAULTS, mode, values, unit: mode === 'unit' && unit in UNIT ? unit : DEFAULTS.unit }
}

export function writeFragment(state: State): string {
  const params = new URLSearchParams({ m: state.mode })
  if (state.mode === 'earth') return `#${params.toString()}`
  if (state.mode === 'plot') {
    const { plot } = state
    if (plot.points.length) {
      params.set('p', plot.points.map((p) => p.join('.')).join('_'))
      if (plot.closed) params.set('c', '1')
      const trim = (list: string[]) => list.map((v) => asciiDigits(v).trim()).join('_').replace(/_+$/, '')
      if (trim(plot.sides)) params.set('s', trim(plot.sides))
      if (trim(plot.angles)) params.set('g', trim(plot.angles))
      if (plot.diagonals.length) params.set('d', plot.diagonals.map((d) => `${d.a}~${d.b}~${asciiDigits(d.length).trim()}`).join('_'))
    }
    params.set('u', state.lengthUnit)
    return `#${params.toString()}`
  }
  params.set('v', state.values.map((v) => asciiDigits(v).trim()).join('_'))
  if (state.mode === 'unit') params.set('u', state.unit)
  return `#${params.toString()}`
}
