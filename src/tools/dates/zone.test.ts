import { describe, expect, it } from 'vitest'
import { ABBREVIATIONS, searchZones, zoneList } from './catalog'
import {
  addMonths, formatOffset, offsetMinutes, parseLocalDateTime, resolveWall, wallAt, weekday, type Wall,
} from './zone'

const at = (s: string) => Date.parse(s)
const wall = (s: string): Wall => {
  const w = parseLocalDateTime(s)
  if (!w) throw new Error(`bad wall ${s}`)
  return w
}
const iso = (ms: number) => new Date(ms).toISOString()

describe('offsetMinutes', () => {
  it('America/New_York switches EST→EDT and back', () => {
    expect(offsetMinutes(at('2026-03-08T06:59:59Z'), 'America/New_York')).toBe(-300)
    expect(offsetMinutes(at('2026-03-08T07:00:00Z'), 'America/New_York')).toBe(-240)
    expect(offsetMinutes(at('2026-11-01T05:59:59Z'), 'America/New_York')).toBe(-240)
    expect(offsetMinutes(at('2026-11-01T06:00:00Z'), 'America/New_York')).toBe(-300)
  })

  it('Europe/London switches at 01:00 UTC on the last Sundays of March and October', () => {
    expect(offsetMinutes(at('2026-03-29T00:59:00Z'), 'Europe/London')).toBe(0)
    expect(offsetMinutes(at('2026-03-29T01:00:00Z'), 'Europe/London')).toBe(60)
    expect(offsetMinutes(at('2026-10-25T00:59:00Z'), 'Europe/London')).toBe(60)
    expect(offsetMinutes(at('2026-10-25T01:00:00Z'), 'Europe/London')).toBe(0)
  })

  it('Australia/Lord_Howe has a 30-minute DST shift', () => {
    // DST ends first Sunday of April 2026 (02:00 LHDT → 01:30 LHST), starts first Sunday of October.
    expect(offsetMinutes(at('2026-04-04T14:59:00Z'), 'Australia/Lord_Howe')).toBe(660)
    expect(offsetMinutes(at('2026-04-04T15:00:00Z'), 'Australia/Lord_Howe')).toBe(630)
    expect(offsetMinutes(at('2026-10-03T15:29:00Z'), 'Australia/Lord_Howe')).toBe(630)
    expect(offsetMinutes(at('2026-10-03T15:30:00Z'), 'Australia/Lord_Howe')).toBe(660)
  })

  it('Asia/Kathmandu is +05:45 and moved from +05:30 in 1986', () => {
    expect(offsetMinutes(at('2026-06-01T00:00:00Z'), 'Asia/Kathmandu')).toBe(345)
    expect(offsetMinutes(at('1985-12-31T18:29:00Z'), 'Asia/Kathmandu')).toBe(330)
    expect(offsetMinutes(at('1985-12-31T18:30:00Z'), 'Asia/Kathmandu')).toBe(345)
    expect(offsetMinutes(at('2026-06-01T00:00:00Z'), 'Asia/Kolkata')).toBe(330)
  })

  it('formats offsets with sign and minutes', () => {
    expect(formatOffset(345)).toBe('UTC+05:45')
    expect(formatOffset(-240)).toBe('UTC−04:00')
    expect(formatOffset(-570, true)).toBe('UTC-09:30')
  })
})

describe('resolveWall', () => {
  it('resolves an ordinary wall time', () => {
    const r = resolveWall(wall('2026-07-01T09:00'), 'America/New_York')
    expect(r.kind).toBe('ok')
    expect(iso(r.ms)).toBe('2026-07-01T13:00:00.000Z')
  })

  it('moves a spring-forward gap time forward by the gap', () => {
    const r = resolveWall(wall('2026-03-08T02:30'), 'America/New_York')
    expect(r.kind).toBe('gap')
    expect(r.gapMinutes).toBe(60)
    expect(iso(r.ms)).toBe('2026-03-08T07:30:00.000Z') // 03:30 EDT
    expect(iso(resolveWall(wall('2026-10-04T02:15'), 'Australia/Lord_Howe').ms)).toBe('2026-10-03T15:45:00.000Z') // 02:45 LHDT
  })

  it('picks the earlier of a repeated fall-back time unless asked for the later', () => {
    const w = wall('2026-11-01T01:30')
    const early = resolveWall(w, 'America/New_York')
    expect(early.kind).toBe('fold')
    expect(iso(early.ms)).toBe('2026-11-01T05:30:00.000Z')
    expect(iso(resolveWall(w, 'America/New_York', 'later').ms)).toBe('2026-11-01T06:30:00.000Z')
    // Lord Howe repeats 01:30–02:00 only.
    const lh = resolveWall(wall('2026-04-05T01:45'), 'Australia/Lord_Howe', 'later')
    expect(lh.kind).toBe('fold')
    expect(iso(lh.ms)).toBe('2026-04-04T15:15:00.000Z')
  })

  it('round-trips wallAt', () => {
    const t = at('2026-10-17T12:34:56.789Z')
    for (const zone of ['UTC', 'Asia/Kathmandu', 'Australia/Lord_Howe', 'America/St_Johns', 'Pacific/Chatham']) {
      expect(resolveWall(wallAt(t, zone), zone).ms).toBe(t)
    }
  })
})

describe('calendar helpers', () => {
  it('clamps month ends', () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 28, clamped: true })
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({ year: 2028, month: 2, day: 29, clamped: true })
    expect(addMonths({ year: 2026, month: 3, day: 15 }, -14)).toEqual({ year: 2025, month: 1, day: 15, clamped: false })
  })

  it('knows weekdays', () => {
    expect(weekday({ year: 2026, month: 10, day: 17 })).toBe(6) // Saturday
    expect(weekday({ year: 1970, month: 1, day: 1 })).toBe(4)
  })
})

describe('zone search', () => {
  const all = zoneList(['America/New_York', 'Asia/Calcutta', 'Asia/Katmandu', 'Europe/London', 'Europe/Dublin', 'Asia/Jerusalem', 'America/Los_Angeles', 'Europe/Berlin', 'Europe/Paris'])

  it('lists renamed zones under their current name', () => {
    expect(all).toContain('Asia/Kolkata')
    expect(all).toContain('Asia/Kathmandu')
    expect(all).not.toContain('Asia/Calcutta')
    expect(all).toContain('UTC')
  })

  it('matches cities, aliases and old names', () => {
    expect(searchZones('london', all).zones[0]).toBe('Europe/London')
    expect(searchZones('San Francisco', all).zones[0]).toBe('America/Los_Angeles')
    expect(searchZones('calcutta', all).zones[0]).toBe('Asia/Kolkata')
    expect(searchZones('new york', all).zones[0]).toBe('America/New_York')
  })

  it('resolves unambiguous abbreviations and flags ambiguous ones', () => {
    const pst = searchZones('pst', all)
    expect(pst.zones[0]).toBe('America/Los_Angeles')
    expect(pst.abbreviation?.ambiguous).toBe(false)
    const cet = searchZones('CET', all)
    expect(cet.abbreviation?.ambiguous).toBe(false)
    expect(cet.zones).toContain('Europe/Berlin')
    const ist = searchZones('IST', all)
    expect(ist.abbreviation?.ambiguous).toBe(true)
    expect(ist.zones).toEqual(expect.arrayContaining(['Asia/Kolkata', 'Europe/Dublin', 'Asia/Jerusalem']))
  })

  it('every abbreviation zone is a real zone', () => {
    for (const entry of Object.values(ABBREVIATIONS)) {
      for (const m of entry.meanings) for (const zone of m.zones) expect(() => wallAt(0, zone)).not.toThrow()
    }
  })
})
