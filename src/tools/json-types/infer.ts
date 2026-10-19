/**
 * Inference: every value seen at the same position (a key, an array's items,
 * the root of every sample) is folded into one Shape — counts per JSON type,
 * the keys of every object, string statistics. Nothing is decided here; the
 * model (model.ts) turns counts into optional / nullable / union / format /
 * enum decisions, so those stay options.
 */

import { BigLiteral, FLOAT_LITERAL } from './parse'

/** Containers deeper than this are not descended: their position is typed unknown and reported. */
export const MAX_DEPTH = 64
/** Distinct strings tracked per position for enum detection; past this the position is not an enum. */
export const ENUM_TRACK = 64
/** Strings longer than this rule a position out as an enum. */
export const ENUM_MAX_LENGTH = 64

export type Format = 'date-time' | 'date' | 'uuid' | 'email' | 'uri'
export const FORMATS: Format[] = ['date-time', 'date', 'uuid', 'email', 'uri']

export interface StringStats {
  count: number
  /** Distinct values with their counts, or null once there are too many (or too long) to be an enum. */
  values: Map<string, number> | null
  /** How many strings matched each format — a format applies only when it equals `count`. */
  formats: Record<Format, number>
}

export interface ArrayStats {
  count: number
  empty: number
  item: Shape
}

export interface ObjectStats {
  count: number
  /** Keys in first-seen order; a field's `seen` below `count` means some objects lacked it. */
  fields: Map<string, Shape>
}

export interface Shape {
  seen: number
  nulls: number
  bools: number
  /** Integers within ±(2^53 − 1). */
  ints: number
  /** Integer literals past 2^53 (or, without source text, unsafe integer values). */
  bigs: number
  floats: number
  strings: StringStats | null
  arrays: ArrayStats | null
  objects: ObjectStats | null
  /** Containers past MAX_DEPTH, not inferred. */
  deep: number
}

export function newShape(): Shape {
  return { seen: 0, nulls: 0, bools: 0, ints: 0, bigs: 0, floats: 0, strings: null, arrays: null, objects: null, deep: 0 }
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

function validDate(y: string, m: string, d: string): boolean {
  const month = Number(m)
  const day = Number(d)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(Number(y), month)
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_+.-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/
const URI = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/

/**
 * Deliberately narrow, so a refinement never rejects data the samples hold:
 * RFC 3339 date-times with seconds, an upper-case T and Z or ±hh:mm offset;
 * calendar dates that exist; RFC 9562 UUIDs (version 1–8, variant 10xx);
 * plain dot-atom emails; http(s) URLs that the URL parser accepts and that use
 * only RFC 3986 characters. Each is a subset of what Zod 4 and JSON Schema's
 * format of the same name accept.
 */
export const formatTests: Record<Format, (value: string) => boolean> = {
  'date-time': (value) => {
    const m = DATE_TIME.exec(value)
    return Boolean(m && validDate(m[1], m[2], m[3]) && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6]) < 60
      && (m[7] === undefined || (Number(m[7]) < 24 && Number(m[8]) < 60)))
  },
  date: (value) => {
    const m = DATE.exec(value)
    return Boolean(m && validDate(m[1], m[2], m[3]))
  },
  uuid: (value) => UUID.test(value),
  email: (value) => value.length <= 254 && EMAIL.test(value),
  uri: (value) => {
    if (!URI.test(value)) return false
    try {
      return new URL(value).hostname !== ''
    } catch {
      return false
    }
  },
}

function addString(shape: Shape, value: string) {
  const stats = (shape.strings ??= { count: 0, values: new Map(), formats: { 'date-time': 0, date: 0, uuid: 0, email: 0, uri: 0 } })
  stats.count++
  if (stats.values) {
    if (value.length > ENUM_MAX_LENGTH) stats.values = null
    else {
      stats.values.set(value, (stats.values.get(value) ?? 0) + 1)
      if (stats.values.size > ENUM_TRACK) stats.values = null
    }
  }
  for (const format of FORMATS) {
    // Once one string missed, the format can never apply here — skip the test.
    if (stats.formats[format] === stats.count - 1 && formatTests[format](value)) stats.formats[format]++
  }
}

export interface InferState {
  /** Values folded in, for the stats line. */
  values: number
}

/** Folds one value into `shape`. Recursion is bounded by MAX_DEPTH. */
export function addValue(shape: Shape, value: unknown, depth: number, state: InferState) {
  shape.seen++
  state.values++
  if (value === null) {
    shape.nulls++
    return
  }
  switch (typeof value) {
    case 'boolean':
      shape.bools++
      return
    case 'number':
      if (!Number.isInteger(value)) shape.floats++
      // An unsafe integer value only gets here when the source text was unavailable (parse.ts).
      else if (Number.isSafeInteger(value)) shape.ints++
      else shape.bigs++
      return
    case 'string':
      addString(shape, value)
      return
  }
  if (value === FLOAT_LITERAL) {
    shape.floats++
    return
  }
  if (value instanceof BigLiteral) {
    shape.bigs++
    return
  }
  if (depth >= MAX_DEPTH) {
    shape.deep++
    return
  }
  if (Array.isArray(value)) {
    const stats = (shape.arrays ??= { count: 0, empty: 0, item: newShape() })
    stats.count++
    if (value.length === 0) stats.empty++
    for (const item of value) addValue(stats.item, item, depth + 1, state)
    return
  }
  const stats = (shape.objects ??= { count: 0, fields: new Map() })
  stats.count++
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    let field = stats.fields.get(key)
    if (!field) stats.fields.set(key, (field = newShape()))
    addValue(field, record[key], depth + 1, state)
  }
}
