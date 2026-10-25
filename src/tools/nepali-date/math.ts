/**
 * Date arithmetic for contract periods and deadlines. Everything counts
 * whole days (day numbers from calendar.ts), so adding days works past the
 * table's last year and only the BS label of the result is then unknown.
 * Months and years are BS months and years and need the table on both ends.
 */

import { bsToDay, dayToBs, monthLength, weekday, FIRST_YEAR, LAST_YEAR, type Ymd } from './calendar'

export interface MonthStep {
  date: Ymd
  /** The day did not exist in the target month and was moved to its last day. */
  clamped: boolean
}

/**
 * A BS date moved by whole months, clamped to the end of a shorter month
 * (32 Jestha + 1 month = 31 Asar when Asar has 31 days), or null when the
 * target month is outside the table.
 */
export function addBsMonths(bs: Ymd, months: number): MonthStep | null {
  const index = bs.year * 12 + (bs.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  if (year < FIRST_YEAR || year > LAST_YEAR) return null
  const length = monthLength(year, month)!
  return { date: { year, month, day: Math.min(bs.day, length) }, clamped: bs.day > length }
}

export interface Span {
  /** b − a in days; negative when b is earlier. */
  days: number
  /** The BS calendar breakdown of |b − a|, counted from the earlier date. */
  years: number
  months: number
  restDays: number
  /** The earlier date's day was clamped on the way (it is past a month's end). */
  clamped: boolean
  /** Saturdays after the earlier date, up to and including the later one. */
  saturdays: number
}

/** Saturdays in the days after `from`, up to and including `to` (from ≤ to). */
export function saturdaysBetween(from: number, to: number): number {
  const days = to - from
  // Days until the first Saturday after `from`: 1–7.
  const first = ((6 - weekday(from) + 7) % 7) || 7
  return days < first ? 0 : Math.floor((days - first) / 7) + 1
}

/** The span between two day numbers, both inside the table. */
export function span(a: number, b: number): Span | null {
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  const from = dayToBs(lo), to = dayToBs(hi)
  if (!from || !to) return null
  // The most whole BS months that fit, then the days left.
  let months = (to.year - from.year) * 12 + (to.month - from.month)
  let step = addBsMonths(from, months)!
  if (bsToDay(step.date)! > hi) step = addBsMonths(from, --months)!
  return {
    days: b - a,
    years: Math.floor(months / 12),
    months: months % 12,
    restDays: hi - bsToDay(step.date)!,
    clamped: step.clamped,
    saturdays: saturdaysBetween(lo, hi),
  }
}
