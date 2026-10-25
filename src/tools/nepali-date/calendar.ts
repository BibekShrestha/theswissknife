/**
 * Bikram Sambat ⇄ Gregorian. The BS calendar has no formula a program can
 * follow: each month runs from one solar transit (sankranti) to the next and
 * the Nepal Panchanga Nirnayak Bikas Samiti fixes its length (29–32 days)
 * when it publishes the year. So conversion is a table of month lengths
 * walked from one anchor: 1 Baisakh 2000 = 14 April 1943.
 *
 * The table covers 2000–2083 BS (14 April 1943 – 13 April 2027). For those
 * years the `bikram-sambat` and `nepali-datetime` Python packages agree
 * month for month; four other converters differ in 2062 (Baisakh 30/Jestha
 * 32) and `ad-bs-converter` in 2081–2083, and Hamro Patro's published months side with
 * this table in every case checked (calendar.test.ts lists them). From 2084
 * on the libraries disagree with each other and no approved calendar was
 * found, so those years are left out rather than guessed: add a row here only
 * once that year's calendar is published.
 */

export interface Ymd {
  year: number
  /** 1–12 */
  month: number
  day: number
}

export const FIRST_YEAR = 2000
export const LAST_YEAR = 2083

/** Days in each month, Baisakh first, one row per year from FIRST_YEAR. */
const MONTH_DAYS: readonly (readonly number[])[] = [
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2000
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2001
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2002
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2003
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2004
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2005
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2006
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2007
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2008
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2009
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2010
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2011
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2012
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2013
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2014
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2015
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2016
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2017
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2018
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2019
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2020
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2021
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2022
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2023
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2024
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2025
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2026
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2027
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2028
  [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2029
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2030
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2031
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2032
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2033
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2034
  [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2035
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2036
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2037
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2038
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2039
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2040
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2041
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2042
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2043
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2044
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2045
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2046
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2047
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2048
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2049
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2050
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2051
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2052
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2053
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2054
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2055
  [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2056
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2057
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2058
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2059
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2060
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2061
  [31, 31, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31], // 2062
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2063
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2064
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2065
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2066
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2067
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2068
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2069
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2070
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2071
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2072
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2073
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2074
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2075
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2076
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2077
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2078
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2079
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2080
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2081
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2082
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2083
]

export const MONTHS = [
  { en: 'Baisakh', ne: 'वैशाख' },
  { en: 'Jestha', ne: 'जेठ' },
  { en: 'Asar', ne: 'असार' },
  { en: 'Shrawan', ne: 'साउन' },
  { en: 'Bhadra', ne: 'भदौ' },
  { en: 'Asoj', ne: 'असोज' },
  { en: 'Kartik', ne: 'कार्तिक' },
  { en: 'Mangsir', ne: 'मंसिर' },
  { en: 'Poush', ne: 'पुस' },
  { en: 'Magh', ne: 'माघ' },
  { en: 'Falgun', ne: 'फागुन' },
  { en: 'Chaitra', ne: 'चैत' },
] as const

/** Sunday first, as Nepali calendars print the week. */
export const WEEKDAYS = [
  { en: 'Sunday', short: 'Sun', ne: 'आइतवार', neShort: 'आइत' },
  { en: 'Monday', short: 'Mon', ne: 'सोमवार', neShort: 'सोम' },
  { en: 'Tuesday', short: 'Tue', ne: 'मङ्गलवार', neShort: 'मङ्गल' },
  { en: 'Wednesday', short: 'Wed', ne: 'बुधवार', neShort: 'बुध' },
  { en: 'Thursday', short: 'Thu', ne: 'बिहीवार', neShort: 'बिही' },
  { en: 'Friday', short: 'Fri', ne: 'शुक्रवार', neShort: 'शुक्र' },
  { en: 'Saturday', short: 'Sat', ne: 'शनिवार', neShort: 'शनि' },
] as const

export const AD_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const DAY_MS = 86_400_000

/** Days since 1970-01-01 of a Gregorian date. */
export function adToDay({ year, month, day }: Ymd): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  return Math.round(d.getTime() / DAY_MS)
}

export function dayToAd(n: number): Ymd {
  const d = new Date(n * DAY_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export const weekday = (n: number) => (((n + 4) % 7) + 7) % 7

const ANCHOR = adToDay({ year: 1943, month: 4, day: 14 })

/** Day number of 1 Baisakh of each covered year, plus one past the end. */
const YEAR_START: number[] = [ANCHOR]
for (const row of MONTH_DAYS) YEAR_START.push(YEAR_START[YEAR_START.length - 1] + row.reduce((a, b) => a + b, 0))

/** The first and last day the table covers. */
export const FIRST_DAY = ANCHOR
export const LAST_DAY = YEAR_START[YEAR_START.length - 1] - 1

export const inRange = (n: number) => n >= FIRST_DAY && n <= LAST_DAY

export function monthLength(year: number, month: number): number | undefined {
  return MONTH_DAYS[year - FIRST_YEAR]?.[month - 1]
}

export function yearLength(year: number): number | undefined {
  const i = year - FIRST_YEAR
  return i >= 0 && i < MONTH_DAYS.length ? YEAR_START[i + 1] - YEAR_START[i] : undefined
}

/** Why a BS date is not one the table holds, or null when it is. */
export function checkBs({ year, month, day }: Ymd): string | null {
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) return `Only ${FIRST_YEAR}–${LAST_YEAR} BS is covered: later years have no approved calendar yet.`
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'The month must be 1–12 (Baisakh to Chaitra).'
  const length = monthLength(year, month)!
  if (!Number.isInteger(day) || day < 1 || day > length) return `${MONTHS[month - 1].en} ${year} has ${length} days.`
  return null
}

/** Day number of a BS date, or null if it is not a date the table holds. */
export function bsToDay(bs: Ymd): number | null {
  if (checkBs(bs)) return null
  const row = MONTH_DAYS[bs.year - FIRST_YEAR]
  let n = YEAR_START[bs.year - FIRST_YEAR]
  for (let m = 0; m < bs.month - 1; m++) n += row[m]
  return n + bs.day - 1
}

/** The BS date of a day number, or null outside the covered years. */
export function dayToBs(n: number): Ymd | null {
  if (!inRange(n)) return null
  let i = 0
  while (YEAR_START[i + 1] <= n) i++
  let rest = n - YEAR_START[i]
  const row = MONTH_DAYS[i]
  let m = 0
  while (rest >= row[m]) rest -= row[m++]
  return { year: FIRST_YEAR + i, month: m + 1, day: rest + 1 }
}

/** Nepal's fiscal year runs from 1 Shrawan to the last day of Asar. */
export interface FiscalYear {
  /** BS year it starts in. */
  start: number
  label: string
  /** 1-based day of the fiscal year, unknown when it began before the table. */
  dayOf?: number
  /** Days in the fiscal year, unknown when it ends past the table. */
  length?: number
}

export function fiscalYear(bs: Ymd): FiscalYear | null {
  const n = bsToDay(bs)
  if (n === null) return null
  const start = bs.month >= 4 ? bs.year : bs.year - 1
  const label = `${start}/${String(start + 1).slice(-2)}`
  const first = bsToDay({ year: start, month: 4, day: 1 })
  const next = bsToDay({ year: start + 1, month: 4, day: 1 })
  // 2000 BS starts before the table's first Shrawan: its fiscal year began in 1999.
  if (first === null) return { start, label }
  return { start, label, dayOf: n - first + 1, ...(next !== null ? { length: next - first } : {}) }
}

const NEPALI_DIGITS = '०१२३४५६७८९'

export const toNepaliDigits = (text: string | number) => String(text).replace(/[0-9]/g, (d) => NEPALI_DIGITS[Number(d)])

/** Devanagari digits to ASCII, everything else unchanged. */
export const asciiDigits = (text: string) => text.replace(/[०-९]/g, (d) => String(NEPALI_DIGITS.indexOf(d)))

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export const isoDate = ({ year, month, day }: Ymd) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`

/** "8 Kartik 2082" */
export const longBs = (bs: Ymd) => `${bs.day} ${MONTHS[bs.month - 1].en} ${bs.year}`

/** "२०८२ कार्तिक ८ गते" */
export const nepaliBs = (bs: Ymd) => `${toNepaliDigits(bs.year)} ${MONTHS[bs.month - 1].ne} ${toNepaliDigits(bs.day)} गते`

/** "25 October 2025" */
export const longAd = (ad: Ymd) => `${ad.day} ${AD_MONTHS[ad.month - 1]} ${ad.year}`

/** Today on this device's calendar. */
export function today(now = new Date()): number {
  return adToDay({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
}
