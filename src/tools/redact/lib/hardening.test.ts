import { describe, expect, it } from 'vitest'
import { DEFAULT_MASK } from './characters'
import { PRESETS } from './patterns'
import { findRanges, hiddenCount, MAX_MASK_UNITS, normalizeMask, redactRanges } from './redact'
import { decodeFragment, keepLiterals, MAX_FRAGMENT, normalizeScheme, VERSION, type Scheme } from './share'

const b64url = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const deflate = async (text: string) =>
  new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())

describe('presets stay linear (RDX-2)', () => {
  // [\w.+-]+@… retried the whole run at every offset: 2.8 s per edit on
  // 60K characters without an @, and four times that at double the length.
  it.each(PRESETS.map((p) => [p.label, p.value]))('%s runs fast on 60K hostile characters', (_label, value) => {
    for (const hostile of ['a'.repeat(60_000), 'a.'.repeat(30_000), `${'1'.repeat(60_000)}x`, `a${'-'.repeat(60_000)} `]) {
      const started = performance.now()
      findRanges(hostile, [{ kind: 'regex', value }])
      expect(performance.now() - started).toBeLessThan(300)
    }
  })

  it('still finds every email, including one that starts mid-word after junk', () => {
    const email = PRESETS.find((p) => p.id === 'email')!.value
    const text = 'mail dana.whitfield@example.com, a@b@c.com or x+y@mail-host.co.uk.'
    const report = findRanges(text, [{ kind: 'regex', value: email }])
    expect(report.ranges.map((r) => text.slice(r.start, r.end))).toEqual(['dana.whitfield@example.com', 'b@c.com', 'x+y@mail-host.co.uk.'])
  })
})

describe('share links are size-capped (RDX-3)', () => {
  it('refuses a fragment longer than any link the tool writes', async () => {
    expect(await decodeFragment(`#p=${'A'.repeat(MAX_FRAGMENT + 1)}`)).toBeNull()
  })

  it('stops inflating a decompression bomb instead of building a huge string', async () => {
    const bomb = JSON.stringify({ v: VERSION, m: '█', s: 'keep', k: 'all', t: [['r', 'x'.repeat(30_000_000)]] })
    const payload = b64url(await deflate(bomb))
    expect(payload.length).toBeLessThan(MAX_FRAGMENT)
    expect(await decodeFragment(`#p=${payload}`)).toBeNull()
  })
})

describe('mask characters are bounded and visible (RDX-4)', () => {
  it('refuses one giant grapheme instead of multiplying the output by it', () => {
    const giant = `a${'́'.repeat(100_000)}`
    expect(normalizeMask(giant)).toBe(DEFAULT_MASK)
    expect(redactRanges('secret', [{ start: 0, end: 6 }], { mask: giant, spaces: 'keep' })).toBe(DEFAULT_MASK.repeat(6))
    expect(normalizeScheme({ v: VERSION, m: giant, s: 'keep', k: 'all', t: [] })!.mask).toBe(DEFAULT_MASK)
  })

  it('keeps short emoji, including ZWJ sequences, up to the cap', () => {
    expect(normalizeMask('😀')).toBe('😀')
    expect(normalizeMask('👨‍👩‍👧‍👦')).toBe('👨‍👩‍👧‍👦')
    expect(normalizeMask('é')).toBe('é')
    expect('👨‍👩‍👧‍👦'.length).toBeLessThanOrEqual(MAX_MASK_UNITS)
  })

  it.each([
    ['a tag character', `█${String.fromCodePoint(0xe0041, 0xe0042)}`],
    ['a zero-width joiner after a letter', 'a‍'],
    ['a variation selector from the supplement', `█${String.fromCodePoint(0xe0100)}`],
    ['a control character', '\u0007'],
    ['a format character', '​'],
    ['a soft hyphen', '­'],
  ])('rejects %s', (_label, mask) => {
    expect(normalizeMask(mask)).toBe(DEFAULT_MASK)
  })
})

describe('the hidden count (RDX-5)', () => {
  const text = 'ab 😀 cd'
  const all = [{ start: 0, end: text.length }]

  it('counts graphemes, not UTF-16 units', () => {
    expect(hiddenCount(text, all, 'redact')).toBe(7) // a b ␠ 😀 ␠ c d
  })

  it('does not count spaces it leaves visible', () => {
    expect(hiddenCount(text, all, 'keep')).toBe(5)
    expect(hiddenCount('a\nb', [{ start: 0, end: 3 }], 'redact')).toBe(2)
  })
})

describe('applying a scheme keeps hand-picked terms (RDX-1)', () => {
  const incoming: Scheme = { mask: '▓', spaces: 'keep', scope: 'picked', caseSensitive: false, targets: [{ kind: 'regex', value: '\\d+' }] }
  const current = [
    { kind: 'literal' as const, value: 'Acme Corp' },
    { kind: 'regex' as const, value: 'old' },
    { kind: 'regex' as const, value: '\\d+' },
  ]

  it('adds the current literals to a scheme that carries none', () => {
    expect(keepLiterals(incoming, current).targets).toEqual([
      { kind: 'regex', value: '\\d+' },
      { kind: 'literal', value: 'Acme Corp' },
    ])
  })

  it('does not duplicate a literal the scheme already has', () => {
    const withIt = { ...incoming, targets: [...incoming.targets, { kind: 'literal' as const, value: 'Acme Corp' }] }
    expect(keepLiterals(withIt, current).targets).toHaveLength(2)
  })
})
