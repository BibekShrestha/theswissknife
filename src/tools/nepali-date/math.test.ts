import { describe, expect, it } from 'vitest'
import { adToDay, bsToDay, weekday } from './calendar'
import { addBsMonths, saturdaysBetween, span } from './math'

const bs = (year: number, month: number, day: number) => bsToDay({ year, month, day })!

describe('addBsMonths', () => {
  it('moves whole months either way', () => {
    expect(addBsMonths({ year: 2082, month: 7, day: 8 }, 12)).toEqual({ date: { year: 2083, month: 7, day: 8 }, clamped: false })
    expect(addBsMonths({ year: 2082, month: 7, day: 8 }, -7)).toEqual({ date: { year: 2081, month: 12, day: 8 }, clamped: false })
  })

  it('clamps to the end of a shorter month', () => {
    // Asar 2083 has 32 days, Shrawan 2083 has 31.
    expect(addBsMonths({ year: 2083, month: 3, day: 32 }, 1)).toEqual({ date: { year: 2083, month: 4, day: 31 }, clamped: true })
  })

  it('refuses months outside the table', () => {
    expect(addBsMonths({ year: 2082, month: 7, day: 8 }, 18)).toBeNull()
    expect(addBsMonths({ year: 2000, month: 3, day: 1 }, -3)).toBeNull()
  })
})

describe('span', () => {
  it('counts a fiscal year', () => {
    // FY 2082/83: 1 Shrawan 2082 to 32 Asar 2083, 365 days counting both ends.
    expect(span(bs(2082, 4, 1), bs(2083, 3, 32))).toEqual({ days: 364, years: 0, months: 11, restDays: 31, clamped: false, saturdays: 52 })
  })

  it('keeps the sign of the day count and breaks down the gap', () => {
    const forward = span(bs(2081, 1, 1), bs(2083, 7, 8))!
    const backward = span(bs(2083, 7, 8), bs(2081, 1, 1))!
    expect(forward).toMatchObject({ years: 2, months: 6, restDays: 7 })
    expect(backward.days).toBe(-forward.days)
    expect(backward).toMatchObject({ years: 2, months: 6, restDays: 7 })
  })

  it('handles a span inside one month', () => {
    expect(span(bs(2082, 7, 8), bs(2082, 7, 20))).toMatchObject({ days: 12, years: 0, months: 0, restDays: 12 })
    expect(span(bs(2082, 7, 8), bs(2082, 7, 8))).toMatchObject({ days: 0, years: 0, months: 0, restDays: 0, saturdays: 0 })
  })

  it('says when the start day was clamped', () => {
    // 32 Jestha 2081 + 1 month = 31 Asar 2081 (Asar has 31 days).
    expect(span(bs(2081, 2, 32), bs(2081, 3, 31))).toMatchObject({ months: 1, restDays: 0, clamped: true })
    expect(span(bs(2081, 2, 32), bs(2081, 3, 30))).toMatchObject({ months: 0, restDays: 30, clamped: false })
  })

  it('needs both ends in the table', () => {
    expect(span(bs(2083, 12, 30), bs(2083, 12, 30) + 1)).toBeNull()
  })
})

describe('saturdaysBetween', () => {
  const saturday = adToDay({ year: 2024, month: 4, day: 13 })
  it('counts the days after the start, the end included', () => {
    expect(weekday(saturday)).toBe(6)
    expect(saturdaysBetween(saturday, saturday)).toBe(0)
    expect(saturdaysBetween(saturday, saturday + 6)).toBe(0)
    expect(saturdaysBetween(saturday, saturday + 7)).toBe(1)
    expect(saturdaysBetween(saturday - 1, saturday)).toBe(1)
  })

  it('matches counting day by day', () => {
    for (let from = saturday - 10; from < saturday + 10; from++) {
      for (let length = 0; length < 40; length++) {
        let count = 0
        for (let d = from + 1; d <= from + length; d++) if (weekday(d) === 6) count++
        expect(saturdaysBetween(from, from + length)).toBe(count)
      }
    }
  })
})
