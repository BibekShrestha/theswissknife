/**
 * Reads a typed BS date. Accepted: year-first numbers (`2082-07-08`,
 * `2082/7/8`, `2082.07.08`, `2082 7 8`) and a month name with a year and a
 * day in any order (`8 Kartik 2082`, `Kartik 8, 2082`, `२०८२ कार्तिक ८ गते`),
 * with Devanagari digits anywhere. Day-first numbers (`8/7/2082`) are refused:
 * day/month and month/day cannot be told apart.
 */

import { asciiDigits, checkBs, type Ymd } from './calendar'

/** Spellings people use for each month, lower-case, Baisakh first. */
const ALIASES: string[][] = [
  ['baisakh', 'baishakh', 'baishak', 'baisak', 'vaishakh', 'vaisakh', 'vaishakha', 'वैशाख', 'बैशाख', 'बैसाख'],
  ['jestha', 'jeth', 'jeshtha', 'jyestha', 'jyeshtha', 'jesth', 'जेठ', 'ज्येष्ठ', 'जेष्ठ'],
  ['asar', 'ashar', 'asadh', 'ashadh', 'ashad', 'asad', 'aasar', 'असार', 'आषाढ', 'असाढ'],
  ['shrawan', 'shravan', 'srawan', 'sawan', 'saun', 'shrawn', 'साउन', 'श्रावण', 'सावन'],
  ['bhadra', 'bhadau', 'bhadrapad', 'bhado', 'भदौ', 'भाद्र'],
  ['asoj', 'ashoj', 'ashwin', 'aswin', 'ashwini', 'asouj', 'असोज', 'आश्विन'],
  ['kartik', 'kartika', 'kattik', 'कार्तिक', 'कात्तिक'],
  ['mangsir', 'mangshir', 'marga', 'margashirsha', 'mangseer', 'मंसिर', 'मङ्सिर', 'मार्ग'],
  ['poush', 'push', 'paush', 'pous', 'पुस', 'पौष', 'पूस'],
  ['magh', 'माघ'],
  ['falgun', 'phalgun', 'fagun', 'phagun', 'falgoon', 'फागुन', 'फाल्गुन'],
  ['chaitra', 'chait', 'chaitr', 'चैत', 'चैत्र'],
]

const MONTH_BY_NAME = new Map<string, number>()
ALIASES.forEach((names, i) => names.forEach((name) => MONTH_BY_NAME.set(name, i + 1)))

/** Words that may accompany a date and carry nothing. */
const NOISE = new Set(['bs', 'b.s', 'b.s.', 'vs', 'v.s', 'v.s.', 'गते', 'साल', 'वि.सं', 'वि.सं.', 'बि.सं', 'बि.सं.', 'सम्वत्', 'संवत्'])

export type Parsed = { ok: true; date: Ymd } | { ok: false; error: string }

const FORMAT_HINT = 'Write the year first (2082-07-08) or use the month’s name (8 Kartik 2082).'

export function parseBs(text: string): Parsed {
  const clean = asciiDigits(text).trim().toLowerCase().normalize('NFC')
  if (!clean) return { ok: false, error: 'Enter a BS date.' }
  if (clean.length > 60) return { ok: false, error: 'That is too long to be a date.' }

  const numeric = /^(\d{4})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{1,2})$/.exec(clean.replace(/\s*(bs|b\.s\.?|गते)$/, ''))
  if (numeric) return checked({ year: Number(numeric[1]), month: Number(numeric[2]), day: Number(numeric[3]) })
  if (/^\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}$/.test(clean)) return { ok: false, error: `Day-first dates are ambiguous. ${FORMAT_HINT}` }

  const tokens = clean.split(/[\s,]+/).filter((t) => t && !NOISE.has(t))
  let year: number | undefined, month: number | undefined, day: number | undefined
  for (const token of tokens) {
    const named = MONTH_BY_NAME.get(token.replace(/\.$/, ''))
    if (named !== undefined && month === undefined) month = named
    else if (/^\d{4}$/.test(token) && year === undefined) year = Number(token)
    else if (/^\d{1,2}$/.test(token) && day === undefined) day = Number(token)
    else return { ok: false, error: /^\p{L}+$/u.test(token) ? `“${token.slice(0, 20)}” is not a BS month name. ${FORMAT_HINT}` : FORMAT_HINT }
  }
  if (year === undefined || month === undefined || day === undefined) return { ok: false, error: FORMAT_HINT }
  return checked({ year, month, day })
}

function checked(date: Ymd): Parsed {
  const error = checkBs(date)
  return error ? { ok: false, error } : { ok: true, date }
}
