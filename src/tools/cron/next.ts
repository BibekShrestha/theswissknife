import { dayMatches, type CronExpression } from './parse'

/**
 * Next-run computation on the wall clock of an IANA time zone, using only
 * Intl.DateTimeFormat. Policy for daylight-saving transitions:
 *
 * - A wall time inside a spring-forward gap does not exist that day, so it
 *   does not run. It is reported in `skipped` so the UI can say so.
 * - A wall time inside a repeated fall-back hour runs once, at its first
 *   occurrence (the earlier instant, still on the pre-transition offset).
 *
 * Vixie cron and cronie differ slightly: they run fixed-time jobs from a
 * skipped interval straight after the clock jumps. This module follows the
 * strict wall clock instead, and the UI copy says so.
 */

export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export interface Run {
  /** Epoch milliseconds of the run. */
  at: number
  wall: WallTime
  /** Weekday 0–6 (Sunday = 0) of the wall date. */
  weekday: number
  /** UTC offset in minutes at the run (e.g. -240 for EDT). */
  offsetMinutes: number
  /** The wall time occurs twice (fall-back); this is the first. */
  repeated: boolean
}

export interface Skipped {
  wall: WallTime
  weekday: number
}

export interface NextRunsResult {
  runs: Run[]
  /** Wall times that matched but fell in a DST gap, before the last run found. */
  skipped: Skipped[]
  /** True when nothing runs within the search horizon (a full 400-year Gregorian cycle). */
  never: boolean
}

/** 400 years is one full Gregorian cycle: if no day matches in it, none ever will. */
export const SEARCH_YEARS = 400

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(zone, fmt)
  }
  return fmt
}

/** Throws RangeError for an unknown zone. */
export function assertZone(zone: string): void {
  formatter(zone)
}

interface Parts extends WallTime { second: number }

export function wallParts(ms: number, zone: string): Parts {
  const out: Record<string, number> = {}
  for (const part of formatter(zone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal' && part.type !== 'era') out[part.type] = Number(part.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}

function utcOf(w: WallTime, second = 0): number {
  const d = new Date(0)
  d.setUTCFullYear(w.year, w.month - 1, w.day)
  d.setUTCHours(w.hour, w.minute, second, 0)
  return d.getTime()
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
export function offsetAt(ms: number, zone: string): number {
  const whole = Math.floor(ms / 1000) * 1000
  const p = wallParts(whole, zone)
  return utcOf(p, p.second) - whole
}

const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * Every instant whose wall-clock reading in `zone` is exactly `wall`
 * (0 in a gap, 2 in an overlap), ascending.
 */
export function instantsFor(wall: WallTime, zone: string): number[] {
  const naive = utcOf(wall)
  const offsets = new Set([offsetAt(naive - 36 * HOUR, zone), offsetAt(naive, zone), offsetAt(naive + 36 * HOUR, zone)])
  const found: number[] = []
  for (const offset of offsets) {
    const t = naive - offset
    const p = wallParts(t, zone)
    if (p.year === wall.year && p.month === wall.month && p.day === wall.day && p.hour === wall.hour && p.minute === wall.minute && p.second === 0) {
      if (!found.includes(t)) found.push(t)
    }
  }
  return found.sort((a, b) => a - b)
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(utcOf({ year, month, day, hour: 0, minute: 0 })).getUTCDay()
}

function daysIn(year: number, month: number): number {
  return new Date(utcOf({ year, month: month + 1, day: 0, hour: 0, minute: 0 })).getUTCDate()
}

/**
 * The next `count` runs strictly after `from` (epoch ms) in `zone`.
 */
export function nextRuns(cron: CronExpression, zone: string, from: number, count = 10): NextRunsResult {
  const runs: Run[] = []
  const skipped: Skipped[] = []
  if (count <= 0) return { runs, skipped, never: false }

  const start = wallParts(from, zone)
  const startMinute = start.hour * 60 + start.minute
  const hours = cron.hour.values
  const minutes = cron.minute.values
  const lastYear = start.year + SEARCH_YEARS

  let { year, month } = start
  let day = start.day
  let first = true

  while (year <= lastYear) {
    if (!cron.month.has[month]) {
      month++
      day = 1
      first = false
      if (month > 12) { month = 1; year++ }
      continue
    }
    const length = daysIn(year, month)
    for (; day <= length; day++) {
      const weekday = weekdayOf(year, month, day)
      if (!dayMatches(cron, day, month, weekday)) { first = false; continue }

      // One check per day tells whether this date has a transition at all.
      const midnight = utcOf({ year, month, day, hour: 0, minute: 0 })
      const before = offsetAt(midnight - 12 * HOUR, zone)
      const steady = before === offsetAt(midnight + 12 * HOUR, zone) && before === offsetAt(midnight + DAY + 12 * HOUR, zone)

      for (const hour of hours) {
        for (const minute of minutes) {
          // On the starting date, skip times well before `from` (with an hour
          // of margin so a repeated fall-back hour is still compared exactly).
          if (first && hour * 60 + minute < startMinute - 120) continue
          const wall = { year, month, day, hour, minute }
          let at: number
          let repeated = false
          if (steady) {
            at = utcOf(wall) - before
          } else {
            const instants = instantsFor(wall, zone)
            if (instants.length === 0) {
              if (utcOf(wall) - before > from) skipped.push({ wall, weekday })
              continue
            }
            at = instants[0]
            repeated = instants.length > 1
          }
          if (at <= from) continue
          runs.push({ at, wall, weekday, offsetMinutes: Math.round(offsetAt(at, zone) / 60000), repeated })
          if (runs.length >= count) return { runs, skipped, never: false }
        }
      }
      first = false
    }
    day = 1
    month++
    if (month > 12) { month = 1; year++ }
  }
  return { runs, skipped, never: runs.length === 0 }
}

/**
 * Why a schedule has no runs: no date in the 400-year cycle matches at all
 * (30 February), or every match is a wall time a DST gap skips.
 */
export function emptyReason(result: NextRunsResult): 'no-date' | 'dst-gaps' | null {
  if (!result.never) return null
  return result.skipped.length > 0 ? 'dst-gaps' : 'no-date'
}
