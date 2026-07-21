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

const EXPLICIT_ZONE = /(?:z|[+-]\d{2}:?\d{2})$/i

export function parseIsoInput(raw: string): ParseResult {
  const input = raw.trim()
  if (!input) return { value: null, error: 'Enter an ISO-8601 date and time.' }
  const localAssumed = !EXPLICIT_ZONE.test(input)
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00` : input
  const milliseconds = Date.parse(normalized)
  if (!Number.isFinite(milliseconds)) return { value: null, error: 'Date is not valid ISO-8601 input.' }
  return {
    value: { milliseconds, nanoseconds: BigInt(milliseconds) * NS_PER_MILLISECOND, inferredUnit: 'ms', localAssumed },
    error: null,
  }
}

export function parseLocalDateTime(raw: string): ParseResult {
  if (!raw) return { value: null, error: 'Choose a local date and time.' }
  const milliseconds = new Date(raw).getTime()
  if (!Number.isFinite(milliseconds)) return { value: null, error: 'Local date and time are invalid.' }
  return { value: { milliseconds, nanoseconds: BigInt(milliseconds) * NS_PER_MILLISECOND, inferredUnit: 'ms', localAssumed: true }, error: null }
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
