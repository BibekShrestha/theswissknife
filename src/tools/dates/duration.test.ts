import { describe, expect, it } from 'vitest'
import {
  addDuration, breakdownToDuration, businessDays, calendarDifference, exactDuration, explainDuration,
  formatDuration, parseDuration, type Duration,
} from './duration'
import { resolveWall, parseLocalDateTime } from './zone'

const at = (local: string, zone: string) => resolveWall(parseLocalDateTime(local)!, zone).ms
const iso = (ms: number) => new Date(ms).toISOString()

function dur(text: string): Duration {
  const r = parseDuration(text)
  if (!r.ok) throw new Error(r.error)
  return r.duration
}

describe('parseDuration', () => {
  it('parses every component', () => {
    expect(dur('P1Y2M3W4DT5H6M7S')).toEqual({ sign: 1, years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7 })
    expect(dur('PT36H').hours).toBe(36)
    expect(dur('P2W').weeks).toBe(2)
    expect(dur('-P1D')).toMatchObject({ sign: -1, days: 1 })
    expect(dur('+PT1M')).toMatchObject({ sign: 1, minutes: 1 })
    expect(dur('pt1h')).toMatchObject({ hours: 1 })
  })

  it('accepts a fraction on the last component, with . or ,', () => {
    expect(dur('PT1.5H').hours).toBe(1.5)
    expect(dur('PT0,25S').seconds).toBe(0.25)
    const r = parseDuration('P1DT0.5H')
    expect(r.ok && r.fraction).toBe('hours')
  })

  it.each([
    ['', /Enter a duration/],
    ['1D', /starts with "P"/],
    ['P', /at least one component/],
    ['PT', /"T" must be followed/],
    ['P1DT', /"T" must be followed/],
    ['P1H', /time unit and goes after "T"/],
    ['PT1D', /date unit/],
    ['P1D1Y', /out of order/],
    ['P1D2D', /appears twice/],
    ['PT1.5H30M', /Only the last component/],
    ['P1', /needs a unit letter/],
    ['P1X', /Unknown unit/],
    ['P1.D', /needs digits/],
    ['PT1HT2M', /Only one "T"/],
    ['P-1D', /Expected a number/],
  ])('rejects %j', (input, message) => {
    const r = parseDuration(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(message)
  })
})

describe('formatDuration and explainDuration', () => {
  it('formats canonically', () => {
    expect(formatDuration(dur('P1Y2M10DT2H30M'))).toBe('P1Y2M10DT2H30M')
    expect(formatDuration(dur('-PT0.5S'))).toBe('-PT0.5S')
    expect(formatDuration(dur('P0D'))).toBe('PT0S')
    expect(formatDuration(exactDuration(-(49 * 3600_000 + 1500)))).toBe('-PT49H1.5S')
  })

  it('explains in English', () => {
    expect(explainDuration(dur('P1Y2M10DT2H30M'))).toBe('1 year, 2 months, 10 days, 2 hours and 30 minutes.')
    expect(explainDuration(dur('-P1W'))).toBe('Minus 1 week (going back in time).')
    expect(explainDuration(dur('PT1.5H'))).toBe('1.5 hours.')
  })
})

describe('addDuration', () => {
  const NY = 'America/New_York'

  it('P1D across spring-forward keeps the wall clock; PT24H does not', () => {
    const base = at('2026-03-07T09:00', NY)
    const day = addDuration(base, NY, dur('P1D'))
    if (!day.ok) throw new Error()
    expect(iso(day.calendar.ms)).toBe('2026-03-08T13:00:00.000Z') // 09:00 EDT
    expect(day.calendar.ms - base).toBe(23 * 3600_000)
    expect(iso(day.exact!.ms)).toBe('2026-03-08T14:00:00.000Z') // 10:00 EDT
    const hours = addDuration(base, NY, dur('PT24H'))
    if (!hours.ok) throw new Error()
    expect(hours.calendar.ms).toBe(hours.exact!.ms)
    expect(hours.calendar.wall.hour).toBe(10)
  })

  it('P1D across fall-back is 25 hours', () => {
    const base = at('2026-10-24T12:00', 'Europe/London')
    const r = addDuration(base, 'Europe/London', dur('P1D'))
    if (!r.ok) throw new Error()
    expect(r.calendar.ms - base).toBe(25 * 3600_000)
    expect(r.calendar.wall.hour).toBe(12)
  })

  it('subtracts', () => {
    const base = at('2026-03-09T09:00', NY)
    const r = addDuration(base, NY, dur('P1D'), -1)
    if (!r.ok) throw new Error()
    expect(r.calendar.wall).toMatchObject({ day: 8, hour: 9 })
    const neg = addDuration(base, NY, dur('-P1D'))
    expect(neg.ok && neg.calendar.ms).toBe(r.calendar.ms)
  })

  it('clamps month ends and says so', () => {
    const r = addDuration(at('2026-01-31T10:00', 'UTC'), 'UTC', dur('P1M'))
    if (!r.ok) throw new Error()
    expect(r.calendar.wall).toMatchObject({ year: 2026, month: 2, day: 28, hour: 10 })
    expect(r.clamped).toEqual({ from: { year: 2026, month: 2, day: 31 }, to: { year: 2026, month: 2, day: 28, clamped: true } })
    expect(r.exact).toBeUndefined()
    const leap = addDuration(at('2028-01-31T10:00', 'UTC'), 'UTC', dur('P1M'))
    expect(leap.ok && leap.calendar.wall.day).toBe(29)
    const plain = addDuration(at('2026-01-15T10:00', 'UTC'), 'UTC', dur('P1M'))
    expect(plain.ok && plain.clamped).toBeUndefined()
  })

  it('reports landing in a DST gap', () => {
    const r = addDuration(at('2026-03-07T02:30', NY), NY, dur('P1D'))
    if (!r.ok) throw new Error()
    expect(r.gapMinutes).toBe(60)
    expect(r.calendar.wall).toMatchObject({ day: 8, hour: 3, minute: 30 })
  })

  it('handles fractions', () => {
    expect(addDuration(0, 'UTC', dur('P1.5Y')).ok).toBe(true) // 18 months
    const bad = addDuration(0, 'UTC', dur('P1.5M'))
    expect(bad.ok).toBe(false)
    const half = addDuration(at('2026-03-07T09:00', NY), NY, dur('P1.5D'))
    if (!half.ok) throw new Error()
    expect(half.fractionalDayMs).toBe(12 * 3600_000)
    expect(half.calendar.wall).toMatchObject({ day: 8, hour: 21 })
  })
})

describe('calendarDifference', () => {
  it('breaks a span into calendar units', () => {
    const a = at('2024-01-15T08:00', 'UTC')
    const b = at('2026-03-20T10:30:15', 'UTC')
    expect(calendarDifference(a, b, 'UTC')).toEqual({ sign: 1, years: 2, months: 2, days: 5, hours: 2, minutes: 30, seconds: 15, milliseconds: 0 })
    expect(formatDuration(breakdownToDuration(calendarDifference(a, b, 'UTC')))).toBe('P2Y2M5DT2H30M15S')
  })

  it('counts a DST day as one day', () => {
    const NY = 'America/New_York'
    const a = at('2026-03-07T09:00', NY)
    const b = at('2026-03-08T09:00', NY)
    expect(calendarDifference(a, b, NY)).toMatchObject({ days: 1, hours: 0 })
    expect(b - a).toBe(23 * 3600_000)
  })

  it('is negative when the end is first, and round-trips with addDuration', () => {
    const a = at('2026-03-31T00:00', 'UTC')
    const b = at('2026-02-28T00:00', 'UTC')
    const d = calendarDifference(a, b, 'UTC')
    expect(d).toMatchObject({ sign: -1, months: 1, days: 0 })
    const back = addDuration(a, 'UTC', breakdownToDuration(d))
    expect(back.ok && back.calendar.ms).toBe(b)
  })

  it('treats Jan 31 → Feb 28 as one clamped month', () => {
    const d = calendarDifference(at('2026-01-31T00:00', 'UTC'), at('2026-03-01T00:00', 'UTC'), 'UTC')
    expect(d).toMatchObject({ months: 1, days: 1 })
  })

  it('handles two different zones by working in the start zone', () => {
    const a = at('2026-06-01T09:00', 'America/New_York')
    const b = at('2026-06-01T15:00', 'Europe/London')
    expect(calendarDifference(a, b, 'America/New_York')).toMatchObject({ days: 0, hours: 1 })
  })
})

describe('businessDays', () => {
  const d = (s: string) => { const [year, month, day] = s.split('-').map(Number); return { year, month, day } }
  it('counts Mon–Fri after the start date, including the end date', () => {
    expect(businessDays(d('2026-10-16'), d('2026-10-19'))).toBe(1) // Fri → Mon
    expect(businessDays(d('2026-10-19'), d('2026-10-19'))).toBe(0)
    expect(businessDays(d('2026-10-19'), d('2026-10-26'))).toBe(5)
    expect(businessDays(d('2026-10-17'), d('2026-10-18'))).toBe(0) // Sat → Sun
    expect(businessDays(d('2026-01-01'), d('2026-12-31'))).toBe(260)
    expect(businessDays(d('2026-10-19'), d('2026-10-16'))).toBe(-1)
  })
})
