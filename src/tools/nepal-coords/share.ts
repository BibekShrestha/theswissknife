/**
 * The URL fragment holds the single point only, short and readable like the
 * land tool's: `#i=grid&z=84&e=630391.974&n=3066418.735&s=epsg6208` or
 * `#i=geo&z=auto&lat=27.7172&lon=85.324&s=epsg6208`. Batch input never goes
 * in it. Everything read back is checked; anything odd falls back to the
 * defaults.
 */

import { asciiDigits } from './angle'
import { ZONES, type ShiftId, type Zone } from './mutm'
import type { InputKind } from './batch'

export interface State {
  input: InputKind
  /** 'auto' only applies to lat/lon input. */
  zone: Zone | 'auto'
  e: string
  n: string
  lat: string
  lon: string
  shift: ShiftId
}

/** Kathmandu (Ratna Park, roughly), on GPS. */
export const DEFAULTS: State = { input: 'geo', zone: 'auto', e: '', n: '', lat: '27.7056', lon: '85.3147', shift: 'epsg6208' }

const METRES = /^[0-9.+\-−]{0,20}$/
const ANGLE = /^[0-9.+\-−°º'′’"″” :dmsNSEWnsew]{0,40}$/
const SHIFT_IDS: ShiftId[] = ['epsg6208', 'none']

export function readFragment(hash: string): State {
  if (!hash.startsWith('#i=')) return DEFAULTS
  let params: URLSearchParams
  try { params = new URLSearchParams(hash.slice(1)) } catch { return DEFAULTS }
  const input = params.get('i')
  if (input !== 'grid' && input !== 'geo') return DEFAULTS
  const zoneText = params.get('z') ?? 'auto'
  const zone = zoneText === 'auto' ? 'auto' : (ZONES as readonly number[]).includes(Number(zoneText)) ? (Number(zoneText) as Zone) : null
  if (zone === null || (input === 'grid' && zone === 'auto')) return DEFAULTS
  const shift = (params.get('s') ?? 'epsg6208') as ShiftId
  if (!SHIFT_IDS.includes(shift)) return DEFAULTS
  const get = (key: string, pattern: RegExp) => {
    const v = asciiDigits(params.get(key) ?? '')
    return pattern.test(v) ? v : null
  }
  if (input === 'grid') {
    const e = get('e', METRES), n = get('n', METRES)
    if (e === null || n === null) return DEFAULTS
    return { ...DEFAULTS, input, zone, e, n, lat: '', lon: '', shift }
  }
  const lat = get('lat', ANGLE), lon = get('lon', ANGLE)
  if (lat === null || lon === null) return DEFAULTS
  return { ...DEFAULTS, input, zone, lat, lon, shift }
}

export function writeFragment(state: State): string {
  const params = new URLSearchParams({ i: state.input, z: String(state.input === 'grid' && state.zone === 'auto' ? 84 : state.zone) })
  if (state.input === 'grid') {
    params.set('e', asciiDigits(state.e).trim())
    params.set('n', asciiDigits(state.n).trim())
  } else {
    params.set('lat', asciiDigits(state.lat).trim())
    params.set('lon', asciiDigits(state.lon).trim())
  }
  params.set('s', state.shift)
  return `#${params.toString()}`
}
