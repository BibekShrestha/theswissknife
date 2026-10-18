import { describe, expect, it } from 'vitest'
import { buildRow, buildTimeline, clampSel, meetingText, meetingTimes, overlap, ranges, SLOT_MS } from './timeline'

const WORK = { start: 9 * 60, end: 17 * 60 }
const iso = (ms: number) => new Date(ms).toISOString()

describe('timeline', () => {
  it('a normal day has 96 slots', () => {
    const tl = buildTimeline({ year: 2026, month: 6, day: 1 }, 'Europe/London')
    expect(tl.slots).toBe(96)
    expect(iso(tl.start)).toBe('2026-05-31T23:00:00.000Z')
  })

  it('Europe/London on the last Sunday of March is 23 hours; October is 25', () => {
    const march = buildTimeline({ year: 2026, month: 3, day: 29 }, 'Europe/London')
    expect(march.slots).toBe(92)
    const london = buildRow(march, 'Europe/London', WORK)
    expect(london.cells.map((c) => c.hour)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
    expect(london.transitions).toEqual([{ slot: 4, beforeMinutes: 0, afterMinutes: 60, from: '01:00', to: '02:00' }])

    const october = buildTimeline({ year: 2026, month: 10, day: 25 }, 'Europe/London')
    expect(october.slots).toBe(100)
    const row = buildRow(october, 'Europe/London', WORK)
    expect(row.cells.map((c) => c.hour).slice(0, 4)).toEqual([0, 1, 1, 2])
  })

  it('aligns other zones on the same instants on a transition day', () => {
    const tl = buildTimeline({ year: 2026, month: 3, day: 29 }, 'Europe/London')
    // London is the reference: slot 0 = 00:00 GMT = 00:00Z.
    const ny = buildRow(tl, 'America/New_York', WORK)
    expect(ny.cells[0]).toMatchObject({ from: 0, hour: 20, dayShift: -1 })
    expect(ny.transitions).toEqual([])
    const ktm = buildRow(tl, 'Asia/Kathmandu', WORK)
    // 00:00Z = 05:45 in Kathmandu: the first cell is the last quarter of hour 5.
    expect(ktm.cells[0]).toMatchObject({ from: 0, to: 1, hour: 5, minute: 45 })
    expect(ktm.cells[1]).toMatchObject({ from: 1, to: 5, hour: 6, minute: 0 })
    const kol = buildRow(tl, 'Asia/Kolkata', WORK)
    expect(kol.cells[0]).toMatchObject({ from: 0, to: 2, hour: 5, minute: 30 })
    // As a non-reference row, London's 01:00 hour is missing at the same slot.
    const nyRef = buildTimeline({ year: 2026, month: 3, day: 28 }, 'America/New_York')
    const london = buildRow(nyRef, 'Europe/London', WORK)
    expect(nyRef.slots).toBe(96)
    const late = london.cells.filter((c) => c.dayShift === 1).map((c) => c.hour)
    expect(late).toEqual([0, 2, 3, 4]) // NY midnight = 05:00 BST
    expect(london.transitions[0].slot * SLOT_MS + nyRef.start).toBe(Date.parse('2026-03-29T01:00:00Z'))
  })

  it('handles Lord Howe\'s 30-minute fall-back', () => {
    const tl = buildTimeline({ year: 2026, month: 4, day: 5 }, 'Australia/Lord_Howe')
    expect(tl.slots).toBe(98) // 24.5 hours
    const row = buildRow(tl, 'Australia/Lord_Howe', WORK)
    expect(row.transitions).toEqual([{ slot: 8, beforeMinutes: 660, afterMinutes: 630, from: '02:00', to: '01:30' }])
    expect(row.cells.slice(0, 4).map((c) => [c.hour, c.minute, c.to - c.from])).toEqual([[0, 0, 4], [1, 0, 4], [1, 30, 2], [2, 0, 4]])
  })

  it('marks the working-hours overlap', () => {
    const tl = buildTimeline({ year: 2026, month: 6, day: 1 }, 'Europe/London')
    const rows = ['Europe/London', 'America/New_York', 'Asia/Kathmandu'].map((z) => buildRow(tl, z, WORK))
    expect(ranges(overlap(rows.slice(0, 2), tl.slots))).toEqual([[56, 68]]) // 14:00–17:00 BST
    // Kathmandu 09:00–17:00 = 04:15–12:15 BST; New York starts 14:00 BST → none.
    expect(ranges(overlap(rows, tl.slots))).toEqual([])
    const lk = ranges(overlap([rows[0], rows[2]], tl.slots))
    expect(lk).toEqual([[36, 49]]) // 09:00–12:15 BST
  })

  it('describes a meeting in every zone', () => {
    const tl = buildTimeline({ year: 2026, month: 3, day: 29 }, 'Europe/London')
    const start = Date.parse('2026-03-29T22:00:00Z')
    const times = meetingTimes(tl, ['Europe/London', 'America/New_York', 'Asia/Kathmandu'], start, start + 3600_000)
    expect(times.map((t) => t.dayShift)).toEqual([0, 0, 1])
    const text = meetingText(times, start, start + 3600_000, 'Sync')
    expect(text).toBe([
      'Sync (1 h) — 2026-03-29 22:00 UTC',
      'Europe/London     Sun 29 Mar 2026 23:00-00:00  UTC+01:00',
      'America/New_York  Sun 29 Mar 2026 18:00-19:00  UTC-04:00',
      'Asia/Kathmandu    Mon 30 Mar 2026 03:45-04:45  UTC+05:45 (+1 day)',
    ].join('\n'))
  })
})

describe('days and offsets the slot grid cannot show (DATES-2, DATES-4)', () => {
  it('a skipped calendar day has no slots and no selection', () => {
    const apia = buildTimeline({ year: 2011, month: 12, day: 30 }, 'Pacific/Apia')
    expect(apia.slots).toBe(0)
    expect(apia.missing).toBe(true)
    expect(clampSel([36, 40], apia.slots)).toBeNull()
    expect(buildTimeline({ year: 2011, month: 12, day: 31 }, 'Pacific/Apia').missing).toBe(false)
    expect(clampSel([36, 40], 96)).toEqual([36, 40])
    expect(clampSel([95, 120], 92)).toEqual([91, 92])
  })

  it('flags rows whose hours do not start on slot boundaries (local mean time)', () => {
    const tl = buildTimeline({ year: 1890, month: 6, day: 1 }, 'Europe/Amsterdam')
    expect(buildRow(tl, 'Europe/Amsterdam', WORK).offGrid).toBe(false)
    expect(buildRow(tl, 'UTC', WORK).offGrid).toBe(true)
    const today = buildTimeline({ year: 2026, month: 3, day: 29 }, 'Europe/London')
    expect(['Europe/London', 'Asia/Kathmandu', 'Asia/Kolkata', 'America/New_York'].map((z) => buildRow(today, z, WORK).offGrid)).toEqual([false, false, false, false])
  })
})
