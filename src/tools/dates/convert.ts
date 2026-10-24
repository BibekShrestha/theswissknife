import { zoneCity } from './catalog'
import { epochDay, formatOffset, hhmm, longDate, MINUTE, DAY, offsetMs, wallAt, type Wall } from './zone'

/**
 * The converter: one instant shown in every listed zone. The first zone is
 * the reference that day shifts and offset differences are measured from.
 */

export interface ZoneReading {
  zone: string
  wall: Wall
  offsetMinutes: number
  /** Calendar days ahead of (+) or behind (−) the reference zone's date. */
  dayShift: number
  /** Offset minus the reference zone's offset, in minutes. */
  diffMinutes: number
  abbreviation: string | null
  period: Period
}

export type Period = 'night' | 'morning' | 'business' | 'evening'

export const PERIOD_LABEL: Record<Period, string> = {
  night: 'night',
  morning: 'morning',
  business: 'business hours',
  evening: 'evening',
}

export function period(hour: number): Period {
  if (hour < 6 || hour >= 22) return 'night'
  if (hour < 9) return 'morning'
  if (hour < 18) return 'business'
  return 'evening'
}

const abbrFormatters = new Map<string, Intl.DateTimeFormat>()

/** Each English locale names a different set of zones (en-US has no BST, en-GB no EDT). */
const ABBR_LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-AU']

/** A letter abbreviation (EDT, BST, IST) where the engine has one, not GMT+5:45. */
export function abbreviation(ms: number, zone: string): string | null {
  for (const locale of ABBR_LOCALES) {
    const key = `${locale}|${zone}`
    let fmt = abbrFormatters.get(key)
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      abbrFormatters.set(key, fmt)
    }
    const name = fmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? ''
    if (/^[A-Z]{2,5}$/.test(name)) return name
  }
  return null
}

export function readings(ms: number, zones: string[]): ZoneReading[] {
  if (!zones.length) return []
  const refWall = wallAt(ms, zones[0])
  const refOffset = offsetMs(ms, zones[0]) / MINUTE
  return zones.map((zone) => {
    const wall = wallAt(ms, zone)
    const offsetMinutes = offsetMs(ms, zone) / MINUTE
    return {
      zone,
      wall,
      offsetMinutes,
      dayShift: epochDay(wall) - epochDay(refWall),
      diffMinutes: offsetMinutes - refOffset,
      abbreviation: abbreviation(ms, zone),
      period: period(wall.hour),
    }
  })
}

/** "+5 h 45 min", "−4 h", "same time" */
export function formatDiff(minutes: number): string {
  const m = Math.round(minutes)
  if (m === 0) return 'same time'
  const abs = Math.abs(m)
  const h = Math.floor(abs / 60), r = abs % 60
  const body = h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`
  return `${m > 0 ? '+' : '−'}${body}`
}

export function dayShiftLabel(shift: number): string {
  if (shift === 0) return ''
  if (shift === 1) return 'next day'
  if (shift === -1) return 'previous day'
  return shift > 0 ? `+${shift} days` : `−${-shift} days`
}

export interface Transition {
  /** First instant on the new offset. */
  at: number
  beforeMinutes: number
  afterMinutes: number
}

/**
 * The first offset change in `zone` after `ms`, within `days` days. Steps a
 * day at a time, then bisects to the minute (offsets change on minute
 * boundaries).
 */
export function nextTransition(ms: number, zone: string, days = 30): Transition | null {
  const start = offsetMs(ms, zone)
  let lo = ms
  for (let i = 1; i <= days; i++) {
    const t = ms + i * DAY
    const off = offsetMs(t, zone)
    if (off === start) { lo = t; continue }
    let hi = t
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2)
      if (offsetMs(mid, zone) === start) lo = mid
      else hi = mid
    }
    const at = Math.floor(lo / MINUTE) * MINUTE + MINUTE
    return { at, beforeMinutes: start / MINUTE, afterMinutes: offsetMs(at, zone) / MINUTE }
  }
  return null
}

/** "Clocks go back 1 h on Sun 1 Nov 2026 at 02:00 (UTC−04:00 → UTC−05:00)" */
export function describeTransition(t: Transition, zone: string): string {
  const diff = t.afterMinutes - t.beforeMinutes
  const amount = formatDiff(Math.abs(diff)).slice(1)
  const before = wallAt(t.at + t.beforeMinutes * MINUTE, 'UTC')
  const date = wallAt(t.at, zone)
  return `Clocks go ${diff > 0 ? 'forward' : 'back'} ${amount} on ${longDate(date)} at ${hhmm(before)} `
    + `(${formatOffset(t.beforeMinutes)} → ${formatOffset(t.afterMinutes)})`
}

/** One line per zone, ASCII offsets, for pasting into chat or email. */
export function readingLine(r: ZoneReading): string {
  const abbr = r.abbreviation ? ` ${r.abbreviation}` : ''
  return `${longDate(r.wall)}, ${hhmm(r.wall)}${abbr} (${formatOffset(r.offsetMinutes, true)}) - ${zoneCity(r.zone)}`
}

export function readingsText(ms: number, list: ZoneReading[]): string {
  const utc = new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
  const width = Math.max(...list.map((r) => r.zone.length))
  const lines = list.map((r) => {
    const abbr = r.abbreviation ? ` ${r.abbreviation}` : ''
    return `${r.zone.padEnd(width)}  ${longDate(r.wall)} ${hhmm(r.wall)}  ${formatOffset(r.offsetMinutes, true)}${abbr}`
  })
  return [`${utc} UTC`, ...lines].join('\n')
}
