import { describe, expect, it } from 'vitest'
import { emptyReason, instantsFor, nextRuns } from './next'
import { parseCron, type CronExpression } from './parse'

function cron(expr: string): CronExpression {
  const result = parseCron(expr)
  if (!result.ok) throw new Error(result.error.message)
  return result.cron
}

const iso = (ms: number) => new Date(ms).toISOString()
const at = (s: string) => Date.parse(s)

function runs(expr: string, zone: string, from: string, count = 10) {
  return nextRuns(cron(expr), zone, at(from), count)
}

describe('nextRuns basics', () => {
  it('returns 10 runs by default, strictly after the start', () => {
    const result = runs('*/15 9-17 * * 1-5', 'UTC', '2026-10-17T00:00:00Z') // a Saturday
    expect(result.runs).toHaveLength(10)
    expect(iso(result.runs[0].at)).toBe('2026-10-19T09:00:00.000Z')
    expect(iso(result.runs[9].at)).toBe('2026-10-19T11:15:00.000Z')
    expect(iso(runs('0 9 * * *', 'UTC', '2026-10-19T09:00:00Z', 1).runs[0].at)).toBe('2026-10-20T09:00:00.000Z')
  })

  it('crosses the end of a year', () => {
    const result = runs('0 0 1 * *', 'UTC', '2026-12-15T00:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2027-01-01T00:00:00.000Z', '2027-02-01T00:00:00.000Z'])
  })

  it('works in zones with non-hour offsets', () => {
    const result = runs('0 9 * * *', 'Asia/Kolkata', '2026-10-17T00:00:00Z', 1)
    expect(iso(result.runs[0].at)).toBe('2026-10-17T03:30:00.000Z')
    expect(result.runs[0].offsetMinutes).toBe(330)
  })

  it('throws for an unknown zone', () => {
    expect(() => runs('* * * * *', 'Mars/Olympus', '2026-01-01T00:00:00Z')).toThrow(RangeError)
  })
})

describe('day-of-month / day-of-week', () => {
  it('ORs the two when both are restricted (Vixie)', () => {
    // Fridays, plus the 13th of each month — not only Friday the 13th.
    const result = runs('0 0 13 * 5', 'UTC', '2026-01-01T00:00:00Z', 5)
    expect(result.runs.map((r) => iso(r.at).slice(0, 10))).toEqual(['2026-01-02', '2026-01-09', '2026-01-13', '2026-01-16', '2026-01-23'])
  })

  it('ANDs them when one field starts with *', () => {
    // */2 counts as a star: odd-numbered days that are also Mondays.
    const result = runs('0 0 */2 * 1', 'UTC', '2026-01-01T00:00:00Z', 3)
    expect(result.runs.map((r) => iso(r.at).slice(0, 10))).toEqual(['2026-01-05', '2026-01-19', '2026-02-09'])
  })
})

describe('impossible and rare schedules', () => {
  it('reports never for February 30', () => {
    const started = performance.now()
    const result = runs('0 0 30 2 *', 'UTC', '2026-01-01T00:00:00Z')
    expect(result.never).toBe(true)
    expect(result.runs).toEqual([])
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('reports never for the 31st of 30-day months', () => {
    expect(runs('0 0 31 4,6,9,11 *', 'Europe/London', '2026-01-01T00:00:00Z').never).toBe(true)
  })

  it('finds 29 February in the next leap year', () => {
    const result = runs('0 0 29 2 *', 'UTC', '2026-01-01T00:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2028-02-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z'])
  })

  it('still runs on 30 February when day-of-week ORs it in', () => {
    const result = runs('0 0 30 2 1', 'UTC', '2026-02-01T00:00:00Z', 1)
    expect(iso(result.runs[0].at)).toBe('2026-02-02T00:00:00.000Z')
  })
})

describe('DST in America/New_York', () => {
  // 2026-03-08: 02:00 EST jumps to 03:00 EDT. 2026-11-01: 02:00 EDT falls back to 01:00 EST.
  it('finds no instant for a wall time in the spring-forward gap', () => {
    expect(instantsFor({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York')).toEqual([])
  })

  it('skips a daily job whose time falls in the gap', () => {
    const result = runs('30 2 * * *', 'America/New_York', '2026-03-07T12:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z'])
    expect(result.skipped.map((s) => s.wall)).toEqual([{ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }])
  })

  it('jumps an hourly job straight from 01:00 EST to 03:00 EDT', () => {
    const result = runs('0 * * * *', 'America/New_York', '2026-03-08T05:30:00Z', 3)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T08:00:00.000Z'])
    expect(result.runs.map((r) => r.wall.hour)).toEqual([1, 3, 4])
    expect(result.runs.map((r) => r.offsetMinutes)).toEqual([-300, -240, -240])
    expect(result.skipped).toHaveLength(1)
  })

  it('finds two instants for a wall time in the repeated hour', () => {
    expect(instantsFor({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York').map(iso))
      .toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'])
  })

  it('runs once in the repeated hour, at the first occurrence', () => {
    const result = runs('30 1 * * *', 'America/New_York', '2026-10-31T12:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'])
    expect(result.runs[0].repeated).toBe(true)
    expect(result.runs[0].offsetMinutes).toBe(-240)
    expect(result.runs[1].repeated).toBe(false)
  })

  it('does not rerun the repeated hour for a frequent job', () => {
    const result = runs('*/30 1 * * *', 'America/New_York', '2026-11-01T04:59:00Z', 3)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-11-01T05:00:00.000Z', '2026-11-01T05:30:00.000Z', '2026-11-02T06:00:00.000Z'])
  })

  it('does not run a time already passed in the first pass when starting in the second', () => {
    // 06:10Z is 01:10 EST, the second 01:xx; 01:45 already ran at 05:45Z (EDT).
    const result = runs('45 1 * * *', 'America/New_York', '2026-11-01T06:10:00Z', 1)
    expect(iso(result.runs[0].at)).toBe('2026-11-02T06:45:00.000Z')
  })
})

describe('DST in Europe/London', () => {
  // 2026-03-29: 01:00 GMT jumps to 02:00 BST. 2026-10-25: 02:00 BST falls back to 01:00 GMT.
  it('skips 01:30 on the spring-forward day', () => {
    const result = runs('30 1 * * *', 'Europe/London', '2026-03-28T12:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-03-30T00:30:00.000Z', '2026-03-31T00:30:00.000Z'])
    expect(result.skipped).toHaveLength(1)
  })

  it('runs 01:30 once on the fall-back day', () => {
    const result = runs('30 1 * * *', 'Europe/London', '2026-10-24T12:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z'])
    expect(result.runs[0].repeated).toBe(true)
  })

  it('keeps a job outside the transition at its wall time', () => {
    const result = runs('0 9 * * *', 'Europe/London', '2026-03-28T12:00:00Z', 2)
    expect(result.runs.map((r) => iso(r.at))).toEqual(['2026-03-29T08:00:00.000Z', '2026-03-30T08:00:00.000Z'])
  })
})

describe('why nothing runs (CRON-2)', () => {
  it('tells a date that never exists from times that only fall in DST gaps', () => {
    const noDate = runs('0 0 30 2 *', 'America/New_York', '2026-01-01T00:00:00Z')
    expect(emptyReason(noDate)).toBe('no-date')
    expect(noDate.skipped).toHaveLength(0)

    // 02:30 on the second Sunday of March: the New York spring-forward gap every year.
    const gapsOnly = runs('30 2 8-14 3 */7', 'America/New_York', '2026-01-01T00:00:00Z')
    expect(gapsOnly.runs).toHaveLength(0)
    expect(gapsOnly.skipped.length).toBeGreaterThan(100)
    expect(new Set(gapsOnly.skipped.map((s) => s.wall.year)).size).toBe(gapsOnly.skipped.length)
    expect(emptyReason(gapsOnly)).toBe('dst-gaps')

    expect(emptyReason(runs('0 9 * * *', 'UTC', '2026-01-01T00:00:00Z'))).toBeNull()
  })
})
