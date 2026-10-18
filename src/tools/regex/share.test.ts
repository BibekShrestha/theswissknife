import { describe, expect, it } from 'vitest'
import { decodeFragment, encodeState, MAX_CASES, MAX_PATTERN, MAX_SUBJECT, normalizeFlags, normalizeState, toWire, VERSION, type LabState } from './share'

const state = (over: Partial<LabState> = {}): LabState => ({
  pattern: '(?<word>\\p{Lu}\\p{Ll}+)',
  flags: 'gu',
  operation: 'replace',
  replacement: '[$<word>]',
  subject: 'Hello World — 😀 and a lone \ud83d half',
  cases: [
    { text: 'Hello', expect: 'match', full: true },
    { text: 'hello', expect: 'no-match', full: false },
  ],
  ...over,
})

const roundTrip = async (input: LabState, include = { subject: true, cases: true }) =>
  decodeFragment(`#r=${await encodeState(input, include)}`)

async function fragmentFor(raw: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(raw)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return `#r=${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

describe('share links', () => {
  it('round-trips everything when the sharer opts in, lone surrogates included', async () => {
    expect(await roundTrip(state())).toEqual(state())
  })

  it('leaves the subject and the cases out unless asked', async () => {
    const decoded = await roundTrip(state(), { subject: false, cases: false })
    expect(decoded).toEqual({ pattern: state().pattern, flags: 'gu', operation: 'replace', replacement: '[$<word>]' })
    expect(toWire(state(), { subject: false, cases: true })).not.toHaveProperty('s')
    expect(toWire(state(), { subject: true, cases: false })).not.toHaveProperty('t')
  })

  it('round-trips match mode, empty pattern and no replacement', async () => {
    const input: LabState = { pattern: '', flags: '', operation: 'match', replacement: '' }
    expect(await roundTrip(input)).toEqual(input)
  })

  it('produces a URL-safe payload', async () => {
    expect(await encodeState(state(), { subject: true, cases: true })).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('normalising what arrives from a link', () => {
  it('whitelists, dedupes and orders flags; u wins over v', () => {
    expect(normalizeFlags('yxggu<script>')).toBe('gisuy')
    expect(normalizeFlags('yxggu')).toBe('guy')
    expect(normalizeFlags('vu')).toBe('u')
    expect(normalizeFlags('vdi')).toBe('div')
    expect(normalizeFlags(42)).toBe('')
  })

  it('rejects payloads that are not ours', () => {
    for (const raw of [null, 7, 'x', [], {}, { v: 2, p: 'a', f: '' }, { v: VERSION, p: 5 }, { v: VERSION, p: 'a'.repeat(MAX_PATTERN + 1) }]) {
      expect(normalizeState(raw)).toBeNull()
    }
  })

  it('drops oversized and mistyped optional fields', () => {
    const result = normalizeState({ v: VERSION, p: 'a', f: 'g', o: 'zap', r: { evil: 1 }, s: 'x'.repeat(MAX_SUBJECT + 1), t: 'nope' })
    expect(result).toEqual({ pattern: 'a', flags: 'g', operation: 'match', replacement: '' })
  })

  it('caps the case list and keeps each case to one line', () => {
    const t = [...Array.from({ length: MAX_CASES + 50 }, (_, i) => [`case ${i}`, i % 2, 0]), ['two\nlines', 1, 1]]
    const result = normalizeState({ v: VERSION, p: 'a', f: '', t })
    expect(result?.cases).toHaveLength(MAX_CASES)
    const smuggled = normalizeState({ v: VERSION, p: 'a', f: '', t: [['two\nlines', 1, 1], [5, 1, 1], 'junk'] })
    expect(smuggled?.cases).toEqual([{ text: 'two', expect: 'match', full: true }])
  })

  it('ignores broken, truncated and foreign fragments', async () => {
    expect(await decodeFragment('')).toBeNull()
    expect(await decodeFragment('#p=abc')).toBeNull()
    expect(await decodeFragment('#r=!!!')).toBeNull()
    expect(await decodeFragment('#r=AAAA')).toBeNull()
    const good = await encodeState(state(), { subject: true, cases: true })
    expect(await decodeFragment(`#r=${good.slice(0, good.length / 2)}`)).toBeNull()
  })

  it('normalises a hand-made link', async () => {
    const hash = await fragmentFor({ v: VERSION, p: '\\d+', f: 'gggq', s: 'ok', extra: 'ignored' })
    expect(await decodeFragment(hash)).toEqual({ pattern: '\\d+', flags: 'g', operation: 'match', replacement: '', subject: 'ok' })
  })

  it('refuses a payload that inflates past the cap (a zip bomb)', async () => {
    const hash = await fragmentFor({ v: VERSION, p: 'a', f: '', s: 'a'.repeat(5_000_000) })
    expect(hash.length).toBeLessThan(20_000)
    expect(await decodeFragment(hash)).toBeNull()
  })
})
