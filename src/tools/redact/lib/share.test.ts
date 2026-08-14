import { describe, expect, it } from 'vitest'
import { PRESETS } from './patterns'
import type { Target } from './redact'
import {
  countKinds,
  decodeFragment,
  encodeScheme,
  LENGTH_WARN,
  MAX_PATTERN,
  MAX_TARGETS,
  normalizeScheme,
  schemeFromJson,
  schemeJson,
  schemeUrl,
  toWire,
  VERSION,
  type Scheme,
} from './share'

const BASE = 'https://theswissknife.com/redact'

const patterns: Target[] = PRESETS.map((preset) => ({ kind: 'regex', value: preset.value }))
const literals: Target[] = [
  { kind: 'literal', value: 'Acme Corp' },
  { kind: 'literal', value: 'dana.whitfield@example.com' },
  { kind: 'literal', value: 'sk_live_9f3ac1b8d47e2205' },
]

const scheme = (over: Partial<Scheme> = {}): Scheme => ({
  mask: '█',
  spaces: 'keep',
  scope: 'picked',
  caseSensitive: false,
  targets: patterns,
  ...over,
})

const roundTrip = async (input: Scheme, includeLiterals = true) =>
  decodeFragment(`#p=${await encodeScheme(input, includeLiterals)}`)

describe('encode and decode', () => {
  it('round-trips a settings-only scheme', async () => {
    const input = scheme({ scope: 'all', targets: [], spaces: 'remove', mask: '░' })
    expect(await roundTrip(input)).toEqual(input)
  })

  it('round-trips patterns, literals and the case flag', async () => {
    const input = scheme({ targets: [...patterns, ...literals], caseSensitive: true })
    expect(await roundTrip(input)).toEqual(input)
  })

  it('round-trips a mask that is not ASCII', async () => {
    expect((await roundTrip(scheme({ mask: '🟥' })))?.mask).toBe('🟥')
  })

  it('produces a URL-safe payload', async () => {
    const payload = await encodeScheme(scheme({ targets: [...patterns, ...literals] }), true)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('literals stay out unless asked for', () => {
  const mixed = scheme({ targets: [...patterns, ...literals] })

  it('drops literal targets by default', async () => {
    const decoded = await roundTrip(mixed, false)
    expect(decoded?.targets).toEqual(patterns)
    expect(countKinds(decoded!.targets)).toEqual({ patterns: 5, literals: 0 })
  })

  it('never writes a literal value into the payload when they are excluded', async () => {
    const wire = JSON.stringify(toWire(mixed, false))
    for (const literal of literals) expect(wire).not.toContain(literal.value)
  })

  it('includes them, verbatim, when the sharer opts in', async () => {
    const wire = JSON.stringify(toWire(mixed, true))
    for (const literal of literals) expect(wire).toContain(literal.value)
  })

  it('counts what each kind holds, so the dialog can say so', () => {
    expect(countKinds(mixed.targets)).toEqual({ patterns: 5, literals: 3 })
  })
})

describe('link length', () => {
  const url = async (input: Scheme, withLiterals = true) =>
    schemeUrl(await encodeScheme(input, withLiterals), BASE)

  it('keeps a full preset profile well inside what chat and email survive', async () => {
    const link = await url(scheme())
    expect(link.length).toBeLessThan(400)
  })

  it('stays short for settings only', async () => {
    expect((await url(scheme({ scope: 'all', targets: [] }))).length).toBeLessThan(150)
  })

  it('compresses a long target list rather than growing linearly', async () => {
    const many: Target[] = Array.from({ length: 50 }, (_, i) => ({
      kind: 'literal',
      value: `customer-name-${i}`,
    }))
    const link = await url(scheme({ targets: many }))
    expect(link.length).toBeLessThan(LENGTH_WARN)
  })
})

describe('decoding anything hostile or stale', () => {
  it('returns null rather than throwing', async () => {
    expect(await decodeFragment('')).toBeNull()
    expect(await decodeFragment('#p=')).toBeNull()
    expect(await decodeFragment('#p=!!!not-base64!!!')).toBeNull()
    expect(await decodeFragment('#p=aGVsbG8')).toBeNull() // valid base64, not deflated
    expect(await decodeFragment('#other=1')).toBeNull()
    expect(await decodeFragment('#z=whatever')).toBeNull() // another tool's format
  })

  it('ignores a payload from a version it does not know', () => {
    expect(normalizeScheme({ v: VERSION + 1, m: '█', s: 'keep', k: 'all', t: [] })).toBeNull()
    expect(normalizeScheme({ m: '█', s: 'keep', k: 'all', t: [] })).toBeNull()
  })

  it('falls back to safe values for nonsense fields', () => {
    const out = normalizeScheme({ v: VERSION, m: 42, s: 'sideways', k: 'elsewhere', t: 'nope' })
    expect(out).toEqual({
      mask: '█',
      spaces: 'keep',
      scope: 'all',
      caseSensitive: false,
      targets: [],
    })
  })

  it('caps how many targets a link can bring', () => {
    const many = Array.from({ length: MAX_TARGETS + 40 }, (_, i) => ['l', `x${i}`])
    const out = normalizeScheme({ v: VERSION, m: '█', s: 'keep', k: 'picked', t: many })
    expect(out?.targets).toHaveLength(MAX_TARGETS)
  })

  it('drops an over-long pattern and any malformed entry', () => {
    const out = normalizeScheme({
      v: VERSION,
      m: '█',
      s: 'keep',
      k: 'picked',
      t: [
        ['r', 'a'.repeat(MAX_PATTERN + 1)],
        ['r'],
        ['r', ''],
        [123, 456],
        'not-a-pair',
        ['l', 'kept'],
      ],
    })
    expect(out?.targets).toEqual([{ kind: 'literal', value: 'kept' }])
  })

  it('treats an unknown target kind as a literal, never as a pattern', () => {
    // a pattern is executable; defaulting the other way would let a malformed
    // link smuggle a regex past the reader
    const out = normalizeScheme({ v: VERSION, m: '█', s: 'keep', k: 'picked', t: [['?', '.*']] })
    expect(out?.targets).toEqual([{ kind: 'literal', value: '.*' }])
  })
})

describe('JSON export', () => {
  it('round-trips through the readable form', () => {
    const input = scheme({ targets: [...patterns, ...literals], caseSensitive: true })
    expect(schemeFromJson(schemeJson(input, true))).toEqual(input)
  })

  it('honours the literals choice like the link does', () => {
    expect(schemeFromJson(schemeJson(scheme({ targets: literals }), false))?.targets).toEqual([])
  })

  it('returns null for text that is not a scheme', () => {
    expect(schemeFromJson('{')).toBeNull()
    expect(schemeFromJson('[]')).toBeNull()
    expect(schemeFromJson('"hello"')).toBeNull()
  })
})
