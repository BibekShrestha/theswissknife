import { describe, expect, it } from 'vitest'
import { decodeMigrationPayload, parseMigrationUri, type MigrationPayload } from './migration'
import { batchStatus, parseField, parseScanned } from './sources'
import { buildOtpauth, parseOtpauth } from './uri'

// ---- a tiny protobuf writer, so every payload here is built by hand ----

function varint(value: bigint | number): number[] {
  let v = BigInt.asUintN(64, BigInt(value))
  const out: number[] = []
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v) byte |= 0x80
    out.push(byte)
  } while (v)
  return out
}
const tag = (field: number, wire: number) => varint((field << 3) | wire)
const vfield = (field: number, value: bigint | number) => [...tag(field, 0), ...varint(value)]
const bfield = (field: number, bytes: Uint8Array | number[]) => [...tag(field, 2), ...varint(bytes.length), ...bytes]
const sfield = (field: number, text: string) => bfield(field, new TextEncoder().encode(text))
const ascii = (s: string) => [...new TextEncoder().encode(s)]

interface Params { secret?: number[]; name?: string; issuer?: string; algorithm?: number; digits?: number; type?: number; counter?: bigint | number }
function otpParameters(p: Params): number[] {
  return [
    ...(p.secret ? bfield(1, p.secret) : []),
    ...(p.name !== undefined ? sfield(2, p.name) : []),
    ...(p.issuer !== undefined ? sfield(3, p.issuer) : []),
    ...(p.algorithm !== undefined ? vfield(4, p.algorithm) : []),
    ...(p.digits !== undefined ? vfield(5, p.digits) : []),
    ...(p.type !== undefined ? vfield(6, p.type) : []),
    ...(p.counter !== undefined ? vfield(7, p.counter) : []),
  ]
}
function payload(accounts: Params[], batch: { version?: number; size?: number; index?: number; id?: number } = {}): Uint8Array {
  return Uint8Array.from([
    ...accounts.flatMap((a) => bfield(1, otpParameters(a))),
    ...vfield(2, batch.version ?? 1),
    ...vfield(3, batch.size ?? 1),
    ...vfield(4, batch.index ?? 0),
    ...vfield(5, batch.id ?? 0),
  ])
}
const toUri = (bytes: Uint8Array) => `otpauth-migration://offline?data=${encodeURIComponent(btoa(String.fromCharCode(...bytes)))}`

const ok = (bytes: Uint8Array): MigrationPayload => {
  const r = decodeMigrationPayload(bytes)
  if ('error' in r) throw new Error(r.error)
  return r
}
const error = (bytes: Uint8Array | number[]) => {
  const r = decodeMigrationPayload(Uint8Array.from(bytes))
  return 'error' in r ? r.error : null
}

const RFC_SECRET = ascii('12345678901234567890')

describe('otpauth-migration payloads', () => {
  it('reads several accounts and the batch fields', () => {
    const bytes = payload([
      { secret: RFC_SECRET, name: 'alice@example.com', issuer: 'Example', algorithm: 1, digits: 1, type: 2 },
      { secret: [0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6], name: 'Bank:bob', issuer: 'Bank', algorithm: 2, digits: 2, type: 1, counter: 7 },
      { secret: RFC_SECRET, name: 'ünïcødé ✓', issuer: '', algorithm: 3, digits: 1, type: 2 },
    ], { version: 1, size: 3, index: 1, id: -123456789 })
    const p = ok(bytes)
    expect(p).toMatchObject({ version: 1, batchSize: 3, batchIndex: 1, batchId: -123456789 })
    expect(p.accounts).toHaveLength(3)
    expect(p.accounts[0]).toMatchObject({ name: 'alice@example.com', issuer: 'Example', algorithm: 'SHA1', digits: '6', type: 'TOTP', notes: [] })
    expect(p.accounts[0].account).toMatchObject({ type: 'totp', algorithm: 'SHA1', digits: 6, period: 30, counter: 0n })
    expect(p.accounts[1].account).toMatchObject({ type: 'hotp', algorithm: 'SHA256', digits: 8, counter: 7n, name: 'Bank:bob' })
    expect(p.accounts[2].account).toMatchObject({ algorithm: 'SHA512', name: 'ünïcødé ✓' })
    expect([...p.accounts[1].secret]).toEqual([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6])
  })

  it('maps every enum value, defaulting the unset ones and refusing the rest', () => {
    const one = (p: Params) => ok(payload([{ secret: RFC_SECRET, name: 'x', ...p }])).accounts[0]

    const unset = one({})
    expect(unset).toMatchObject({ algorithm: 'SHA1 (unset)', digits: '6 (unset)', type: 'TOTP (unset)' })
    expect(unset.notes).toEqual(['Algorithm not set — SHA1 assumed', 'Digit count not set — 6 assumed', 'Type not set — TOTP assumed'])
    expect(unset.account).toMatchObject({ algorithm: 'SHA1', digits: 6, type: 'totp' })
    for (const [value, name] of [[1, 'SHA1'], [2, 'SHA256'], [3, 'SHA512']] as const) {
      expect(one({ algorithm: value }).account?.algorithm).toBe(name)
    }
    const md5 = one({ algorithm: 4 })
    expect(md5.algorithm).toBe('MD5')
    expect(md5.account).toBeUndefined()
    expect(md5.problem).toBe('MD5 — browsers’ WebCrypto has no HMAC-MD5 and otpauth URIs have no MD5, so no codes or URI')
    expect(one({ algorithm: 9 })).toMatchObject({ algorithm: 'unknown (9)', problem: 'Unknown algorithm value 9' })

    expect(one({ digits: 1 }).account?.digits).toBe(6)
    expect(one({ digits: 2 }).account?.digits).toBe(8)
    expect(one({ digits: 3 })).toMatchObject({ digits: 'unknown (3)', problem: 'Unknown digit-count value 3' })

    expect(one({ type: 1 }).account?.type).toBe('hotp')
    expect(one({ type: 2 }).account?.type).toBe('totp')
    expect(one({ type: 3 })).toMatchObject({ type: 'unknown (3)', problem: 'Unknown OTP type value 3' })
    // Negative enum values are 10-byte varints read as int32.
    expect(one({ type: -1 })).toMatchObject({ type: 'unknown (-1)' })

    expect(ok(payload([{ name: 'empty', type: 2 }])).accounts[0].problem).toBe('No secret')
    expect(one({ algorithm: 4, digits: 5 }).problem).toContain('; Unknown digit-count value 5')
  })

  it('reads 64-bit counters and skips fields it does not know', () => {
    const max = (1n << 64n) - 1n
    expect(ok(payload([{ secret: RFC_SECRET, type: 1, counter: max }])).accounts[0].account?.counter).toBe(max)
    const extra = Uint8Array.from([
      ...bfield(1, [...otpParameters({ secret: RFC_SECRET, type: 2 }), ...vfield(15, 3), ...tag(9, 5), 1, 2, 3, 4]),
      ...tag(12, 1), 1, 2, 3, 4, 5, 6, 7, 8,
      ...sfield(13, 'future'),
    ])
    expect(ok(extra).accounts[0].account?.type).toBe('totp')
  })

  it('reports malformed and truncated data', () => {
    const good = payload([{ secret: RFC_SECRET, name: 'x', type: 2 }])
    expect(error([])).toBeNull()
    expect(error(good.slice(0, 10))).toMatch(/^Field at byte 0 of the payload claims \d+ bytes but only 8 remain — the data is truncated$/)
    expect(error([...tag(2, 0), 0x80])).toBe('Truncated varint at byte 1 of the payload')
    expect(error([...tag(2, 0), ...Array(10).fill(0xff), 0x01])).toBe('Varint at byte 1 of the payload is longer than 10 bytes')
    expect(error([...tag(2, 0), ...Array(9).fill(0xff), 0x02])).toBe('Varint at byte 1 of the payload overflows 64 bits')
    expect(error([0x00])).toBe('Field number 0 at byte 0 of the payload — this is not protobuf data')
    expect(error([...tag(1, 7)])).toBe('Invalid wire type 7 at byte 0 of the payload')
    expect(error([...tag(1, 3)])).toBe('Groups (wire type 3) at byte 0 of the payload are not part of this format')
    expect(error(vfield(1, 5))).toBe('Field 1 of the payload is varint, expected length-delimited')
    expect(error(bfield(2, [1]))).toBe('Field 2 of the payload is length-delimited, expected varint')
    expect(error(bfield(1, [...tag(4, 2), 1, 1]))).toBe('Field 4 of the account 1 is length-delimited, expected varint')
    expect(error(bfield(1, [...tag(1, 2), 5, 1, 2]))).toBe('Field at byte 0 of the account 1 claims 5 bytes but only 2 remain — the data is truncated')
    expect(error([...tag(9, 5), 1, 2])).toBe('Truncated 32-bit field at byte 0 of the payload')
    expect(error([...tag(9, 1), 1, 2, 3])).toBe('Truncated 64-bit field at byte 0 of the payload')
  })
})

describe('otpauth-migration URIs', () => {
  const bytes = payload([{ secret: RFC_SECRET, name: 'alice', issuer: 'Example', algorithm: 1, digits: 1, type: 2 }], { size: 2, index: 0, id: 77 })

  it('decodes the data parameter, however its Base64 arrived', () => {
    // An unknown trailing field whose bytes put +, / and = into the Base64.
    const align = Array((3 - ((bytes.length + 2) % 3)) % 3).fill(0)
    const tricky = Uint8Array.from([...bytes, ...bfield(14, [...align, 0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff, 0xff])])
    const b64 = btoa(String.fromCharCode(...tricky))
    expect(b64).toMatch(/\+/)
    expect(b64).toMatch(/\//)
    expect(b64).toMatch(/=$/)
    for (const data of [
      encodeURIComponent(b64),
      b64, // raw, with + / =
      b64.replace(/\+/g, ' '), // a form decoder turned + into spaces
      b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), // base64url
    ]) {
      const r = parseMigrationUri(`otpauth-migration://offline?data=${data}`)
      expect('error' in r ? r.error : r.accounts[0].name).toBe('alice')
    }
    const r = parseMigrationUri(`OTPAUTH-MIGRATION://OFFLINE?foo=1&data=${encodeURIComponent(b64)}`)
    expect('accounts' in r && r.batchId).toBe(77)
  })

  it('rejects malformed URIs with a reason', () => {
    const error = (s: string) => {
      const r = parseMigrationUri(s)
      return 'error' in r ? r.error : null
    }
    expect(error('otpauth://totp/x')).toBe('Not an otpauth-migration:// URI')
    expect(error('otpauth-migration://online?data=AA')).toBe('Expected otpauth-migration://offline?data=… — got “online” after //')
    expect(error('otpauth-migration://offline')).toBe('The migration URI has no data parameter')
    expect(error('otpauth-migration://offline?data=')).toBe('The data parameter is empty')
    expect(error('otpauth-migration://offline?data=%ZZ')).toBe('The data parameter has a broken %-escape')
    expect(error('otpauth-migration://offline?data=ab*cd')).toBe('The data parameter is not valid Base64')
    expect(error('otpauth-migration://offline?data=abcde')).toBe('The data parameter is not valid Base64')
    expect(error('otpauth-migration://offline?data=CgA')).toBeNull()
    expect(error('otpauth-migration://offline?data=CgU')).toBe('Field at byte 0 of the payload claims 5 bytes but only 0 remain — the data is truncated')
  })

  it('rebuilds each account as an otpauth:// URI that gives the same codes', () => {
    const r = parseMigrationUri(toUri(bytes))
    if ('error' in r) throw new Error(r.error)
    const uri = buildOtpauth(r.accounts[0].account!)
    expect(uri).toBe('otpauth://totp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&algorithm=SHA1&digits=6&period=30')
    const back = parseOtpauth(uri)
    expect('account' in back && back.account).toEqual(r.accounts[0].account)
  })
})

describe('sources', () => {
  it('reads the field as one Base32 secret, or as whitespace-separated URIs', () => {
    expect(parseField('  ')).toEqual([])
    expect(parseField('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toMatchObject([{ kind: 'secret', normalized: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }])
    expect(parseField('not base32!')).toMatchObject([{ kind: 'invalid', origin: 'Pasted secret' }])
    const uris = parseField(`otpauth://totp/a?secret=MZXW6YTB\n${toUri(payload([{ secret: RFC_SECRET }]))}\nhello`)
    expect(uris.map((s) => [s.kind, s.origin])).toEqual([
      ['otpauth', 'Pasted URI 1'],
      ['migration', 'Pasted URI 2'],
      ['invalid', 'Pasted URI 3'],
    ])
  })

  it('only takes otpauth payloads from QR codes', () => {
    expect(parseScanned('https://example.com', 'a.png')).toEqual({ kind: 'invalid', origin: 'a.png', error: 'This QR code is not an otpauth:// or otpauth-migration:// link' })
    expect(parseScanned('otpauth://totp/a?secret=MZXW6YTB', 'a.png').kind).toBe('otpauth')
  })

  it('says which QR codes of a multi-code export are missing', () => {
    const part = (index: number, size: number, id: number) => ok(payload([{ secret: RFC_SECRET }], { size, index, id }))
    expect(batchStatus([part(0, 1, 1)])).toEqual([])
    expect(batchStatus([part(0, 3, 5), part(2, 3, 5), part(2, 3, 5), part(1, 2, 9), part(4, 3, 5)])).toEqual([
      { batchId: 5, size: 3, loaded: [1, 3], missing: [2], repeated: [3], outOfRange: [4] },
      { batchId: 9, size: 2, loaded: [2], missing: [1], repeated: [], outOfRange: [] },
    ])
  })
})
