export type TimeUnit = 'auto' | 's' | 'ms' | 'us' | 'ns'

export interface ParsedInstant {
  milliseconds: number
  nanoseconds: bigint
  inferredUnit: Exclude<TimeUnit, 'auto'>
  localAssumed?: boolean
}

export type ParseResult = { value: ParsedInstant; error: null } | { value: null; error: string }

const NS_PER_SECOND = 1_000_000_000n
const NS_PER_MILLISECOND = 1_000_000n
const DATE_LIMIT_MS = 8_640_000_000_000_000

function inferredFromDigits(raw: string): Exclude<TimeUnit, 'auto'> {
  const digits = raw.replace(/^[+-]/, '').split('.')[0].replace(/^0+/, '').length || 1
  if (digits <= 10) return 's'
  if (digits <= 13) return 'ms'
  if (digits <= 16) return 'us'
  return 'ns'
}

function decimalToNanoseconds(raw: string, unit: 's' | 'ms'): bigint {
  const negative = raw.startsWith('-')
  const unsigned = raw.replace(/^[+-]/, '')
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const scale = unit === 's' ? 9 : 6
  if (fraction.length > scale) throw new Error(`${unit === 's' ? 'Seconds' : 'Milliseconds'} support at most ${scale} fractional digits.`)
  const base = BigInt(whole || '0') * (unit === 's' ? NS_PER_SECOND : NS_PER_MILLISECOND)
  const sub = BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0')
  return negative ? -(base + sub) : base + sub
}

function floorDiv(value: bigint, divisor: bigint): [bigint, bigint] {
  let quotient = value / divisor
  let remainder = value % divisor
  if (remainder < 0) {
    quotient -= 1n
    remainder += divisor
  }
  return [quotient, remainder]
}

export function parseTimestamp(raw: string, requestedUnit: TimeUnit): ParseResult {
  const input = raw.trim()
  if (!input) return { value: null, error: 'Enter a Unix timestamp.' }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(input)) return { value: null, error: 'Timestamp must be a signed number.' }

  const inferredUnit = requestedUnit === 'auto' ? inferredFromDigits(input) : requestedUnit
  if (input.includes('.') && inferredUnit !== 's' && inferredUnit !== 'ms') {
    return { value: null, error: 'Fractional values are supported only for seconds or milliseconds.' }
  }

  try {
    let nanoseconds: bigint
    if (input.includes('.')) {
      nanoseconds = decimalToNanoseconds(input, inferredUnit as 's' | 'ms')
    } else {
      const integer = BigInt(input)
      nanoseconds = inferredUnit === 's'
        ? integer * NS_PER_SECOND
        : inferredUnit === 'ms'
          ? integer * NS_PER_MILLISECOND
          : inferredUnit === 'us'
            ? integer * 1_000n
            : integer
    }
    const [millisecondsBig] = floorDiv(nanoseconds, NS_PER_MILLISECOND)
    const milliseconds = Number(millisecondsBig)
    if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > DATE_LIMIT_MS || Number.isNaN(new Date(milliseconds).getTime())) {
      return { value: null, error: 'Timestamp is outside the JavaScript Date range.' }
    }
    return { value: { milliseconds, nanoseconds, inferredUnit }, error: null }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) }
  }
}

// Extended-format ISO 8601 only: a date (YYYY, YYYY-MM, YYYY-MM-DD, or a
// six-digit signed year), optionally a time (HH:MM, HH:MM:SS, with a
// fraction of up to nine digits after "." or ","), and after a time an
// optional offset (Z, ±HH, ±HHMM, ±HH:MM). "T" may also be "t" or a space
// (RFC 3339). Anything else is an error rather than whatever Date.parse
// happens to guess.
const ISO_8601 = /^([+-]\d{6}|\d{4})(?:-(\d{2})(?:-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/
const ISO_HELP = 'Not ISO 8601 — use e.g. 2024-06-01T12:00:00Z (date, optional time with fraction, then Z, ±HH or ±HH:MM).'

function daysInMonth(year: number, month: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month, 0)
  return date.getUTCDate()
}

function fieldsToMs(local: boolean, year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const date = new Date(0)
  if (local) {
    date.setFullYear(year, month - 1, day)
    date.setHours(hour, minute, second, 0)
  } else {
    date.setUTCFullYear(year, month - 1, day)
    date.setUTCHours(hour, minute, second, 0)
  }
  return date.getTime()
}

export function parseIsoInput(raw: string): ParseResult {
  const input = raw.trim()
  if (!input) return { value: null, error: 'Enter an ISO 8601 date and time.' }
  const match = ISO_8601.exec(input)
  if (!match) return { value: null, error: ISO_HELP }
  const [, yearText, monthText = '01', dayText = '01', hourText = '00', minuteText = '00', secondText = '00', fraction = '', zone] = match
  if (yearText === '-000000') return { value: null, error: 'ISO 8601 has no year -000000; write 0000.' }
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (month < 1 || month > 12) return { value: null, error: `Not ISO 8601 — month ${monthText} does not exist.` }
  if (day < 1 || day > daysInMonth(year, month)) return { value: null, error: `Not ISO 8601 — ${yearText}-${monthText} has no day ${dayText}.` }
  if (hour > 23 || minute > 59) return { value: null, error: `Not ISO 8601 — ${hourText}:${minuteText} is not a time of day.` }
  if (second > 59) return { value: null, error: second === 60 ? 'Leap seconds (:60) cannot be represented in Unix time.' : `Not ISO 8601 — second ${secondText} does not exist.` }
  if (fraction.length > 9) return { value: null, error: 'Fractions hold at most 9 fractional digits (nanoseconds).' }

  let offsetMinutes = 0
  if (zone && zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '')
    const offsetHours = Number(digits.slice(0, 2))
    const offsetMins = Number(digits.slice(2) || '0')
    if (offsetHours > 23 || offsetMins > 59) return { value: null, error: `Not ISO 8601 — ${zone} is not a UTC offset.` }
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (offsetHours * 60 + offsetMins)
  }

  const localAssumed = !zone
  const baseMs = fieldsToMs(localAssumed, year, month, day, hour, minute, second)
  if (!Number.isFinite(baseMs)) return { value: null, error: 'Date is outside the JavaScript Date range.' }
  const fractionNs = BigInt((fraction + '000000000').slice(0, 9))
  const nanoseconds = BigInt(baseMs) * NS_PER_MILLISECOND + fractionNs - BigInt(offsetMinutes) * 60n * NS_PER_SECOND
  const milliseconds = Number(floorDiv(nanoseconds, NS_PER_MILLISECOND)[0])
  if (Math.abs(milliseconds) > DATE_LIMIT_MS) return { value: null, error: 'Date is outside the JavaScript Date range.' }
  return { value: { milliseconds, nanoseconds, inferredUnit: 's', localAssumed }, error: null }
}

export function parseLocalDateTime(raw: string): ParseResult {
  if (!raw) return { value: null, error: 'Choose a local date and time.' }
  const milliseconds = new Date(raw).getTime()
  if (!Number.isFinite(milliseconds)) return { value: null, error: 'Local date and time are invalid.' }
  return { value: { milliseconds, nanoseconds: BigInt(milliseconds) * NS_PER_MILLISECOND, inferredUnit: 's', localAssumed: true }, error: null }
}

/**
 * The text and unit to write into the timestamp field for an instant that
 * came from a date field. The two must agree, or retyping the value reads it
 * in the wrong unit: an explicit unit is kept when it can hold the instant
 * exactly (microseconds cannot hold a nanosecond fraction — that falls back
 * to nanoseconds); Auto stays Auto only when auto-detection would read the
 * seconds back as seconds.
 */
export function timestampField(nanoseconds: bigint, unit: TimeUnit): { text: string; unit: TimeUnit } {
  const values = timestampValues(nanoseconds)
  const textFor: Record<Exclude<TimeUnit, 'auto'>, string> = {
    s: values.seconds, ms: values.milliseconds, us: values.microseconds, ns: values.nanoseconds,
  }
  const candidates: TimeUnit[] = unit === 'auto' ? ['auto', 's', 'ns'] : [unit, 'ns']
  for (const candidate of candidates) {
    const text = textFor[candidate === 'auto' ? 's' : candidate]
    const back = parseTimestamp(text, candidate)
    if (back.value?.nanoseconds === nanoseconds) return { text, unit: candidate }
  }
  return { text: values.nanoseconds, unit: 'ns' }
}

/** Every zone the selects offer. Intl.supportedValuesOf omits UTC, so it is added first. */
export function zoneOptions(supported: readonly string[] | undefined, localZone: string): string[] {
  const list = (supported ?? []).filter((zone) => zone !== 'UTC')
  const local = localZone === 'UTC' || list.includes(localZone) ? [] : [localZone]
  return ['UTC', ...local, ...list]
}

function decimalFromNanoseconds(value: bigint, scale: bigint): string {
  const negative = value < 0
  const absolute = negative ? -value : value
  const whole = absolute / scale
  const remainder = absolute % scale
  const sign = negative ? '-' : ''
  if (remainder === 0n) return `${sign}${whole}`
  const places = scale.toString().length - 1
  return `${sign}${whole}.${remainder.toString().padStart(places, '0').replace(/0+$/, '')}`
}

export function timestampValues(nanoseconds: bigint) {
  return {
    seconds: decimalFromNanoseconds(nanoseconds, NS_PER_SECOND),
    milliseconds: decimalFromNanoseconds(nanoseconds, NS_PER_MILLISECOND),
    microseconds: decimalFromNanoseconds(nanoseconds, 1_000n),
    nanoseconds: nanoseconds.toString(),
  }
}

export function preciseIso(instant: ParsedInstant): string {
  const base = new Date(instant.milliseconds).toISOString()
  const [, subMillisecond] = floorDiv(instant.nanoseconds, NS_PER_MILLISECOND)
  if (subMillisecond === 0n) return base
  return `${base.slice(0, -1)}${subMillisecond.toString().padStart(6, '0')}Z`
}

export function localInputValue(milliseconds: number): string {
  const date = new Date(milliseconds)
  const part = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}.${part(date.getMilliseconds(), 3)}`
}

export function relativeTime(milliseconds: number, now = Date.now()): string {
  const seconds = Math.round((milliseconds - now) / 1000)
  const ranges: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86_400, 'day'], [3_600, 'hour'], [60, 'minute'], [1, 'second'],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [size, unit] of ranges) {
    if (Math.abs(seconds) >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit)
  }
  return 'now'
}

export function formatInZone(milliseconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'full', timeStyle: 'long', timeZone,
  }).format(new Date(milliseconds))
}
