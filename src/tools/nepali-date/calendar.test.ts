import { describe, expect, it } from 'vitest'
import {
  adToDay, bsToDay, checkBs, dayToAd, dayToBs, FIRST_DAY, FIRST_YEAR, fiscalYear, isoDate, LAST_DAY, LAST_YEAR, monthLength, nepaliBs,
  toNepaliDigits, asciiDigits, weekday, yearLength,
} from './calendar'

const ad = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return adToDay({ year, month, day })
}

describe('table', () => {
  it('has 29–32 day months and 365–366 day years', () => {
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      for (let m = 1; m <= 12; m++) expect([29, 30, 31, 32]).toContain(monthLength(y, m))
      expect([365, 366]).toContain(yearLength(y))
    }
  })

  it('starts at 1 Baisakh 2000 = 14 April 1943 and ends at 30 Chaitra 2083 = 13 April 2027', () => {
    expect(isoDate(dayToAd(FIRST_DAY))).toBe('1943-04-14')
    expect(dayToBs(FIRST_DAY)).toEqual({ year: 2000, month: 1, day: 1 })
    expect(isoDate(dayToAd(LAST_DAY))).toBe('2027-04-13')
    expect(dayToBs(LAST_DAY)).toEqual({ year: 2083, month: 12, day: 30 })
    expect(dayToBs(FIRST_DAY - 1)).toBeNull()
    expect(dayToBs(LAST_DAY + 1)).toBeNull()
  })

  // Month starts read off Hamro Patro's published month pages (hamropatro.com/calendar/<year>/<month>),
  // and the fiscal-year starts reported in the news. 2062 and 2081–2083 are where other converters differ.
  const PUBLISHED: [string, string, number?][] = [
    ['2007-10-01', '1951-01-14', 29],
    ['2035-06-01', '1978-09-17', 31],
    ['2050-12-01', '1994-03-14', 31],
    ['2062-02-01', '2005-05-15', 31],
    ['2070-09-01', '2013-12-16', 30],
    ['2081-01-01', '2024-04-13'],
    ['2081-03-01', '2024-06-15', 31],
    ['2082-01-01', '2025-04-14'],
    ['2082-04-01', '2025-07-17'],
    ['2083-03-01', '2026-06-15', 32],
    ['2083-07-01', '2026-10-18', 30],
    ['2083-12-01', '2027-03-15', 30],
  ]
  it.each(PUBLISHED)('BS %s is AD %s', (bs, adIso, length) => {
    const [year, month, day] = bs.split('-').map(Number)
    expect(bsToDay({ year, month, day })).toBe(ad(adIso))
    expect(dayToBs(ad(adIso))).toEqual({ year, month, day })
    if (length) expect(monthLength(year, month)).toBe(length)
  })

  it('round-trips every covered day', () => {
    let previous: string | null = null
    for (let n = FIRST_DAY; n <= LAST_DAY; n++) {
      const bs = dayToBs(n)!
      expect(bsToDay(bs)).toBe(n)
      const iso = isoDate(bs)
      if (previous) expect(iso > previous).toBe(true)
      previous = iso
    }
  })

  it('knows the weekday', () => {
    expect(weekday(ad('2024-04-13'))).toBe(6) // New Year 2081 was a Saturday
    expect(weekday(ad('1970-01-01'))).toBe(4)
    expect(weekday(ad('1943-04-14'))).toBe(3)
  })
})

describe('checkBs', () => {
  it('names the problem', () => {
    expect(checkBs({ year: 2084, month: 1, day: 1 })).toMatch(/2000–2083/)
    expect(checkBs({ year: 1999, month: 12, day: 30 })).toMatch(/2000–2083/)
    expect(checkBs({ year: 2082, month: 13, day: 1 })).toMatch(/1–12/)
    expect(checkBs({ year: 2083, month: 3, day: 33 })).toBe('Asar 2083 has 32 days.')
    expect(checkBs({ year: 2083, month: 3, day: 32 })).toBeNull()
  })
})

describe('fiscalYear', () => {
  it('runs from 1 Shrawan to the end of Asar', () => {
    expect(fiscalYear({ year: 2082, month: 4, day: 1 })).toEqual({ start: 2082, label: '2082/83', dayOf: 1, length: 365 })
    expect(fiscalYear({ year: 2083, month: 3, day: 32 })).toMatchObject({ start: 2082, label: '2082/83', dayOf: 365 })
    // Shrawan, Bhadra and Asoj 2083 have 31 days each; 2084 is not in the table, so no length.
    expect(fiscalYear({ year: 2083, month: 7, day: 8 })).toEqual({ start: 2083, label: '2083/84', dayOf: 31 + 31 + 31 + 8 })
    expect(fiscalYear({ year: 2000, month: 1, day: 1 })).toEqual({ start: 1999, label: '1999/00' })
  })
})

describe('digits and formats', () => {
  it('converts digits both ways', () => {
    expect(toNepaliDigits('2082-07-08')).toBe('२०८२-०७-०८')
    expect(asciiDigits('२०८२-०७-०८')).toBe('2082-07-08')
  })
  it('writes Nepali', () => {
    expect(nepaliBs({ year: 2082, month: 7, day: 8 })).toBe('२०८२ कार्तिक ८ गते')
  })
})
