import { describe, expect, it } from 'vitest'
import {
  b64urlDecodeBytes,
  b64urlDecodeString,
  b64urlEncodeBytes,
  b64urlEncodeString,
  describeTimeClaims,
  parseJwt,
} from './jwt'
import { duplicateKeys, minifyJson, prettyJson, setTopLevel } from './jsontext'
import {
  declaredAlg,
  derivePublicPem,
  generateKeyMaterial,
  hasKeyMaterial,
  headerAlgProblem,
  signJws,
  verifyJws,
  type Alg,
} from './crypto'

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

describe('generateKeyMaterial (generator mode)', () => {
  const header = (alg: string) => JSON.stringify({ alg, typ: 'JWT' })
  const payload = JSON.stringify({ sub: 'gen', iat: 1516239022 })

  it('HS256 yields a base64url secret of the hash width that round-trips', async () => {
    const key = await generateKeyMaterial('HS256')
    if (key.kind !== 'secret') throw new Error('expected secret')
    expect(key.secret).toMatch(/^[A-Za-z0-9_-]+$/)
    const material = { text: key.secret, secretIsB64: true }
    const token = await signJws('HS256', header('HS256'), payload, material)
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(await verifyJws('HS256', p.signingInput, p.signatureB64, material)).toEqual({ state: 'valid' })
  })

  it.each(['RS256', 'PS256', 'ES256', 'EdDSA'] as Alg[])(
    '%s generates a PEM pair that signs and verifies',
    async (alg) => {
      const key = await generateKeyMaterial(alg)
      if (key.kind !== 'pair') throw new Error('expected pair')
      expect(key.privatePem).toContain('BEGIN PRIVATE KEY')
      expect(key.publicPem).toContain('BEGIN PUBLIC KEY')
      const token = await signJws(alg, header(alg), payload, { text: key.privatePem, secretIsB64: false })
      const p = parseJwt(token)
      if ('error' in p) throw new Error(p.error)
      expect(
        await verifyJws(alg, p.signingInput, p.signatureB64, { text: key.publicPem, secretIsB64: false }),
      ).toEqual({ state: 'valid' })
    },
    20_000,
  )
})

// ---- regression tests from the bug hunt ---------------------------------

const enc = (o: unknown) => b64urlEncodeString(typeof o === 'string' ? o : JSON.stringify(o))

describe('JWT-1: the token declares its own alg', () => {
  it('accepts only exact, supported alg names', () => {
    expect(declaredAlg({ alg: 'HS256' })).toEqual({ ok: true, alg: 'HS256' })
    for (const alg of ['none', 'hs256', 'ES256K', 'RS1', 42, undefined]) {
      expect(declaredAlg({ alg }).ok).toBe(false)
    }
    expect(declaredAlg({ alg: 'none' })).toMatchObject({ ok: false, reason: expect.stringContaining('none') })
    expect(declaredAlg({ alg: 'hs256' })).toMatchObject({ ok: false, reason: expect.stringContaining('HS256') })
  })
})

describe('JWT-2: time claims out of Date range', () => {
  it('reports out of range instead of throwing', () => {
    const claims = describeTimeClaims({ exp: 9e12, iat: -9e12, nbf: 8.64e12 }, 1_700_000_000_000)
    const byName = Object.fromEntries(claims.map((c) => [c.claim, c]))
    expect(byName.exp.iso).toBe('out of range')
    expect(byName.iat.iso).toBe('out of range')
    expect(byName.nbf.iso).toBe('+275760-09-13T00:00:00.000Z')
    expect(byName.exp.problem).toBe(false)
  })
})

describe('JWT-3: header and payload must be JSON objects', () => {
  it.each(['null', '[1,2]', '5', '"s"', 'true'])('rejects %s', (json) => {
    expect(parseJwt(`${enc({ alg: 'HS256' })}.${enc(json)}.sig`)).toEqual({ error: 'Payload must be a JSON object.' })
    expect(parseJwt(`${enc(json)}.${enc({})}.sig`)).toEqual({ error: 'Header must be a JSON object.' })
  })
})

describe('JWT-4: decoded JSON stays faithful', () => {
  const raw = '{"id":12345678901234567890,"f":1.0,"s":"\\u0041","a":[],"o":{}}'

  it('pretty-prints without touching values', () => {
    expect(prettyJson(raw)).toBe(
      '{\n  "id": 12345678901234567890,\n  "f": 1.0,\n  "s": "\\u0041",\n  "a": [],\n  "o": {}\n}',
    )
    expect(prettyJson('{"alg":"HS256","typ":"JWT"}')).toBe(JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2))
    expect(minifyJson(prettyJson(raw))).toBe(raw)
    expect(() => prettyJson('{oops')).toThrow()
  })

  it('finds duplicate keys at any depth', () => {
    expect(duplicateKeys('{"a":1,"b":{"a":2,"c":1,"c":2},"a":3}')).toEqual(['c', 'a'])
    expect(duplicateKeys('[{"a":1},{"a":2}]')).toEqual([])
    expect(duplicateKeys('{"\\u0061":1,"a":2}')).toEqual(['a'])
  })

  it('reports duplicate keys from parseJwt', () => {
    const p = parseJwt(`${enc({ alg: 'HS256' })}.${enc('{"admin":false,"admin":true}')}.sig`)
    if ('error' in p) throw new Error(p.error)
    expect(p.payloadDuplicates).toEqual(['admin'])
    expect(p.headerDuplicates).toEqual([])
  })

  it('sets a top-level member without changing anything else', () => {
    expect(setTopLevel('{"alg":"HS256","n":12345678901234567890}', 'alg', '"RS256"')).toBe(
      '{\n  "alg": "RS256",\n  "n": 12345678901234567890\n}',
    )
    expect(setTopLevel('{"n":12345678901234567890}', 'iat', '1')).toBe('{\n  "n": 12345678901234567890,\n  "iat": 1\n}')
    expect(setTopLevel('{}', 'alg', '"HS256"')).toBe('{\n  "alg": "HS256"\n}')
    expect(setTopLevel('{"alg":{"x":[1,2]},"b":1}', 'alg', '"ES256"')).toBe('{\n  "alg": "ES256",\n  "b": 1\n}')
    expect(() => setTopLevel('[1]', 'alg', '"HS256"')).toThrow()
  })
})

describe('JWT-8: strict base64url (RFC 7515)', () => {
  const sig = SAMPLE.split('.')[2]

  it('rejects non-canonical trailing bits, padding, the base64 alphabet and spaces', () => {
    expect(() => b64urlDecodeBytes(sig)).not.toThrow()
    expect(() => b64urlDecodeBytes(sig.slice(0, -1) + 'd')).toThrow()
    expect(() => b64urlDecodeBytes(sig + '=')).toThrow()
    expect(() => b64urlDecodeBytes(sig.replace('_', '/'))).toThrow()
    expect(() => b64urlDecodeBytes(sig.slice(0, 10) + ' ' + sig.slice(10))).toThrow()
    expect(() => b64urlDecodeBytes('A')).toThrow()
  })

  it('does not verify a signature with an altered last character', async () => {
    const key = { text: 'your-256-bit-secret', secretIsB64: false }
    const [h, p] = SAMPLE.split('.')
    const r = await verifyJws('HS256', `${h}.${p}`, sig.slice(0, -1) + 'd', key)
    expect(r.state).not.toBe('valid')
    expect(parseJwt(`${h}.${p}.${sig}=`)).toEqual({ error: 'Signature is not valid base64url.' })
  })

  it('still accepts padded or standard Base64 for an HMAC secret marked base64url', async () => {
    const token = await signJws('HS256', '{"alg":"HS256"}', '{}', { text: 'c2VjcmV0+/8=', secretIsB64: true })
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(await verifyJws('HS256', p.signingInput, p.signatureB64, { text: 'c2VjcmV0-_8', secretIsB64: true })).toEqual({ state: 'valid' })
  })
})

describe('JWT-9: RFC 7519 time semantics', () => {
  const now = 1_700_000_000_000
  it('treats exp == now as expired and nbf == now as valid', () => {
    expect(describeTimeClaims({ exp: now / 1000 }, now)[0].problem).toBe(true)
    expect(describeTimeClaims({ nbf: now / 1000 }, now)[0].problem).toBe(false)
    expect(describeTimeClaims({ exp: now / 1000 - 0.4 }, now)[0].problem).toBe(true)
  })

  it('floors relative times', () => {
    expect(describeTimeClaims({ exp: now / 1000 + 1.5 * 86400 }, now)[0].relative).toBe('in 1d')
    expect(describeTimeClaims({ exp: now / 1000 - 119 }, now)[0].relative).toBe('1m ago')
  })
})

describe('JWT-10: key presence is judged the same way everywhere', () => {
  it('uses an HMAC secret as typed, but trims PEM/JWK text', () => {
    expect(hasKeyMaterial('HS256', '   ')).toBe(true)
    expect(hasKeyMaterial('HS256', '')).toBe(false)
    expect(hasKeyMaterial('RS256', '  \n ')).toBe(false)
    expect(hasKeyMaterial('RS256', '-----BEGIN')).toBe(true)
  })
})

describe('JWT-5: public key derived from the private key', () => {
  it.each(['RS256', 'PS384', 'ES256', 'EdDSA'] as Alg[])('%s derives a public key that verifies', async (alg) => {
    const key = await generateKeyMaterial(alg)
    if (key.kind !== 'pair') throw new Error('expected pair')
    const pub = await derivePublicPem(alg, key.privatePem)
    expect(pub).toBe(key.publicPem)
    const token = await signJws(alg, JSON.stringify({ alg }), '{}', { text: key.privatePem, secretIsB64: false })
    const p = parseJwt(token)
    if ('error' in p) throw new Error(p.error)
    expect(await verifyJws(alg, p.signingInput, p.signatureB64, { text: pub, secretIsB64: false })).toEqual({ state: 'valid' })
  }, 20_000)

  it('accepts a private JWK and fails for a key of another curve', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey))
    expect(await derivePublicPem('ES256', jwk)).toContain('BEGIN PUBLIC KEY')
    await expect(derivePublicPem('ES384', jwk)).rejects.toThrow()
  })
})

describe('JWT-6: header alg must match the signing alg', () => {
  it('names the mismatch', () => {
    expect(headerAlgProblem({ alg: 'HS256' }, 'HS256')).toBeNull()
    expect(headerAlgProblem({ alg: 'RS256' }, 'HS256')).toContain('RS256')
    expect(headerAlgProblem({}, 'HS256')).toContain('"alg"')
  })
})
