import { describe, expect, it } from 'vitest'
import { createUlidGenerator, encodeUlid, parseUlid } from './ulid'
import {
  clockSequence, createV7Generator, formatUuid, gregorianIso, inspectId, inspectLines, nodeOf, parseUuid,
  toBase64Url, uuidV4, v1Timestamp, v6Timestamp, v7Timestamp, variantOf, versionOf, type Inspection,
} from './uuid'

const ok = (raw: string) => {
  const result = inspectId(raw)
  if ('error' in result) throw new Error(result.error)
  return result as Inspection
}
const field = (result: Inspection, label: string) => result.fields.find((item) => item.label === label)
const bytesOf = (raw: string) => parseUuid(raw).bytes!

describe('RFC 9562 Appendix A test vectors', () => {
  it('v1 (A.1): 2022-02-22T19:22:22Z, clock sequence 0x33C8, random node', () => {
    const bytes = bytesOf('C232AB00-9414-11EC-B3C8-9F6BDECED846')
    expect(versionOf(bytes)).toBe(1)
    expect(variantOf(bytes)).toBe('RFC 9562')
    expect(v1Timestamp(bytes)).toBe(0x1EC9414C232AB00n)
    expect(gregorianIso(v1Timestamp(bytes))).toBe('2022-02-22T19:22:22.0000000Z')
    expect(clockSequence(bytes)).toBe(0x33C8)
    expect(nodeOf(bytes)).toEqual({ hex: '9f:6b:de:ce:d8:46', random: true })
    const result = ok('C232AB00-9414-11EC-B3C8-9F6BDECED846')
    expect(result.summary).toBe('UUID v1 · Gregorian time-based')
    expect(field(result, 'Node')?.note).toMatch(/random node/)
  })

  it('v6 (A.5): same instant as the v1 vector, fields reordered', () => {
    const bytes = bytesOf('1EC9414C-232A-6B00-B3C8-9F6BDECED846')
    expect(versionOf(bytes)).toBe(6)
    expect(v6Timestamp(bytes)).toBe(0x1EC9414C232AB00n)
    expect(field(ok('1EC9414C-232A-6B00-B3C8-9F6BDECED846'), 'Timestamp')?.value).toBe('2022-02-22T19:22:22.0000000Z')
    expect(clockSequence(bytes)).toBe(0x33C8)
  })

  it('v7 (A.6): Unix ms 0x017F22E279B0', () => {
    const bytes = bytesOf('017F22E2-79B0-7CC3-98C4-DC0C0C07398F')
    expect(versionOf(bytes)).toBe(7)
    expect(v7Timestamp(bytes)).toBe(0x017F22E279B0)
    expect(field(ok('017F22E2-79B0-7CC3-98C4-DC0C0C07398F'), 'Timestamp')?.value).toBe('2022-02-22T19:22:22.000Z')
  })

  it.each([
    ['5df41881-3aed-3515-88a7-2f4a814cf09e', 3],
    ['919108f7-52d1-4320-9bac-f847db4148a8', 4],
    ['2ed6657d-e927-568b-95e1-2665a8aea6a2', 5],
    ['2489E9AD-2EE2-8E00-8EC9-32D5F69181C0', 8],
  ])('detects the version of %s as v%i', (raw, version) => {
    expect(field(ok(raw), 'Version')?.value).toBe(String(version))
  })

  it('keeps sub-millisecond precision and handles pre-1970 timestamps', () => {
    expect(gregorianIso(122_192_928_000_000_001n)).toBe('1970-01-01T00:00:00.0000001Z')
    expect(gregorianIso(0n)).toBe('1582-10-15T00:00:00.0000000Z')
  })
})

describe('variants and special values', () => {
  it.each([
    ['00000000-0000-0000-7000-000000000001', 'NCS'],
    ['00000000-0000-0000-8000-000000000001', 'RFC 9562'],
    ['00000000-0000-0000-b000-000000000001', 'RFC 9562'],
    ['00000000-0000-0000-c000-000000000001', 'Microsoft'],
    ['00000000-0000-0000-e000-000000000001', 'Future'],
  ])('%s is %s', (raw, variant) => {
    expect(variantOf(bytesOf(raw))).toBe(variant)
  })

  it('names the nil and max UUIDs', () => {
    expect(ok('00000000-0000-0000-0000-000000000000').summary).toBe('Nil UUID')
    expect(ok('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF').summary).toBe('Max UUID')
  })

  it('does not read a version out of a non-RFC variant', () => {
    expect(field(ok('919108f7-52d1-4320-cbac-f847db4148a8'), 'Version')).toBeUndefined()
  })
})

describe('input forms', () => {
  const canonical = '919108f7-52d1-4320-9bac-f847db4148a8'
  it.each([
    canonical,
    canonical.toUpperCase(),
    `{${canonical}}`,
    `urn:uuid:${canonical}`,
    `URN:UUID:${canonical.toUpperCase()}`,
    canonical.replaceAll('-', ''),
    `  ${canonical}  `,
  ])('accepts %s', (raw) => {
    expect(formatUuid(bytesOf(raw))).toBe(canonical)
  })

  it.each([
    ['919108f7-52d1-4320-9bac-f847db4148a', /32 hex digits/],
    ['919108f752d1-4320-9bac-f847db4148a8-', /Expected '-'/],
    ['919108g7-52d1-4320-9bac-f847db4148a8', /'g' is not a hex digit/],
    ['{919108f7-52d1-4320-9bac-f847db4148a8', /Unbalanced/],
  ])('rejects %s', (raw, message) => {
    expect(parseUuid(raw).error).toMatch(message)
  })

  it.each([
    '-aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee-',
    'aaaaaaaa-bbbb-cccc-dddd--eeeeeeeeeee',
    '{-aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}',
    'urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee-',
    'aaaaaaaabbbbccccdddd-eeeeeeeeeeee',
    'aaaaaaaabbbbccccddddeeeeeeeeeee-',
  ])('rejects stray hyphens in %s instead of decoding shifted bytes', (raw) => {
    expect(parseUuid(raw).bytes).toBeNull()
    expect('error' in inspectId(raw)).toBe(true)
  })

  it('reports errors per line and skips blank lines', () => {
    const results = inspectLines(`${canonical}\n\nnope\n01ARZ3NDEKTSV4RRFFQ69G5FAV`)
    expect(results.map((result) => result.line)).toEqual([1, 3, 4])
    expect('error' in results[1]).toBe(true)
    expect('error' in results[2]).toBe(false)
  })
})

describe('ULID', () => {
  it('decodes the spec README timestamp example', () => {
    const result = ok('01ARYZ6S41TSV4RRFFQ69G5FAV')
    expect(result.kind).toBe('ULID')
    expect(field(result, 'Timestamp')?.note).toBe('1469918176385 ms since the Unix epoch')
    expect(field(result, 'Timestamp')?.value).toBe('2016-07-30T22:36:16.385Z')
  })

  it('is case-insensitive and maps I/L to 1, O to 0', () => {
    const canonical = encodeUlid(parseUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV').bytes!)
    expect(canonical).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV')
    expect(encodeUlid(parseUlid('01arz3ndektsv4rrffq69g5fav').bytes!)).toBe(canonical)
    expect(encodeUlid(parseUlid('OIARZ3NDEKTSV4RRFFQ69G5FAV').bytes!)).toBe(canonical)
    expect(encodeUlid(parseUlid('0LARZ3NDEKTSV4RRFFQ69G5FAV').bytes!)).toBe(canonical)
  })

  it('accepts the max ULID and rejects anything above it', () => {
    expect(parseUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ').bytes?.every((byte) => byte === 0xff)).toBe(true)
    expect(parseUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ').error).toMatch(/overflows/)
  })

  it('rejects U and other non-Crockford characters', () => {
    expect(parseUlid('01ARZ3NDEKTSV4RRFFQ69G5FAU').error).toMatch(/'U' at position 26/)
    expect(parseUlid('01ARZ3NDEKTSV4RRFFQ69G5FA*').error).toMatch(/not a Crockford/)
  })
})

describe('conversions', () => {
  it('round-trips UUID ⇄ ULID over the same 128 bits', () => {
    for (let i = 0; i < 50; i++) {
      const bytes = uuidV4()
      const ulid = encodeUlid(bytes)
      expect(formatUuid(parseUlid(ulid).bytes!)).toBe(formatUuid(bytes))
    }
    expect(encodeUlid(bytesOf('00000000-0000-0000-0000-000000000000'))).toBe('00000000000000000000000000')
    expect(encodeUlid(bytesOf('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'))).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')
  })

  it('a v7 UUID and its ULID form carry the same millisecond', () => {
    const forms = ok('017F22E2-79B0-7CC3-98C4-DC0C0C07398F').forms
    const ulid = forms.find((item) => item.label === 'ULID')!.value
    expect(field(ok(ulid), 'Timestamp')?.value).toBe('2022-02-22T19:22:22.000Z')
  })

  it('writes base64url without padding', () => {
    expect(toBase64Url(new Uint8Array(16).fill(0xff))).toBe('_____________________w')
    expect(toBase64Url(bytesOf('919108f7-52d1-4320-9bac-f847db4148a8'))).toHaveLength(22)
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  })

  it('formats with case and hyphen options', () => {
    const bytes = bytesOf('919108f7-52d1-4320-9bac-f847db4148a8')
    expect(formatUuid(bytes, { upper: true, hyphens: false })).toBe('919108F752D143209BACF847DB4148A8')
  })
})

describe('generation', () => {
  it('stamps v4 version and variant', () => {
    for (let i = 0; i < 100; i++) {
      const bytes = uuidV4()
      expect(versionOf(bytes)).toBe(4)
      expect(variantOf(bytes)).toBe('RFC 9562')
    }
  })

  it('v7 batches in one millisecond sort in generation order', () => {
    const next = createV7Generator(undefined, () => 1_700_000_000_000)
    const batch = Array.from({ length: 1000 }, () => formatUuid(next()))
    expect([...batch].sort()).toEqual(batch)
    expect(new Set(batch).size).toBe(1000)
    const first = bytesOf(batch[0])
    expect(versionOf(first)).toBe(7)
    expect(variantOf(first)).toBe('RFC 9562')
    expect(v7Timestamp(first)).toBe(1_700_000_000_000)
  })

  it('v7 stays ordered when the clock steps back and rolls over on counter overflow', () => {
    const times = [1000, 999, 1001]
    const next = createV7Generator(undefined, () => times.shift()!)
    const batch = [next(), next(), next()].map((bytes) => formatUuid(bytes))
    expect([...batch].sort()).toEqual(batch)
    const maxed = createV7Generator((bytes) => bytes.fill(0xff), () => 5)
    maxed()
    expect(v7Timestamp(maxed())).toBe(6)
  })

  it('v7 throws rather than wrapping the timestamp to 0 at the end of the 48-bit range', () => {
    const maxed = createV7Generator((bytes) => bytes.fill(0xff), () => 2 ** 48 - 1)
    expect(v7Timestamp(maxed())).toBe(2 ** 48 - 1)
    expect(() => maxed()).toThrow(/48-bit/)
  })

  it('ULID throws rather than wrapping the timestamp to 0 at the end of the 48-bit range', () => {
    const maxed = createUlidGenerator((bytes) => bytes.fill(0xff), () => 2 ** 48 - 1)
    expect(encodeUlid(maxed())).toBe('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(() => maxed()).toThrow(/48-bit/)
  })

  it('ULID batches in one millisecond sort in generation order', () => {
    const next = createUlidGenerator(undefined, () => 1_469_918_176_385)
    const batch = Array.from({ length: 1000 }, () => encodeUlid(next()))
    expect([...batch].sort()).toEqual(batch)
    expect(new Set(batch).size).toBe(1000)
    expect(batch[0].slice(0, 10)).toBe('01ARYZ6S41')
  })
})
