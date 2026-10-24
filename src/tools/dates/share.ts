import { canonicalZone, zoneList } from './catalog'
import { parseIsoDate, parseLocalDateTime, resolveWall, wallMs } from './zone'

/**
 * Fragment state. The converter uses `#zones=…[&at=YYYY-MM-DDTHH:MMZ]` (no
 * `at` means "now"), the durations tab `#d=…&dz=…&e=…&ez=…&p=…&b=…&bz=…&op=…`.
 * Only zone names, dates, times and a duration travel.
 *
 * Links from the old meeting planner (`#zones=…&date=…`) still open: their
 * zones, and 09:00 on that date in the first zone.
 */

export const MAX_ZONES = 12

export interface ConverterState {
  zones: string[]
  /** Epoch ms, whole minutes; null follows the clock. */
  at: number | null
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
  | { tab: 'convert', converter: Partial<ConverterState> }
  | { tab: 'durations', durations: Partial<DurationsState> }
  | { tab: null }

const zoneParam = (z: string) => encodeURIComponent(z).replace(/%2F/g, '/')
const dtParam = (s: string) => encodeURIComponent(s).replace(/%3A/g, ':')

/** "2026-10-20T09:00Z" */
export function atParam(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16) + 'Z'
}

export function converterHash(s: ConverterState): string {
  let out = `#zones=${s.zones.map(zoneParam).join(',')}`
  if (s.at !== null) out += `&at=${atParam(s.at)}`
  return out
}

export function durationsHash(s: DurationsState): string {
  return `#d=${dtParam(s.start)}&dz=${zoneParam(s.startZone)}&e=${dtParam(s.end)}&ez=${zoneParam(s.endZone)}`
    + `&p=${encodeURIComponent(s.iso)}&b=${dtParam(s.base)}&bz=${zoneParam(s.baseZone)}&op=${s.op}`
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
  // Links may carry any case or an alias; one spelling per zone, or the same
  // zone shows up as two rows.
  const all = zoneList()
  const canonical = (z: string | null) => (z ? canonicalZone(z, all) ?? undefined : undefined)
  const zone = (key: string) => canonical(params.get(key))
  const dt = (key: string) => {
    const v = params.get(key)
    return v && parseLocalDateTime(v) ? v : undefined
  }
  if (params.has('zones') || params.has('at')) {
    const converter: Partial<ConverterState> = {}
    const zones = (params.get('zones') ?? '').split(',').map(canonical).filter((z): z is string => z !== undefined)
    if (zones.length) converter.zones = [...new Set(zones)].slice(0, MAX_ZONES)
    const at = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})Z$/.exec(params.get('at') ?? '')
    const atWall = at ? parseLocalDateTime(at[1]) : null
    if (atWall) converter.at = wallMs(atWall)
    else {
      const date = parseIsoDate(params.get('date') ?? '')
      if (date) converter.at = resolveWall({ ...date, hour: 9, minute: 0, second: 0, ms: 0 }, converter.zones?.[0] ?? 'UTC').ms
    }
    return { tab: 'convert', converter }
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
