/**
 * Nepal's land units, held as exact fractions of a square metre so that
 * 16 aana is exactly one ropani and nothing drifts in either direction.
 *
 * Both systems are defined in feet:
 *   hill (ropani):  1 ropani = 74 ft × 74 ft = 5,476 ft² = 16 aana,
 *                   1 aana = 4 paisa, 1 paisa = 4 dam
 *   Terai (bigha):  1 bigha = 20 kattha, 1 kattha = 20 dhur,
 *                   1 dhur = 13.5 ft × 13.5 ft = 182.25 ft²
 * and the international foot is exactly 0.3048 m.
 */

/** A non-negative rational with bigint parts, always in lowest terms. */
export interface Q {
  n: bigint
  d: bigint
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a < 0n ? -a : a
}

export function q(n: bigint, d = 1n): Q {
  if (d === 0n) throw new RangeError('division by zero')
  if (d < 0n) { n = -n; d = -d }
  const g = gcd(n, d) || 1n
  return { n: n / g, d: d / g }
}

export const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d)
export const div = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n)
export const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d)
export const isZero = (a: Q) => a.n === 0n

/** Devanagari digits (०–९) read as ASCII, so a lalpurja can be typed as written. */
export function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966))
}

const DECIMAL = /^(\d*)(?:\.(\d*))?$/

/**
 * An exact decimal: "12", "0.5", ".25", "1,234.5". Empty input is zero;
 * anything else (signs, exponents, letters) is null.
 */
export function parseDecimal(raw: string): Q | null {
  const text = asciiDigits(raw).trim().replace(/,/g, '')
  if (text === '') return q(0n)
  if (text.length > 40) return null
  const m = DECIMAL.exec(text)
  if (!m || (m[1] === '' && !m[2])) return null
  const frac = m[2] ?? ''
  return q(BigInt((m[1] || '0') + frac), 10n ** BigInt(frac.length))
}

/** Rounded half up to `digits` places, trailing zeros dropped, thousands grouped. */
export function formatQ(value: Q, digits: number, group = true): string {
  const scale = 10n ** BigInt(digits)
  const scaled = (value.n * scale * 2n + value.d) / (value.d * 2n)
  let whole = (scaled / scale).toString()
  const frac = (scaled % scale).toString().padStart(digits, '0').replace(/0+$/, '')
  if (group) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${whole}.${frac}` : whole
}

const FT2: Q = q(9290304n, 100000000n) // 0.3048² m², exact
const ft2 = (n: bigint, d = 1n) => mul(q(n, d), FT2)

export type UnitId = 'ropani' | 'aana' | 'paisa' | 'dam' | 'bigha' | 'kattha' | 'dhur' | 'm2' | 'ft2' | 'ha' | 'acre'

export interface Unit {
  id: UnitId
  name: string
  /** The unit's name in Nepali, where it has one. */
  nepali?: string
  /** Square metres per unit, exact. */
  m2: Q
  /** Decimal places shown. */
  digits: number
  /** How the unit is defined, in words. */
  definition: string
}

export const UNITS: Unit[] = [
  { id: 'ropani', name: 'Ropani', nepali: 'रोपनी', m2: ft2(5476n), digits: 4, definition: '74 ft × 74 ft = 5,476 ft² = 16 aana' },
  { id: 'aana', name: 'Aana', nepali: 'आना', m2: ft2(34225n, 100n), digits: 4, definition: '1/16 ropani = 18.5 ft × 18.5 ft = 342.25 ft² = 4 paisa' },
  { id: 'paisa', name: 'Paisa', nepali: 'पैसा', m2: ft2(855625n, 10000n), digits: 4, definition: '1/4 aana = 85.5625 ft² = 4 dam' },
  { id: 'dam', name: 'Dam', nepali: 'दाम', m2: ft2(21390625n, 1000000n), digits: 4, definition: '1/4 paisa = 21.390625 ft²' },
  { id: 'bigha', name: 'Bigha', nepali: 'बिघा', m2: ft2(72900n), digits: 4, definition: '20 kattha = 400 dhur = 72,900 ft²' },
  { id: 'kattha', name: 'Kattha', nepali: 'कट्ठा', m2: ft2(3645n), digits: 4, definition: '1/20 bigha = 20 dhur = 3,645 ft²' },
  { id: 'dhur', name: 'Dhur', nepali: 'धुर', m2: ft2(18225n, 100n), digits: 4, definition: '1/20 kattha = 13.5 ft × 13.5 ft = 182.25 ft²' },
  { id: 'm2', name: 'Square metre', nepali: 'वर्ग मिटर', m2: q(1n), digits: 2, definition: 'm²' },
  { id: 'ft2', name: 'Square foot', nepali: 'वर्ग फिट', m2: FT2, digits: 2, definition: '0.3048 m × 0.3048 m = 0.09290304 m²' },
  { id: 'ha', name: 'Hectare', nepali: 'हेक्टर', m2: q(10000n), digits: 6, definition: '10,000 m²' },
  { id: 'acre', name: 'Acre', m2: ft2(43560n), digits: 6, definition: '43,560 ft² = 4,046.8564224 m²' },
]

export const UNIT: Record<UnitId, Unit> = Object.fromEntries(UNITS.map((u) => [u.id, u])) as Record<UnitId, Unit>

export type SystemId = 'hill' | 'terai'

/** The compound forms, largest part first; the last part keeps decimals. */
export const SYSTEMS: Record<SystemId, { name: string; parts: UnitId[]; per: bigint[] }> = {
  // per[i]: how many of the smallest part make one of parts[i].
  hill: { name: 'Ropani-Aana-Paisa-Dam', parts: ['ropani', 'aana', 'paisa', 'dam'], per: [256n, 16n, 4n, 1n] },
  terai: { name: 'Bigha-Kattha-Dhur', parts: ['bigha', 'kattha', 'dhur'], per: [400n, 20n, 1n] },
}

export interface Compound {
  /** "2-5-1-3.25", the way land records write it. */
  text: string
  /** Each part's value as text, in system order. */
  parts: string[]
}

/**
 * Splits an area into whole ropani/aana/paisa (or bigha/kattha) with the
 * smallest part rounded to `digits` places; rounding carries upward, so
 * 3.999 dam at 2 places becomes one more paisa, never "4 dam".
 */
export function toCompound(area: Q, system: SystemId, digits = 2): Compound {
  const { parts, per } = SYSTEMS[system]
  const smallest = UNIT[parts[parts.length - 1]].m2
  const scale = 10n ** BigInt(digits)
  const inSmallest = div(area, smallest)
  let rest = (inSmallest.n * scale * 2n + inSmallest.d) / (inSmallest.d * 2n)
  const out: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    const unit = per[i] * scale
    out.push((rest / unit).toString())
    rest %= unit
  }
  out.push(formatQ(q(rest, scale), digits, false))
  return { text: out.join('-'), parts: out }
}

/** Sums compound parts (each may be fractional or over its usual limit) into m². */
export function fromCompound(values: Q[], system: SystemId): Q {
  const { parts } = SYSTEMS[system]
  return parts.reduce((sum, id, i) => add(sum, mul(values[i] ?? q(0n), UNIT[id].m2)), q(0n))
}

/**
 * Reads "0-4-2-1" / "1-5-10.5" (parts split by dashes, slashes or spaces)
 * into its parts. Returns null if it doesn't have the system's shape.
 */
export function parseCompound(text: string, system: SystemId): string[] | null {
  const parts = asciiDigits(text).trim().split(/\s*[-–—/]\s*|\s+/).filter((p) => p !== '')
  const size = SYSTEMS[system].parts.length
  if (parts.length < 2 || parts.length > size) return null
  if (parts.some((p) => !parseDecimal(p))) return null
  // A short form fills from the left: "4-2" is 4 ropani 2 aana.
  return [...parts, ...Array(size - parts.length).fill('0')]
}
