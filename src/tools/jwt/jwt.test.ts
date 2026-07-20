import { describe, expect, it } from 'vitest'
import {
  b64urlDecodeString,
  b64urlEncodeBytes,
  b64urlEncodeString,
  describeTimeClaims,
  parseJwt,
} from './jwt'
import { signJws, verifyJws } from './crypto'

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('base64url', () => {
  it('round-trips unicode', () => {
    const s = 'héllo ✓ {"a":1}'
    expect(b64urlDecodeString(b64urlEncodeString(s))).toBe(s)
  })

  it('produces url-safe unpadded output', () => {
    const enc = b64urlEncodeBytes(new Uint8Array([251, 255, 190, 62]))
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('parseJwt', () => {
  it('decodes the jwt.io sample', () => {
    const p = parseJwt(SAMPLE)
    if ('error' in p) throw new Error(p.error)
    expect(p.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(p.payload).toMatchObject({ sub: '1234567890', name: 'John Doe' })
    expect(p.signingInput).toBe(SAMPLE.slice(0, SAMPLE.lastIndexOf('.')))
  })

  it('reports structural problems', () => {
    expect(parseJwt('a.b')).toMatchObject({ error: expect.stringContaining('3 dot-separated') })
    expect(parseJwt('!!.e30.sig')).toMatchObject({ error: expect.stringContaining('base64url') })
    expect(parseJwt(`${b64urlEncodeString('not json')}.e30.sig`)).toMatchObject({
      error: expect.stringContaining('JSON'),
    })
  })
})

describe('describeTimeClaims', () => {
  it('flags expired tokens and future nbf', () => {
    const now = 1_700_000_000_000
    const claims = describeTimeClaims(
      { exp: 1_600_000_000, nbf: 1_800_000_000, iat: 1_500_000_000 },
      now,
    )
    const byName = Object.fromEntries(claims.map((c) => [c.claim, c]))
    expect(byName.exp.problem).toBe(true)
    expect(byName.nbf.problem).toBe(true)
    expect(byName.iat.problem).toBe(false)
    expect(byName.exp.relative).toContain('ago')
  })
})

describe('sign + verify round-trips (WebCrypto)', () => {
  const header = (alg: string) => JSON.stringify({ alg, typ: 'JWT' })
  const payload = JSON.stringify({ sub: 'tester', iat: 1516239022 })

  it('HS256 signs the jwt.io sample identically and verifies', async () => {
    const key = { text: 'your-256-bit-secret', secretIsB64: false }
    const token = await signJws('HS256', '{"alg":"HS256","typ":"JWT"}',
      '{"sub":"1234567890","name":"John Doe","iat":1516239022}', key)
    expect(token).toBe(SAMPLE)
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(await verifyJws('HS256', p.signingInput, p.signatureB64, key)).toEqual({ state: 'valid' })
  })

  it('HS256 rejects a tampered payload', async () => {
    const key = { text: 'your-256-bit-secret', secretIsB64: false }
    const p = parseJwt(SAMPLE)
    if ('error' in p) throw new Error(p.error)
    const tampered = `${p.signingInput.split('.')[0]}.${b64urlEncodeString('{"sub":"evil"}')}`
    expect(await verifyJws('HS256', tampered, p.signatureB64, key)).toEqual({ state: 'invalid' })
  })

  async function pemFromKey(key: CryptoKey, format: 'spki' | 'pkcs8'): Promise<string> {
    const der = new Uint8Array(await crypto.subtle.exportKey(format, key))
    let bin = ''
    for (const b of der) bin += String.fromCharCode(b)
    const label = format === 'spki' ? 'PUBLIC KEY' : 'PRIVATE KEY'
    return `-----BEGIN ${label}-----\n${btoa(bin)}\n-----END ${label}-----`
  }

  it('RS256 signs with PEM private key and verifies with PEM public key', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
      true,
      ['sign', 'verify'],
    )
    const priv = { text: await pemFromKey(pair.privateKey, 'pkcs8'), secretIsB64: false }
    const pub = { text: await pemFromKey(pair.publicKey, 'spki'), secretIsB64: false }
    const token = await signJws('RS256', header('RS256'), payload, priv)
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(await verifyJws('RS256', p.signingInput, p.signatureB64, pub)).toEqual({ state: 'valid' })
    expect(await verifyJws('RS256', p.signingInput + 'x', p.signatureB64, pub)).toEqual({ state: 'invalid' })
  })

  it('ES256 signs and verifies via JWK keys', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    const privJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
    const pubJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey))
    const token = await signJws('ES256', header('ES256'), payload, { text: privJwk, secretIsB64: false })
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(
      await verifyJws('ES256', p.signingInput, p.signatureB64, { text: pubJwk, secretIsB64: false }),
    ).toEqual({ state: 'valid' })
  })

  it('surfaces key errors instead of throwing', async () => {
    const r = await verifyJws('RS256', 'a.b', 'c', { text: 'garbage', secretIsB64: false })
    expect(r.state).toBe('error')
  })
})
