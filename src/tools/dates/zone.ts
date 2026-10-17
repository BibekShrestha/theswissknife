/**
 * Wall-clock arithmetic in IANA time zones using only Intl.DateTimeFormat.
 *
 * Instants are epoch milliseconds. A "wall" is what a clock on the wall of
 * that zone shows. Offsets are measured in milliseconds internally so that
 * historical local-mean-time offsets with seconds stay exact.
 */

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export interface PlainDate {
  year: number
  month: number
  day: number
}

export interface Wall extends PlainDate {
  hour: number
  minute: number
  second: number
  /** 0–999 */
  ms: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      era: 'short',
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

export function isValidZone(zone: string): boolean {
  if (!zone) return false
  try {
    formatter(zone)
    return true
  } catch {
    return false
  }
}

/** Epoch ms of a proleptic-Gregorian UTC wall time; safe for years 0–99. */
export function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, ms)
  return date.getTime()
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Wall time of an instant in a zone. Throws RangeError for an unknown zone. */
export function wallAt(ms: number, zone: string): Wall {
  const parts = formatter(zone).formatToParts(new Date(ms))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  let year = Number(get('year'))
  if (/^b/i.test(get('era'))) year = 1 - year
  const hour = Number(get('hour')) % 24
  return {
    year,
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    ms: mod(ms, 1000),
  }
}

export function wallMs(wall: Wall): number {
  return utcMs(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second, wall.ms)
}

/** UTC offset of a zone at an instant, in milliseconds (east positive). */
export function offsetMs(ms: number, zone: string): number {
  const whole = ms - mod(ms, 1000)
  const wall = wallAt(whole, zone)
  return utcMs(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second) - whole
}

export function offsetMinutes(ms: number, zone: string): number {
  return offsetMs(ms, zone) / MINUTE
}

export type Disambiguation = 'compatible' | 'earlier' | 'later'

export interface Resolved {
  ms: number
  /** 'gap': the wall time does not exist (spring forward) and was moved forward. 'fold': it exists twice. */
  kind: 'ok' | 'gap' | 'fold'
  /** For a gap: how far the clock jumps, in minutes. */
  gapMinutes?: number
}

/**
 * The instant at which a zone's clock shows `wall`. Like Temporal's
 * 'compatible' disambiguation by default: a repeated (fall-back) time is its
 * earlier occurrence, and a skipped (spring-forward) time is moved forward by
 * the length of the gap — 02:30 on a 02:00→03:00 day becomes 03:30.
 */
export function resolveWall(wall: Wall, zone: string, disambiguation: Disambiguation = 'compatible'): Resolved {
  const local = wallMs(wall)
  const before = offsetMs(local - DAY, zone)
  const after = offsetMs(local + DAY, zone)
  const candidates = new Set([before, offsetMs(local, zone), after])
  const matches: number[] = []
  for (const offset of candidates) {
    const t = local - offset
    if (t + offsetMs(t, zone) === local) matches.push(t)
  }
  matches.sort((a, b) => a - b)
  if (matches.length === 1) return { ms: matches[0], kind: 'ok' }
  if (matches.length > 1) {
    return { ms: disambiguation === 'later' ? matches[matches.length - 1] : matches[0], kind: 'fold' }
  }
  const gapMinutes = (after - before) / MINUTE
  return { ms: disambiguation === 'earlier' ? local - after : local - before, kind: 'gap', gapMinutes }
}

export function epochDay(date: PlainDate): number {
  return Math.floor(utcMs(date.year, date.month, date.day) / DAY)
}

export function fromEpochDay(n: number): PlainDate {
  const d = new Date(n * DAY)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDay(epochDay(date) + days)
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: PlainDate): number {
  return mod(epochDay(date) + 4, 7)
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** Adds whole months, clamping the day to the target month's length. */
export function addMonths(date: PlainDate, months: number): PlainDate & { clamped: boolean } {
  const index = date.year * 12 + (date.month - 1) + months
  const year = Math.floor(index / 12)
  const month = mod(index, 12) + 1
  const dim = daysInMonth(year, month)
  return { year, month, day: Math.min(date.day, dim), clamped: date.day > dim }
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0')

export function formatOffset(minutes: number, ascii = false): string {
  const rounded = Math.round(minutes)
  const sign = rounded < 0 ? (ascii ? '-' : '−') : '+'
  const abs = Math.abs(rounded)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export function isoDate(date: PlainDate): string {
  const y = date.year < 0 || date.year > 9999 ? `${date.year < 0 ? '-' : '+'}${pad(date.year, 6)}` : pad(date.year, 4)
  return `${y}-${pad(date.month)}-${pad(date.day)}`
}

export function hhmm(wall: { hour: number, minute: number }): string {
  return `${pad(wall.hour)}:${pad(wall.minute)}`
}

export function hhmmss(wall: { hour: number, minute: number, second: number }): string {
  return `${hhmm(wall)}:${pad(wall.second)}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sun 29 Mar 2026" */
export function longDate(date: PlainDate): string {
  return `${DAYS[weekday(date)]} ${date.day} ${MONTHS[date.month - 1]} ${date.year}`
}

export function parseIsoDate(text: string): PlainDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return null
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null
  return date
}

/** Parses the value of an <input type="datetime-local">: YYYY-MM-DDTHH:MM[:SS[.sss]]. */
export function parseLocalDateTime(text: string): Wall | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text.trim())
  if (!m) return null
  const date = parseIsoDate(m[1])
  if (!date) return null
  const hour = Number(m[2]), minute = Number(m[3]), second = Number(m[4] ?? 0)
  if (hour > 23 || minute > 59 || second > 59) return null
  return { ...date, hour, minute, second, ms: Number((m[5] ?? '0').padEnd(3, '0')) }
}

export function formatLocalDateTime(wall: Wall): string {
  const base = `${isoDate(wall)}T${hhmm(wall)}`
  if (wall.ms) return `${base}:${pad(wall.second)}.${pad(wall.ms, 3)}`
  return wall.second ? `${base}:${pad(wall.second)}` : base
}
