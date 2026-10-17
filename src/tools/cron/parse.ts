/**
 * Hand-written parser for standard five-field cron expressions
 * (minute hour day-of-month month day-of-week), with Vixie cron semantics.
 */

export type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

export interface FieldSpec {
  name: FieldName
  label: string
  min: number
  max: number
  names?: string[]
}

export const FIELDS: FieldSpec[] = [
  { name: 'minute', label: 'Minute', min: 0, max: 59 },
  { name: 'hour', label: 'Hour', min: 0, max: 23 },
  { name: 'dayOfMonth', label: 'Day of month', min: 1, max: 31 },
  {
    name: 'month', label: 'Month', min: 1, max: 12,
    names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  },
  // 7 is accepted as a second Sunday and folded into 0.
  { name: 'dayOfWeek', label: 'Day of week', min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] },
]

/** One comma-separated element of a field, as written. */
export interface FieldPart {
  /** null when the base is `*`. */
  start: number | null
  /** Inclusive end; equals start for a single value without a step. */
  end: number | null
  step: number
  /** True for `n/step`, which runs from n to the field's maximum. */
  openEnded: boolean
}

export interface ParsedField {
  spec: FieldSpec
  source: string
  parts: FieldPart[]
  /** Sorted, deduplicated values that match (day-of-week 7 folded into 0). */
  values: number[]
  /** has[v] is true when v matches — a fast lookup for the scheduler. */
  has: boolean[]
  /** True when every value in the field's range matches. */
  all: boolean
  /**
   * Vixie cron's DOM_STAR / DOW_STAR flag: the field's text starts with `*`
   * (so `*` and `*\/2` both count). It decides the day-of-month / day-of-week
   * combination rule.
   */
  star: boolean
}

export interface CronExpression {
  source: string
  /** Set when the input was a macro such as @daily. */
  macro?: string
  /** The five fields actually evaluated. */
  normalized: string
  minute: ParsedField
  hour: ParsedField
  dayOfMonth: ParsedField
  month: ParsedField
  dayOfWeek: ParsedField
  /**
   * True when both day fields are restricted (neither starts with `*`):
   * a day then matches if EITHER matches.
   */
  dayOr: boolean
}

export interface CronError {
  /** Field index 0–4, or null when the error is about the whole expression. */
  field: number | null
  message: string
}

export type ParseResult = { ok: true, cron: CronExpression } | { ok: false, error: CronError }

export const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

class FieldError extends Error {}

function parseNumber(text: string, spec: FieldSpec): number {
  if (/^\d+$/.test(text)) {
    const value = Number(text)
    if (value < spec.min || value > spec.max) {
      throw new FieldError(`${value} is out of range (${spec.min}–${spec.max})`)
    }
    return value
  }
  if (spec.names && /^[a-z]+$/i.test(text)) {
    const index = spec.names.indexOf(text.toUpperCase())
    if (index >= 0) return index + (spec.name === 'month' ? 1 : 0)
    throw new FieldError(`"${text}" is not a ${spec.name === 'month' ? 'month' : 'day'} name (use ${spec.names[0]}–${spec.names[spec.names.length - 1]})`)
  }
  if (text === '') throw new FieldError('a number is missing')
  if (/^-\d/.test(text)) throw new FieldError(`negative values like "${text}" are not allowed`)
  if (/^[LW#?]|[LW#?]$/i.test(text) || text.includes('#')) {
    throw new FieldError(`"${text}" uses Quartz syntax (L, W, #, ?), which standard cron does not support`)
  }
  throw new FieldError(`"${text}" is not a number${spec.names ? ' or name' : ''}`)
}

function parsePart(text: string, spec: FieldSpec): FieldPart {
  if (text === '') throw new FieldError('empty list item (check for a stray comma)')
  const slash = text.split('/')
  if (slash.length > 2) throw new FieldError(`"${text}" has more than one "/"`)
  const [base, stepText] = slash
  let step = 1
  if (stepText !== undefined) {
    if (!/^\d+$/.test(stepText)) throw new FieldError(`step "${stepText}" in "${text}" must be a positive whole number`)
    step = Number(stepText)
    if (step === 0) throw new FieldError(`step 0 in "${text}" never advances`)
  }
  if (base === '*') return { start: null, end: null, step, openEnded: false }
  const dash = base.split('-')
  if (dash.length > 2 && dash[0] !== '') throw new FieldError(`"${base}" is not a valid range`)
  if (dash.length === 2 && dash[0] !== '') {
    const start = parseNumber(dash[0], spec)
    if (dash[1] === '') throw new FieldError(`range "${base}" is missing its end`)
    const end = parseNumber(dash[1], spec)
    if (start > end) throw new FieldError(`range ${dash[0]}-${dash[1]} runs backwards (cron ranges do not wrap)`)
    return { start, end, step, openEnded: false }
  }
  const value = parseNumber(base, spec)
  if (stepText !== undefined) return { start: value, end: spec.max, step, openEnded: true }
  return { start: value, end: value, step, openEnded: false }
}

function parseField(source: string, spec: FieldSpec): ParsedField {
  const parts = source.split(',').map((part) => parsePart(part, spec))
  const set = new Set<number>()
  for (const part of parts) {
    const start = part.start ?? spec.min
    // `*` in day-of-week means 0–6; 7 only appears when written explicitly.
    const end = part.end ?? (spec.name === 'dayOfWeek' ? 6 : spec.max)
    for (let v = start; v <= end; v += part.step) set.add(spec.name === 'dayOfWeek' && v === 7 ? 0 : v)
  }
  const values = [...set].sort((a, b) => a - b)
  const size = spec.name === 'dayOfWeek' ? 7 : spec.max - spec.min + 1
  const has: boolean[] = []
  for (const v of values) has[v] = true
  return { spec, source, parts, values, has, all: values.length === size, star: source.startsWith('*') }
}

export function parseCron(input: string): ParseResult {
  const source = input.trim()
  if (source === '') return { ok: false, error: { field: null, message: 'Enter a cron expression, e.g. */15 9-17 * * 1-5' } }

  let text = source
  let macro: string | undefined
  if (source.startsWith('@')) {
    const key = source.toLowerCase()
    if (key === '@reboot') {
      return { ok: false, error: { field: null, message: '@reboot runs once when cron starts, not on a schedule — there are no run times to show' } }
    }
    if (!(key in MACROS)) {
      return { ok: false, error: { field: null, message: `Unknown macro "${source}" — use one of ${Object.keys(MACROS).join(', ')}` } }
    }
    macro = key
    text = MACROS[key]
  }

  const tokens = text.split(/\s+/)
  if (tokens.length === 6 || tokens.length === 7) {
    return {
      ok: false,
      error: {
        field: null,
        message: `Got ${tokens.length} fields. Standard cron has exactly 5 (minute hour day-of-month month day-of-week); a leading seconds field${tokens.length === 7 ? ' or trailing year field' : ''} (Quartz / Spring style) is not supported. If the line ends with a command, paste only the schedule.`,
      },
    }
  }
  if (tokens.length !== 5) {
    return {
      ok: false,
      error: {
        field: null,
        message: tokens.length < 5
          ? `Got ${tokens.length} field${tokens.length === 1 ? '' : 's'}, expected 5: minute hour day-of-month month day-of-week`
          : `Got ${tokens.length} fields, expected 5. If the line includes a command or user name, paste only the schedule.`,
      },
    }
  }

  const fields: ParsedField[] = []
  for (let i = 0; i < 5; i++) {
    try {
      fields.push(parseField(tokens[i], FIELDS[i]))
    } catch (err) {
      if (err instanceof FieldError) {
        return { ok: false, error: { field: i, message: `${FIELDS[i].label} field "${tokens[i]}": ${err.message}` } }
      }
      throw err
    }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  return {
    ok: true,
    cron: {
      source,
      macro,
      normalized: tokens.join(' '),
      minute,
      hour,
      dayOfMonth,
      month,
      dayOfWeek,
      dayOr: !dayOfMonth.star && !dayOfWeek.star,
    },
  }
}

/** Does a calendar day match, using Vixie's rule for the two day fields? */
export function dayMatches(cron: CronExpression, dayOfMonth: number, month: number, weekday: number): boolean {
  if (!cron.month.has[month]) return false
  const dom = cron.dayOfMonth.has[dayOfMonth] === true
  const dow = cron.dayOfWeek.has[weekday] === true
  if (cron.dayOr) return dom || dow
  return dom && dow
}
