import { describe, expect, it } from 'vitest'
import { decodeBase32, encodeBase32 } from './base32'
import { counterBytes, findCode, hmac, hotp, importSecret, totp, totpCounter, truncate, type Algorithm } from './otp'
import { buildOtpauth, parseOtpauth, type Account } from './uri'

const ascii = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('HOTP — RFC 4226 Appendix D', () => {
  const secret = ascii('12345678901234567890')
  // count → [HMAC-SHA-1, truncated (31-bit) decimal, HOTP]
  const vectors: [string, number, string][] = [
    ['cc93cf18508d94934c64b65d8ba7667fb7cde4b0', 1284755224, '755224'],
    ['75a48a19d4cbe100644e8ac1397eea747a2d33ab', 1094287082, '287082'],
    ['0bacb7fa082fef30782211938bc1c5e70416ff44', 137359152, '359152'],
    ['66c28227d03a2d5529262ff016a1e6ef76557ece', 1726969429, '969429'],
    ['a904c900a64b35909874b33e61c5938a8e15ed1c', 1640338314, '338314'],
    ['a37e783d7b7233c083d4f62926c7a25f238d0316', 868254676, '254676'],
    ['bc9cd28561042c83f219324d3c607256c03272ae', 1918287922, '287922'],
    ['a4fb960c0bc06e1eabb804e5b397cdc4b45596fa', 82162583, '162583'],
    ['1b3c89f65e6c9e883012052823443f048b4332db', 673399871, '399871'],
    ['1637409809a679dc698207310c8c7fc07290d9e5', 645520489, '520489'],
  ]

  it.each(vectors.map((v, i) => [i, ...v] as const))('count %i', async (count, mac, truncated, code) => {
    const key = await importSecret(secret, 'SHA1')
    const digest = await hmac(key, BigInt(count))
    expect(hex(digest)).toBe(mac)
    expect(truncate(digest)).toBe(truncated)
    expect(await hotp(key, BigInt(count), 6)).toBe(code)
  })

  it('writes the counter as 8 big-endian bytes and rejects out-of-range counters', () => {
    expect(hex(counterBytes(1n))).toBe('0000000000000001')
    expect(hex(counterBytes((1n << 64n) - 1n))).toBe('ffffffffffffffff')
    expect(() => counterBytes(-1n)).toThrow(RangeError)
    expect(() => counterBytes(1n << 64n)).toThrow(RangeError)
  })
})

describe('TOTP — RFC 6238 Appendix B (8 digits, 30 s)', () => {
  const secrets: Record<Algorithm, Uint8Array> = {
    SHA1: ascii('12345678901234567890'),
    SHA256: ascii('12345678901234567890123456789012'),
    SHA512: ascii('1234567890123456789012345678901234567890123456789012345678901234'),
  }
  const table: [number, string, Algorithm, string][] = [
    [59, '0000000000000001', 'SHA1', '94287082'],
    [59, '0000000000000001', 'SHA256', '46119246'],
    [59, '0000000000000001', 'SHA512', '90693936'],
    [1111111109, '00000000023523EC', 'SHA1', '07081804'],
    [1111111109, '00000000023523EC', 'SHA256', '68084774'],
    [1111111109, '00000000023523EC', 'SHA512', '25091201'],
    [1111111111, '00000000023523ED', 'SHA1', '14050471'],
    [1111111111, '00000000023523ED', 'SHA256', '67062674'],
    [1111111111, '00000000023523ED', 'SHA512', '99943326'],
    [1234567890, '000000000273EF07', 'SHA1', '89005924'],
    [1234567890, '000000000273EF07', 'SHA256', '91819424'],
    [1234567890, '000000000273EF07', 'SHA512', '93441116'],
    [2000000000, '0000000003F940AA', 'SHA1', '69279037'],
    [2000000000, '0000000003F940AA', 'SHA256', '90698825'],
    [2000000000, '0000000003F940AA', 'SHA512', '38618901'],
    [20000000000, '0000000027BC86AA', 'SHA1', '65353130'],
    [20000000000, '0000000027BC86AA', 'SHA256', '77737706'],
    [20000000000, '0000000027BC86AA', 'SHA512', '47863826'],
  ]

  it.each(table)('t=%i (T=%s) %s', async (time, t, algorithm, code) => {
    expect(totpCounter(time, 30)).toBe(BigInt(`0x${t}`))
    const key = await importSecret(secrets[algorithm], algorithm)
    expect(await totp(key, time, 30, 8)).toBe(code)
  })

  it('finds a code in the window around a counter, nearest offset first', async () => {
    const key = await importSecret(secrets.SHA1, 'SHA1')
    const centre = totpCounter(1111111111, 30)
    expect(await findCode(key, '07081804', centre, 1, 8)).toEqual({ counter: centre - 1n, offset: -1 })
    expect(await findCode(key, '14050471', centre, 0, 8)).toEqual({ counter: centre, offset: 0 })
    expect(await findCode(key, '89005924', centre, 2, 8)).toBeNull()
    // Counters below zero are skipped, not wrapped.
    expect(await findCode(key, '94287082', 0n, 3, 8)).toEqual({ counter: 1n, offset: 1 })
  })
})

describe('Base32', () => {
  const decoded = (s: string) => {
    const r = decodeBase32(s)
    if ('error' in r) throw new Error(r.error)
    return new TextDecoder().decode(r.bytes)
  }
  const error = (s: string) => {
    const r = decodeBase32(s)
    return 'error' in r ? r.error : null
  }

  it('decodes the RFC 4648 test vectors, padded and unpadded', () => {
    const vectors: [string, string][] = [
      ['', ''], ['f', 'MY======'], ['fo', 'MZXQ===='], ['foo', 'MZXW6==='],
      ['foob', 'MZXW6YQ='], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI======'],
    ]
    for (const [plain, encoded] of vectors.slice(1)) {
      expect(decoded(encoded)).toBe(plain)
      expect(decoded(encoded.replace(/=/g, ''))).toBe(plain)
      expect(encodeBase32(ascii(plain))).toBe(encoded.replace(/=/g, ''))
    }
  })

  it('ignores case and spaces', () => {
    expect(decoded('mzxw 6ytb oi')).toBe('foobar')
    expect(decoded('  GEZD GNBV\tGY3T QOJQ\nGEZD GNBV GY3T QOJQ  ')).toBe('12345678901234567890')
  })

  it('round-trips arbitrary bytes', () => {
    for (let n = 1; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff)
      const r = decodeBase32(encodeBase32(bytes))
      expect('bytes' in r && hex(r.bytes)).toBe(hex(bytes))
    }
  })

  it('explains what is wrong', () => {
    expect(error('')).toBe('The secret is empty')
    expect(error('   ')).toBe('The secret is empty')
    expect(error('====')).toBe('The secret is only padding (=)')
    expect(error('JBSW1')).toBe('“1” at character 5 is not Base32 (A–Z and 2–7) — Base32 has no 1; did you mean I or L?')
    expect(error('JB0W')).toContain('did you mean O?')
    expect(error('JB8W')).toContain('did you mean B?')
    expect(error('JB9W')).toBe('“9” at character 3 is not Base32 (A–Z and 2–7)')
    expect(error('jbsw y3dp ehpk 3px0')).toBe('“0” at character 16 (not counting spaces) is not Base32 (A–Z and 2–7) — Base32 has no 0; did you mean O?')
    expect(error('ab-c')).toBe('“-” at character 3 is not Base32 (A–Z and 2–7)')
    expect(error('MZ=XQ')).toBe('Padding (=) at character 3 — it may only appear at the end')
    expect(error('A')).toBe('1 characters is not a valid Base32 length — a character is missing or extra')
    expect(error('MZX')).toContain('not a valid Base32 length')
    expect(error('MZXW6Y')).toContain('not a valid Base32 length')
    expect(error('MZXQ==')).toBe('Wrong amount of padding: 2 “=” after 4 characters (padded Base32 is a multiple of 8 long)')
  })
})

describe('otpauth:// URIs', () => {
  const ok = (uri: string) => {
    const r = parseOtpauth(uri)
    if ('error' in r) throw new Error(r.error)
    return r
  }
  const error = (uri: string) => {
    const r = parseOtpauth(uri)
    return 'error' in r ? r.error : null
  }

  it('reads the Key Uri Format example with defaults', () => {
    const { account, warnings } = ok('otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example')
    expect(account).toMatchObject({ type: 'totp', name: 'alice@google.com', issuer: 'Example', algorithm: 'SHA1', digits: 6, period: 30, counter: 0n })
    expect(hex(account.secret)).toBe('48656c6c6f21deadbeef')
    expect(warnings).toEqual([])
  })

  it('reads every parameter, any case, percent-encoded labels', () => {
    const { account } = ok('OTPAUTH://TOTP/ACME%20Co%3Ajohn.doe%40email.com?SECRET=hxdm vjec jjws&issuer=ACME+Co&algorithm=sha-512&digits=8&period=60')
    expect(account).toMatchObject({ name: 'john.doe@email.com', issuer: 'ACME Co', algorithm: 'SHA512', digits: 8, period: 60 })
    const hotpUri = ok('otpauth://hotp/Bank:me?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&counter=18446744073709551615&digits=7&algorithm=SHA256')
    expect(hotpUri.account).toMatchObject({ type: 'hotp', issuer: 'Bank', name: 'me', counter: (1n << 64n) - 1n, digits: 7, algorithm: 'SHA256' })
  })

  it('takes the issuer from the label when there is no parameter, and the parameter when they differ', () => {
    expect(ok('otpauth://totp/Prefix:bob?secret=MZXW6YTB').account.issuer).toBe('Prefix')
    const both = ok('otpauth://totp/Prefix:bob?secret=MZXW6YTB&issuer=Param')
    expect(both.account.issuer).toBe('Param')
    expect(both.warnings).toEqual(['The issuer parameter (“Param”) differs from the label’s prefix (“Prefix”); the parameter is used'])
    expect(ok('otpauth://totp/bob?secret=MZXW6YTB').account).toMatchObject({ issuer: '', name: 'bob' })
  })

  it('warns about what it ignores or assumes', () => {
    expect(ok('otpauth://hotp/x?secret=MZXW6YTB').warnings).toEqual(['No counter parameter (the format requires one for HOTP) — starting at 0'])
    expect(ok('otpauth://totp/x?secret=MZXW6YTB&counter=5&image=https%3A%2F%2Fx').warnings).toEqual([
      'Ignored parameter: image',
      'counter is ignored for TOTP',
    ])
    expect(ok('otpauth://hotp/x?secret=MZXW6YTB&counter=1&period=30').warnings).toEqual(['period is ignored for HOTP'])
    expect(ok('otpauth://totp/x?secret=MZXW6YTB&secret=AAAA').warnings).toEqual(['secret appears 2 times — the first one is used'])
    expect(ok('otpauth://totp?secret=MZXW6YTB').warnings).toEqual(['The URI has no account name in its label'])
  })

  it('rejects malformed URIs with a reason', () => {
    expect(error('https://example.com')).toBe('Not an otpauth:// URI')
    expect(error('otpauth:totp/x?secret=MZXW6YTB')).toBe('Not an otpauth URI — expected otpauth://totp/… or otpauth://hotp/…')
    expect(error('otpauth://steam/x?secret=MZXW6YTB')).toBe('Unsupported type “steam” — only totp and hotp are standard')
    expect(error('otpauth:///x?secret=MZXW6YTB')).toBe('The URI has no type — expected otpauth://totp/… or otpauth://hotp/…')
    expect(error('otpauth://totp/x?issuer=a')).toBe('The URI has no secret parameter')
    expect(error('otpauth://totp/x?secret=')).toBe('secret: The secret is empty')
    expect(error('otpauth://totp/x?secret=ABC1')).toContain('secret: “1” at character 4')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&algorithm=MD5')).toBe('Unsupported algorithm “MD5” — otpauth URIs use SHA1, SHA256 or SHA512')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&digits=5')).toBe('digits must be 6, 7 or 8 — got “5”')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&digits=9')).toBe('digits must be 6, 7 or 8 — got “9”')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&digits=six')).toBe('digits must be 6, 7 or 8 — got “six”')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&period=0')).toBe('period must be a whole number of seconds, 1 or more — got “0”')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&period=-30')).toContain('got “-30”')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&period=1.5')).toContain('got “1.5”')
    expect(error('otpauth://hotp/x?secret=MZXW6YTB&counter=-1')).toBe('counter must be a whole number from 0 to 2^64 − 1 — got “-1”')
    expect(error('otpauth://hotp/x?secret=MZXW6YTB&counter=18446744073709551616')).toContain('got “18446744073709551616”')
    expect(error('otpauth://totp/a%ZZb?secret=MZXW6YTB')).toBe('The label has a broken %-escape')
    expect(error('otpauth://totp/x?secret=MZXW6YTB&issuer=%E0%A4')).toBe('The issuer parameter has a broken %-escape')
  })

  it('builds a URI that parses back to the same account', () => {
    const account: Account = { type: 'hotp', secret: ascii('12345678901234567890'), name: 'alice@example.com', issuer: 'Acme & Co', algorithm: 'SHA256', digits: 8, period: 30, counter: 42n }
    const uri = buildOtpauth(account)
    expect(uri).toBe('otpauth://hotp/Acme%20%26%20Co:alice@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme%20%26%20Co&algorithm=SHA256&digits=8&counter=42')
    expect(ok(uri).account).toEqual(account)
    const totpAccount: Account = { ...account, type: 'totp', counter: 0n, issuer: '', name: 'solo' }
    expect(buildOtpauth(totpAccount)).toBe('otpauth://totp/solo?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA256&digits=8&period=30')
    // A name that already carries the issuer prefix is not prefixed twice.
    const prefixed = ok(buildOtpauth({ ...totpAccount, issuer: 'Acme', name: 'Acme:solo' })).account
    expect(prefixed).toMatchObject({ issuer: 'Acme', name: 'solo' })
  })
})
