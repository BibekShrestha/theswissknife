import { isValidZone, parseIsoDate, parseLocalDateTime } from './zone'

/**
 * Fragment state. The planner uses `#zones=…&date=…&work=…&sel=…`, the
 * durations tab `#d=…&dz=…&e=…&ez=…&p=…&b=…&bz=…&op=…`. Only zone names,
 * dates, times and a duration travel — the meeting title never does.
 */

export const MAX_ZONES = 10

export interface PlannerState {
  zones: string[]
  date: string
  /** Working hours, whole hours: start inclusive, end exclusive (end may be 24). */
  work: [number, number]
  /** Selected slots [from, to) on the timeline, if any. */
  sel: [number, number] | null
  /** Meeting length in minutes for a click. */
  len: number
}

export interface DurationsState {
  start: string
  startZone: string
  end: string
  endZone: string
  iso: string
  base: string
  baseZone: string
  op: 'add' | 'sub'
}

export type HashState =
  | { tab: 'zones', planner: Partial<PlannerState> }
  | { tab: 'durations', durations: Partial<DurationsState> }
  | { tab: null }

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240]
export const MEETING_LENGTHS = LENGTHS

const zoneParam = (z: string) => encodeURIComponent(z).replace(/%2F/g, '/')
const dtParam = (s: string) => encodeURIComponent(s).replace(/%3A/g, ':')

export function plannerHash(s: PlannerState): string {
  let out = `#zones=${s.zones.map(zoneParam).join(',')}&date=${s.date}&work=${s.work[0]}-${s.work[1]}&len=${s.len}`
  if (s.sel) out += `&sel=${s.sel[0]}-${s.sel[1]}`
  return out
}

export function durationsHash(s: DurationsState): string {
  return `#d=${dtParam(s.start)}&dz=${zoneParam(s.startZone)}&e=${dtParam(s.end)}&ez=${zoneParam(s.endZone)}`
    + `&p=${encodeURIComponent(s.iso)}&b=${dtParam(s.base)}&bz=${zoneParam(s.baseZone)}&op=${s.op}`
}

function pair(text: string | null, max: number): [number, number] | null {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(text ?? '')
  if (!m) return null
  const a = Number(m[1]), b = Number(m[2])
  return a <= max && b <= max ? [a, b] : null
}

export function readHash(hash: string): HashState {
  const body = hash.replace(/^#/, '')
  if (!body) return { tab: null }
  let params: URLSearchParams
  try {
    params = new URLSearchParams(body)
  } catch {
    return { tab: null }
  }
  const zone = (key: string) => {
    const z = params.get(key)
    return z && isValidZone(z) ? z : undefined
  }
  const dt = (key: string) => {
    const v = params.get(key)
    return v && parseLocalDateTime(v) ? v : undefined
  }
  if (params.has('zones')) {
    const planner: Partial<PlannerState> = {}
    const zones = (params.get('zones') ?? '').split(',').filter((z) => isValidZone(z))
    if (zones.length) planner.zones = [...new Set(zones)].slice(0, MAX_ZONES)
    const date = params.get('date')
    if (date && parseIsoDate(date)) planner.date = date
    const work = pair(params.get('work'), 24)
    if (work && work[0] < 24 && work[1] > 0 && work[0] !== work[1]) planner.work = work
    const sel = pair(params.get('sel'), 100)
    if (sel && sel[0] < sel[1]) planner.sel = sel
    const len = Number(params.get('len'))
    if (LENGTHS.includes(len)) planner.len = len
    return { tab: 'zones', planner }
  }
  if (params.has('d')) {
    const durations: Partial<DurationsState> = {}
    const set = <K extends keyof DurationsState>(key: K, value: DurationsState[K] | undefined) => {
      if (value !== undefined) durations[key] = value
    }
    set('start', dt('d'))
    set('startZone', zone('dz'))
    set('end', dt('e'))
    set('endZone', zone('ez'))
    const iso = params.get('p')
    if (iso !== null && iso.length <= 64) durations.iso = iso
    set('base', dt('b'))
    set('baseZone', zone('bz'))
    const op = params.get('op')
    if (op === 'add' || op === 'sub') durations.op = op
    return { tab: 'durations', durations }
  }
  return { tab: null }
}
