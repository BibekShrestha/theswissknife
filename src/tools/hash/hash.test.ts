import { describe, expect, it } from 'vitest'
import { compareDigest, decodeKey, digestAll, encodeDigest, hmac, hmacAll, parseBase64, parseHex, toBase64, toHex, utf8 } from './hash'

const hexOf = async (rows: Promise<{ id: string; bytes: Uint8Array }[]>) =>
  Object.fromEntries((await rows).map((row) => [row.id, toHex(row.bytes)]))

describe('digests', () => {
  it('matches FIPS 180 vectors for "abc"', async () => {
    expect(await hexOf(digestAll(utf8('abc')))).toEqual({
      'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
      'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      'SHA-384': 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
      'SHA-512': 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    })
  })

  it('hashes the empty string', async () => {
    const rows = await hexOf(digestAll(utf8('')))
    expect(rows['SHA-1']).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(rows['SHA-256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('encodes UTF-8 before hashing', async () => {
    // SHA-256 of the two bytes c3 a9 ("é")
    const rows = await hexOf(digestAll(utf8('é')))
    expect(rows['SHA-256']).toBe(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([0xc3, 0xa9])))))
  })

  it('renders hex lowercase and Base64 padded', async () => {
    const [, sha256] = await digestAll(utf8('abc'))
    expect(encodeDigest(sha256.bytes, 'hex')).toMatch(/^[0-9a-f]{64}$/)
    expect(encodeDigest(sha256.bytes, 'base64')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
  })
})

describe('HMAC (RFC 4231)', () => {
  it('test case 1', async () => {
    const key = new Uint8Array(20).fill(0x0b)
    const rows = await hexOf(hmacAll(key, utf8('Hi There')))
    expect(rows['HMAC-SHA-256']).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
    expect(rows['HMAC-SHA-384']).toBe('afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6')
    expect(rows['HMAC-SHA-512']).toBe('87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854')
  })

  it('test case 2 with a text key', async () => {
    const key = decodeKey('Jefe', 'utf8')
    expect(key.error).toBeNull()
    const mac = await hmac('SHA-256', key.bytes!, utf8('what do ya want for nothing?'))
    expect(toHex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  it('gives the same MAC for the same key in hex, Base64 and text', async () => {
    const data = utf8('what do ya want for nothing?')
    const fromHex = decodeKey('4a656665', 'hex')
    const fromB64 = decodeKey('SmVmZQ==', 'base64')
    const a = toHex(await hmac('SHA-256', fromHex.bytes!, data))
    const b = toHex(await hmac('SHA-256', fromB64.bytes!, data))
    expect(a).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    expect(b).toBe(a)
  })
})

describe('key decoding', () => {
  it('decodes hex case-insensitively and ignores whitespace', () => {
    expect(Array.from(decodeKey('0B 0b\n0B', 'hex').bytes!)).toEqual([11, 11, 11])
  })

  it('rejects malformed hex and Base64', () => {
    expect(decodeKey('abc', 'hex').error).toMatch(/hex/)
    expect(decodeKey('zz', 'hex').error).toMatch(/hex/)
    expect(decodeKey('a$b', 'base64').error).toMatch(/Base64/)
    expect(decodeKey('abcde', 'base64').error).toMatch(/Base64/)
  })

  it('accepts Base64URL and missing padding', () => {
    expect(parseBase64('-_8')).toEqual(new Uint8Array([0xfb, 0xff]))
    expect(parseBase64('+/8=')).toEqual(new Uint8Array([0xfb, 0xff]))
    expect(toBase64(parseHex('fbff')!)).toBe('+/8=')
  })
})

describe('compare', () => {
  const sha256abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

  it('finds a hex match regardless of case and surrounding whitespace', async () => {
    const rows = await digestAll(utf8('abc'))
    expect(compareDigest(`  ${sha256abc.toUpperCase()}\n`, rows)).toEqual({ status: 'match', matches: [{ id: 'SHA-256', encoding: 'hex' }] })
  })

  it('finds a Base64 match', async () => {
    const rows = await digestAll(utf8('abc'))
    expect(compareDigest('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=', rows)).toEqual({ status: 'match', matches: [{ id: 'SHA-256', encoding: 'base64' }] })
  })

  it('reads a checksum line from sha256sum or BSD shasum', async () => {
    const rows = await digestAll(utf8('abc'))
    const match = { status: 'match', matches: [{ id: 'SHA-256', encoding: 'hex' }] }
    expect(compareDigest(`${sha256abc}  release.tar.gz`, rows)).toEqual(match)
    expect(compareDigest(`${sha256abc} *release.tar.gz\n`, rows)).toEqual(match)
    expect(compareDigest(`SHA256 (release.tar.gz) = ${sha256abc}`, rows)).toEqual(match)
    expect(compareDigest(`${sha256abc.slice(0, 32)} ${sha256abc.slice(32)}`, rows)).toEqual(match)
  })

  it('checks HMAC rows too', async () => {
    const rows = [...await digestAll(utf8('Hi There')), ...await hmacAll(new Uint8Array(20).fill(0x0b), utf8('Hi There'))]
    expect(compareDigest('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7', rows)).toEqual({ status: 'match', matches: [{ id: 'HMAC-SHA-256', encoding: 'hex' }] })
  })

  it('accepts colon-separated fingerprints and a 0x prefix (HASH-2)', async () => {
    const rows = await digestAll(utf8('abc'))
    const match = { status: 'match', matches: [{ id: 'SHA-256', encoding: 'hex' }] }
    const colons = sha256abc.toUpperCase().match(/../g)!.join(':')
    expect(compareDigest(colons, rows)).toEqual(match)
    expect(compareDigest(`0x${sha256abc}`, rows)).toEqual(match)
    expect(compareDigest(`0X${sha256abc.toUpperCase()}`, rows)).toEqual(match)
    expect(compareDigest(colons.replace(/:/g, ' : '), rows)).toEqual(match)
    expect(compareDigest('ab:c:de', rows)).toEqual({ status: 'invalid' })
  })

  it('reports none, invalid and empty', async () => {
    const rows = await digestAll(utf8('abc'))
    expect(compareDigest(sha256abc.replace('b', 'c'), rows)).toEqual({ status: 'none' })
    expect(compareDigest('not a digest!', rows)).toEqual({ status: 'invalid' })
    expect(compareDigest('   ', rows)).toEqual({ status: 'empty' })
  })
})
