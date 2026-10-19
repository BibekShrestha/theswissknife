import {
  addDays, addMonths, DAY, epochDay, fromEpochDay, HOUR, MINUTE, resolveWall, wallAt, weekday,
  type PlainDate, type Wall,
} from './zone'

/**
 * ISO 8601 durations (PnYnMnWnDTnHnMnS) and date math on the wall clock of
 * an IANA zone.
 *
 * Years, months, weeks and days are calendar units: adding P1D keeps the wall
 * clock time, so across a DST change it can be 23 or 25 real hours. Hours,
 * minutes and seconds are exact. This is the order Temporal uses for
 * ZonedDateTime: years and months first (clamping the day to the month's
 * length), then weeks and days, then the exact time part.
 */

export const UNITS = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds'] as const
export type Unit = typeof UNITS[number]

export interface Duration {
  sign: 1 | -1
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export const ZERO: Duration = { sign: 1, years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }

export type ParseResult =
  | { ok: true, duration: Duration, fraction?: Unit }
  | { ok: false, error: string, position?: number }

const DATE_UNITS: Record<string, Unit> = { Y: 'years', M: 'months', W: 'weeks', D: 'days' }
const TIME_UNITS: Record<string, Unit> = { H: 'hours', M: 'minutes', S: 'seconds' }

export function parseDuration(input: string): ParseResult {
  const s = input.trim()
  if (!s) return { ok: false, error: 'Enter a duration such as P1D, PT90M or P1Y2M10DT2H30M.' }
  let i = 0
  let sign: 1 | -1 = 1
  if (s[0] === '-' || s[0] === '−' || s[0] === '+') {
    sign = s[0] === '+' ? 1 : -1
    i++
  }
  if (s[i]?.toUpperCase() !== 'P') {
    return { ok: false, error: `A duration starts with "P" (for period), e.g. P1D — found "${s[i] ?? ''}".`, position: i }
  }
  i++
  if (i >= s.length) return { ok: false, error: '"P" must be followed by at least one component, e.g. P1D or PT1H.', position: i }

  const duration: Duration = { ...ZERO, sign }
  let inTime = false
  let lastIndex = -1
  let fraction: Unit | undefined
  let count = 0

  while (i < s.length) {
    const ch = s[i].toUpperCase()
    if (ch === 'T') {
      if (inTime) return { ok: false, error: 'Only one "T" is allowed — it separates the date part from the time part.', position: i }
      inTime = true
      i++
      if (i >= s.length || !/[0-9]/.test(s[i])) {
        return { ok: false, error: '"T" must be followed by hours, minutes or seconds, e.g. PT30M.', position: i }
      }
      continue
    }
    const start = i
    while (i < s.length && /[0-9]/.test(s[i])) i++
    if (i === start) {
      return { ok: false, error: `Expected a number at position ${i + 1}, found "${s[i]}".`, position: i }
    }
    let text = s.slice(start, i)
    if (s[i] === '.' || s[i] === ',') {
      i++
      const fracStart = i
      while (i < s.length && /[0-9]/.test(s[i])) i++
      if (i === fracStart) return { ok: false, error: `A decimal point needs digits after it (position ${i + 1}).`, position: i }
      text += '.' + s.slice(fracStart, i)
    }
    if (fraction) {
      return { ok: false, error: 'Only the last component may have a fraction — e.g. PT1.5H is fine, PT1.5H30M is not.', position: start }
    }
    if (i >= s.length) {
      return { ok: false, error: `The number ${text} needs a unit letter after it (${inTime ? 'H, M or S' : 'Y, M, W or D'}).`, position: i }
    }
    const letter = s[i].toUpperCase()
    const unit = (inTime ? TIME_UNITS : DATE_UNITS)[letter]
    if (!unit) {
      if (!inTime && (letter === 'H' || letter === 'S')) {
        return { ok: false, error: `"${letter}" is a time unit and goes after "T" — e.g. PT${text}${letter}.`, position: i }
      }
      if (inTime && (letter === 'Y' || letter === 'W' || letter === 'D')) {
        return { ok: false, error: `"${letter}" is a date unit and must come before "T".`, position: i }
      }
      return { ok: false, error: `Unknown unit "${s[i]}" — use Y, M, W, D before "T" and H, M, S after it.`, position: i }
    }
    const index = UNITS.indexOf(unit)
    if (index === lastIndex) return { ok: false, error: `"${letter}" appears twice.`, position: i }
    if (index < lastIndex) {
      return { ok: false, error: 'Components are out of order — the order is Y, M, W, D, then T, H, M, S.', position: i }
    }
    const value = Number(text)
    if (!Number.isFinite(value) || value > 1e12) return { ok: false, error: `${text} is too large.`, position: start }
    duration[unit] = value
    if (text.includes('.')) fraction = unit
    lastIndex = index
    count++
    i++
  }
  if (count === 0) return { ok: false, error: '"P" must be followed by at least one component, e.g. P1D or PT1H.' }
  return { ok: true, duration, fraction }
}

/** Up to nine decimals, never in exponent form (String(1e-9) is "1e-9", which no ISO parser reads). */
const num = (n: number) => (Math.round(n * 1e9) / 1e9).toFixed(9).replace(/\.?0+$/, '')

export function isZero(d: Duration): boolean {
  return UNITS.every((u) => d[u] === 0)
}

export function formatDuration(d: Duration): string {
  if (isZero(d)) return 'PT0S'
  let out = d.sign < 0 ? '-P' : 'P'
  if (d.years) out += `${num(d.years)}Y`
  if (d.months) out += `${num(d.months)}M`
  if (d.weeks) out += `${num(d.weeks)}W`
  if (d.days) out += `${num(d.days)}D`
  if (d.hours || d.minutes || d.seconds) {
    out += 'T'
    if (d.hours) out += `${num(d.hours)}H`
    if (d.minutes) out += `${num(d.minutes)}M`
    if (d.seconds) out += `${num(d.seconds)}S`
  }
  return out
}

/**
 * The same span with weeks and days written as exact 24-hour days, for the
 * "if you mean exact hours" hint: P1DT2H is PT26H. Years and months have no
 * fixed length, so they are not converted (the hint is not shown for them).
 */
export function exactHoursDuration(d: Duration): string {
  return formatDuration({ ...ZERO, sign: d.sign, years: d.years, months: d.months, hours: (d.weeks * 7 + d.days) * 24 + d.hours, minutes: d.minutes, seconds: d.seconds })
}

const SINGULAR: Record<Unit, string> = {
  years: 'year', months: 'month', weeks: 'week', days: 'day', hours: 'hour', minutes: 'minute', seconds: 'second',
}

export function joinEnglish(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function explainDuration(d: Duration): string {
  if (isZero(d)) return 'Zero — no time at all.'
  const parts = UNITS.filter((u) => d[u]).map((u) => `${num(d[u])} ${d[u] === 1 ? SINGULAR[u] : u}`)
  const text = joinEnglish(parts)
  return d.sign < 0 ? `Minus ${text} (going back in time).` : `${text[0].toUpperCase()}${text.slice(1)}.`
}

export interface AddOutcome {
  ms: number
  wall: Wall
}

export interface AddResult {
  ok: true
  /** Calendar semantics: Y/M/W/D move the wall clock, H/M/S are exact. */
  calendar: AddOutcome
  /** Every unit as an exact length (D = 24 h, W = 168 h). Absent when years or months are present. */
  exact?: AddOutcome
  /** The day of month was clamped, e.g. Jan 31 + P1M → Feb 28. */
  clamped?: { from: PlainDate, to: PlainDate }
  /** The intermediate wall time fell in a DST gap and was moved forward. */
  gapMinutes?: number
  /** The intermediate wall time occurs twice; the earlier one was used. */
  fold?: boolean
  /** Fractional days or weeks: the fraction was added as exact hours. */
  fractionalDayMs?: number
}

export type AddResponse = AddResult | { ok: false, error: string }

const MAX_MS = 8.64e15

/** Adds (sign +1) or subtracts (sign −1) a duration from an instant, on the wall clock of `zone`. */
export function addDuration(baseMs: number, zone: string, d: Duration, direction: 1 | -1 = 1): AddResponse {
  const s = d.sign * direction
  const totalMonths = d.years * 12 + d.months
  if (!Number.isInteger(Math.round(totalMonths * 1e9) / 1e9)) {
    return { ok: false, error: 'Fractional years or months can\'t be added — a month has no fixed length. Use smaller units, e.g. P1M15D instead of P1.5M.' }
  }
  const totalDays = d.weeks * 7 + d.days
  const wholeDays = Math.trunc(Math.round(totalDays * 1e9) / 1e9)
  const fractionalDayMs = Math.round((totalDays - wholeDays) * DAY)
  const timeMs = Math.round(((d.hours * 60 + d.minutes) * 60 + d.seconds) * 1000)

  const wall = wallAt(baseMs, zone)
  const moved = addMonths(wall, s * Math.round(totalMonths))
  const date = addDays(moved, s * wholeDays)
  const resolved = resolveWall({ ...wall, ...date }, zone)
  const calendarMs = resolved.ms + s * (fractionalDayMs + timeMs)
  if (!Number.isFinite(calendarMs) || Math.abs(calendarMs) > MAX_MS) {
    return { ok: false, error: 'The result is outside the range JavaScript dates can hold (about ±275,000 years).' }
  }
  const result: AddResult = { ok: true, calendar: { ms: calendarMs, wall: wallAt(calendarMs, zone) } }
  if (moved.clamped) result.clamped = { from: { year: moved.year, month: moved.month, day: wall.day }, to: moved }
  if (resolved.kind === 'gap') result.gapMinutes = resolved.gapMinutes
  if (resolved.kind === 'fold') result.fold = true
  if (fractionalDayMs) result.fractionalDayMs = fractionalDayMs
  if (totalMonths === 0) {
    const exactMs = baseMs + s * (Math.round(totalDays * DAY) + timeMs)
    result.exact = { ms: exactMs, wall: wallAt(exactMs, zone) }
  }
  return result
}

export interface Breakdown {
  sign: 1 | -1
  years: number
  months: number
  days: number
  hours: number
  minutes: number
  seconds: number
  milliseconds: number
}

/** Add whole months, then whole days, to an instant's wall clock in a zone. */
function calendarAdd(baseMs: number, zone: string, months: number, days: number): number {
  const wall = wallAt(baseMs, zone)
  const date = addDays(addMonths(wall, months), days)
  return resolveWall({ ...wall, ...date }, zone).ms
}

/**
 * Calendar difference from `a` to `b` on the wall clock of `zone`: the most
 * whole months that fit, then the most whole days, then the exact remainder.
 * Adding the result to `a` with addDuration gives back `b` (month-end
 * clamping included: Jan 31 → Feb 28 is one month).
 */
export function calendarDifference(a: number, b: number, zone: string): Breakdown {
  const dir: 1 | -1 = b >= a ? 1 : -1
  const passes = (t: number) => (dir > 0 ? t > b : t < b)
  const sw = wallAt(a, zone)
  const ew = wallAt(b, zone)
  let months = (ew.year - sw.year) * 12 + (ew.month - sw.month)
  if (Math.sign(months) === -dir) months = 0
  while (months !== 0 && passes(calendarAdd(a, zone, months, 0))) months -= dir
  const mid = wallAt(calendarAdd(a, zone, months, 0), zone)
  let days = epochDay(ew) - epochDay(mid)
  if (Math.sign(days) === -dir) days = 0
  while (days !== 0 && passes(calendarAdd(a, zone, months, days))) days -= dir
  let rest = Math.abs(b - calendarAdd(a, zone, months, days))
  const hours = Math.floor(rest / HOUR); rest -= hours * HOUR
  const minutes = Math.floor(rest / MINUTE); rest -= minutes * MINUTE
  const seconds = Math.floor(rest / 1000); rest -= seconds * 1000
  const m = Math.abs(months)
  return { sign: dir, years: Math.floor(m / 12), months: m % 12, days: Math.abs(days), hours, minutes, seconds, milliseconds: rest }
}

export function breakdownToDuration(b: Breakdown): Duration {
  return {
    sign: b.sign, years: b.years, months: b.months, weeks: 0, days: b.days,
    hours: b.hours, minutes: b.minutes, seconds: b.seconds + b.milliseconds / 1000,
  }
}

/** An exact span as an ISO duration in hours, minutes and seconds only (PT49H30M). */
export function exactDuration(ms: number): Duration {
  let rest = Math.abs(ms)
  const hours = Math.floor(rest / HOUR); rest -= hours * HOUR
  const minutes = Math.floor(rest / MINUTE); rest -= minutes * MINUTE
  return { ...ZERO, sign: ms < 0 ? -1 : 1, hours, minutes, seconds: rest / 1000 }
}

/**
 * Business days between two dates: Monday to Friday, counting the days after
 * `from` up to and including `to` (the start date is excluded). Negative when
 * `to` is before `from`. No public holidays.
 */
export function businessDays(from: PlainDate, to: PlainDate): number {
  const a = epochDay(from)
  const b = epochDay(to)
  if (b < a) return -businessDays(to, from)
  const span = b - a
  const weeks = Math.floor(span / 7)
  let count = weeks * 5
  for (let day = a + weeks * 7 + 1; day <= b; day++) {
    const wd = weekday(fromEpochDay(day))
    if (wd !== 0 && wd !== 6) count++
  }
  return count
}
