import { describe, expect, it, vi } from 'vitest'
import { decodeShareHash, encodeSharePayload, loadInitialState, normalize, type AppState } from './persist'
import { defaultOptions } from './types'

const state: AppState = {
  filter: '.repos[] | {name, stars} — ünïcødé ✓',
  input: '{"a": [1, 2, 3]}',
  options: { ...defaultOptions, compact: true, namedArgs: [{ kind: 'arg', name: 'x', value: 'ü' }] },
  autoRun: false,
}

function legacyPayload(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('share payload round-trip', () => {
  it('encodes gzipped and decodes back identically (unicode included)', async () => {
    const payload = await encodeSharePayload(state)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/) // url-safe, no padding
    const decoded = await decodeShareHash(`#z=${payload}`)
    expect(decoded).toEqual(state)
  })

  it('compresses repetitive state well', async () => {
    const big = { ...state, input: JSON.stringify(Array(500).fill({ name: 'repeated', value: 12345 })) }
    const payload = await encodeSharePayload(big)
    expect(payload.length).toBeLessThan(JSON.stringify(big).length / 5)
  })

  it('still decodes legacy #s= links', async () => {
    const decoded = await decodeShareHash(`#s=${legacyPayload(state)}`)
    expect(decoded).toEqual(state)
  })

  it('fills missing option keys from defaults (old links stay loadable)', async () => {
    const old = { filter: '.', input: 'null', options: { compact: true }, autoRun: true }
    const decoded = await decodeShareHash(`#s=${legacyPayload(old)}`)
    expect(decoded?.options.timeoutSec).toBe(15)
    expect(decoded?.options.compact).toBe(true)
    expect(decoded?.options.namedArgs).toEqual([])
  })

  it('returns null for corrupt or foreign fragments', async () => {
    expect(await decodeShareHash('#z=!!!not-base64!!!')).toBeNull()
    expect(await decodeShareHash(`#z=${legacyPayload(state)}`)).toBeNull() // not gzipped
    expect(await decodeShareHash('#s=aGVsbG8')).toBeNull() // not JSON
    expect(await decodeShareHash('#other=1')).toBeNull()
    expect(await decodeShareHash('')).toBeNull()
  })
})

describe('normalize', () => {
  it('rejects states without string filter/input', () => {
    expect(normalize(null)).toBeNull()
    expect(normalize({} as never)).toBeNull()
    expect(normalize({ filter: 1, input: '' } as never)).toBeNull()
  })

  it('defaults autoRun to true unless explicitly false', () => {
    expect(normalize({ filter: '.', input: '' })?.autoRun).toBe(true)
    expect(normalize({ filter: '.', input: '', autoRun: false })?.autoRun).toBe(false)
  })
})

describe('JQ-2: options from a link or storage are validated', () => {
  const withOptions = (options: unknown) => normalize({ filter: '.', input: '', options } as never)!.options

  it('replaces a namedArgs that is not a list', () => {
    expect(withOptions({ namedArgs: null }).namedArgs).toEqual([])
    expect(withOptions({ namedArgs: 'x' }).namedArgs).toEqual([])
    expect(withOptions({ positionalArgs: { 0: 1 } }).positionalArgs).toEqual([])
  })

  it('keeps only well-formed arguments', () => {
    const options = withOptions({
      namedArgs: [{ kind: 'arg', name: 'a', value: '1' }, null, { kind: 'eval', name: 'b', value: '' }, { kind: 'argjson', name: 2, value: '' }],
      positionalArgs: [{ kind: 'json', value: '[1]' }, { kind: 'string' }],
    })
    expect(options.namedArgs).toEqual([{ kind: 'arg', name: 'a', value: '1' }])
    expect(options.positionalArgs).toEqual([{ kind: 'json', value: '[1]' }])
  })

  it('only accepts a timeout the settings offer', () => {
    expect(withOptions({ timeoutSec: 0 }).timeoutSec).toBe(defaultOptions.timeoutSec)
    expect(withOptions({ timeoutSec: -5 }).timeoutSec).toBe(defaultOptions.timeoutSec)
    expect(withOptions({ timeoutSec: '60' }).timeoutSec).toBe(defaultOptions.timeoutSec)
    expect(withOptions({ timeoutSec: 60 }).timeoutSec).toBe(60)
  })

  it('checks every field against its default type and allowed values', () => {
    const options = withOptions({
      compact: 'yes',
      slurp: true,
      outputMode: 'yaml',
      indent: 3,
      extraFlags: ['-r'],
      unknown: 1,
    })
    expect(options.compact).toBe(false)
    expect(options.slurp).toBe(true)
    expect(options.outputMode).toBe('json')
    expect(options.indent).toBe(2)
    expect(options.extraFlags).toBe('')
    expect(options).not.toHaveProperty('unknown')
    expect(withOptions({ indent: 'tab' }).indent).toBe('tab')
    expect(withOptions('nope')).toEqual(defaultOptions)
  })

  it('validates what localStorage holds too', () => {
    const stored = JSON.stringify({ filter: '.x', input: '1', options: { namedArgs: null, timeoutSec: 0 } })
    vi.stubGlobal('localStorage', { getItem: () => stored })
    try {
      const state = loadInitialState()
      expect(state.filter).toBe('.x')
      expect(state.options.namedArgs).toEqual([])
      expect(state.options.timeoutSec).toBe(defaultOptions.timeoutSec)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
