import { describe, expect, it } from 'vitest'
import { decodeShareHash, encodeSharePayload, normalize, type AppState } from './persist'
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
