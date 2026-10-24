import { describe, expect, it } from 'vitest'
import { abbreviation, dayShiftLabel, describeTransition, formatDiff, nextTransition, period, readingLine, readings, readingsText } from './convert'

const at = (iso: string) => Date.parse(iso)

describe('readings', () => {
  it('shows one instant in every zone, measured from the first', () => {
    const [ny, ktm, auckland] = readings(at('2026-10-20T23:30Z'), ['America/New_York', 'Asia/Kathmandu', 'Pacific/Auckland'])
    expect(ny).toMatchObject({ wall: { day: 20, hour: 19, minute: 30 }, offsetMinutes: -240, dayShift: 0, diffMinutes: 0, period: 'evening' })
    expect(ktm).toMatchObject({ wall: { day: 21, hour: 5, minute: 15 }, offsetMinutes: 345, dayShift: 1, diffMinutes: 585, period: 'night' })
    expect(auckland).toMatchObject({ wall: { day: 21, hour: 12, minute: 30 }, offsetMinutes: 780, dayShift: 1, period: 'business' })
  })

  it('counts a day behind the reference', () => {
    const [tokyo, la] = readings(at('2026-01-01T02:00Z'), ['Asia/Tokyo', 'America/Los_Angeles'])
    expect(tokyo.dayShift).toBe(0)
    expect(la.dayShift).toBe(-1)
    expect(dayShiftLabel(la.dayShift)).toBe('previous day')
    expect(dayShiftLabel(2)).toBe('+2 days')
  })

  it('formats differences and periods', () => {
    expect(formatDiff(585)).toBe('+9 h 45 min')
    expect(formatDiff(-240)).toBe('−4 h')
    expect(formatDiff(30)).toBe('+30 min')
    expect(formatDiff(0)).toBe('same time')
    expect([0, 6, 9, 17, 18, 22].map(period)).toEqual(['night', 'morning', 'business', 'business', 'evening', 'night'])
  })

  it('writes copyable text with ASCII offsets', () => {
    const ms = at('2026-07-01T12:00Z')
    const list = readings(ms, ['UTC', 'Asia/Kolkata'])
    expect(readingLine(list[1])).toMatch(/^Wed 1 Jul 2026, 17:30( IST)? \(UTC\+05:30\) - Kolkata$/)
    const text = readingsText(ms, list).split('\n')
    expect(text[0]).toBe('2026-07-01 12:00 UTC')
    expect(text[1]).toMatch(/^UTC +Wed 1 Jul 2026 12:00 {2}UTC\+00:00/)
    expect(text[2]).toMatch(/^Asia\/Kolkata {2}Wed 1 Jul 2026 17:30 {2}UTC\+05:30/)
  })
})

describe('nextTransition', () => {
  it('finds a fall-back to the minute', () => {
    const t = nextTransition(at('2026-10-20T12:00Z'), 'America/New_York')
    expect(t).toEqual({ at: at('2026-11-01T06:00Z'), beforeMinutes: -240, afterMinutes: -300 })
    expect(describeTransition(t!, 'America/New_York')).toBe('Clocks go back 1 h on Sun 1 Nov 2026 at 02:00 (UTC−04:00 → UTC−05:00)')
  })

  it('finds a spring-forward and a half-hour change', () => {
    const london = nextTransition(at('2026-03-20T00:00Z'), 'Europe/London')
    expect(london).toEqual({ at: at('2026-03-29T01:00Z'), beforeMinutes: 0, afterMinutes: 60 })
    expect(describeTransition(london!, 'Europe/London')).toBe('Clocks go forward 1 h on Sun 29 Mar 2026 at 01:00 (UTC+00:00 → UTC+01:00)')
    const lordHowe = nextTransition(at('2026-09-20T00:00Z'), 'Australia/Lord_Howe')
    expect(lordHowe && lordHowe.afterMinutes - lordHowe.beforeMinutes).toBe(30)
  })

  it('is null where nothing changes within the window', () => {
    expect(nextTransition(at('2026-10-20T00:00Z'), 'Asia/Kolkata')).toBeNull()
    expect(nextTransition(at('2026-10-20T00:00Z'), 'UTC')).toBeNull()
    expect(nextTransition(at('2026-10-20T00:00Z'), 'America/New_York', 5)).toBeNull()
  })
})

describe('abbreviation', () => {
  it('finds names across English locales and skips GMT+n', () => {
    expect(abbreviation(Date.parse('2026-07-01T12:00Z'), 'America/New_York')).toBe('EDT')
    expect(abbreviation(Date.parse('2026-07-01T12:00Z'), 'Europe/London')).toBe('BST')
    expect(abbreviation(Date.parse('2026-07-01T12:00Z'), 'Asia/Kathmandu')).toBeNull()
  })
})
