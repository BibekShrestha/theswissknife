import { describe, expect, it } from 'vitest'
import { decodeCbor } from './cbor'
import { hex, notation } from './testkit'
import { Budget } from './util'

/** RFC 8949 Appendix A, Table 6: diagnostic notation → encoded hex. Non-ASCII text is written literally. */
const appendixA: [string, string][] = [
  ['0', '00'],
  ['1', '01'],
  ['10', '0a'],
  ['23', '17'],
  ['24', '1818'],
  ['25', '1819'],
  ['100', '1864'],
  ['1000', '1903e8'],
  ['1000000', '1a000f4240'],
  ['1000000000000', '1b000000e8d4a51000'],
  ['18446744073709551615', '1bffffffffffffffff'],
  ["2(h'010000000000000000')", 'c249010000000000000000'],
  ['-18446744073709551616', '3bffffffffffffffff'],
  ["3(h'010000000000000000')", 'c349010000000000000000'],
  ['-1', '20'],
  ['-10', '29'],
  ['-100', '3863'],
  ['-1000', '3903e7'],
  ['0.0', 'f90000'],
  ['-0.0', 'f98000'],
  ['1.0', 'f93c00'],
  ['1.1', 'fb3ff199999999999a'],
  ['1.5', 'f93e00'],
  ['65504.0', 'f97bff'],
  ['100000.0', 'fa47c35000'],
  ['3.4028234663852886e+38', 'fa7f7fffff'],
  ['1.0e+300', 'fb7e37e43c8800759c'],
  ['5.960464477539063e-8', 'f90001'],
  ['0.00006103515625', 'f90400'],
  ['-4.0', 'f9c400'],
  ['-4.1', 'fbc010666666666666'],
  ['Infinity', 'f97c00'],
  ['NaN', 'f97e00'],
  ['-Infinity', 'f9fc00'],
  ['Infinity', 'fa7f800000'],
  ['NaN', 'fa7fc00000'],
  ['-Infinity', 'faff800000'],
  ['Infinity', 'fb7ff0000000000000'],
  ['NaN', 'fb7ff8000000000000'],
  ['-Infinity', 'fbfff0000000000000'],
  ['false', 'f4'],
  ['true', 'f5'],
  ['null', 'f6'],
  ['undefined', 'f7'],
  ['simple(16)', 'f0'],
  ['simple(255)', 'f8ff'],
  ['0("2013-03-21T20:04:00Z")', 'c074323031332d30332d32315432303a30343a30305a'],
  ['1(1363896240)', 'c11a514b67b0'],
  ['1(1363896240.5)', 'c1fb41d452d9ec200000'],
  ["23(h'01020304')", 'd74401020304'],
  ["24(h'6449455446')", 'd818456449455446'],
  ['32("http://www.example.com")', 'd82076687474703a2f2f7777772e6578616d706c652e636f6d'],
  ["h''", '40'],
  ["h'01020304'", '4401020304'],
  ['""', '60'],
  ['"a"', '6161'],
  ['"IETF"', '6449455446'],
  ['"\\"\\\\"', '62225c'],
  ['"ü"', '62c3bc'],
  ['"水"', '63e6b0b4'],
  ['"𐅑"', '64f0908591'],
  ['[]', '80'],
  ['[1, 2, 3]', '83010203'],
  ['[1, [2, 3], [4, 5]]', '8301820203820405'],
  [`[${Array.from({ length: 25 }, (_, i) => i + 1).join(', ')}]`, '98190102030405060708090a0b0c0d0e0f101112131415161718181819'],
  ['{}', 'a0'],
  ['{1: 2, 3: 4}', 'a201020304'],
  ['{"a": 1, "b": [2, 3]}', 'a26161016162820203'],
  ['["a", {"b": "c"}]', '826161a161626163'],
  ['{"a": "A", "b": "B", "c": "C", "d": "D", "e": "E"}', 'a56161614161626142616361436164614461656145'],
  ["(_ h'0102', h'030405')", '5f42010243030405ff'],
  ['(_ "strea", "ming")', '7f657374726561646d696e67ff'],
  ['[_ ]', '9fff'],
  ['[_ 1, [2, 3], [_ 4, 5]]', '9f018202039f0405ffff'],
  ['[_ 1, [2, 3], [4, 5]]', '9f01820203820405ff'],
  ['[1, [2, 3], [_ 4, 5]]', '83018202039f0405ff'],
  ['[1, [_ 2, 3], [4, 5]]', '83019f0203ff820405'],
  [`[_ ${Array.from({ length: 25 }, (_, i) => i + 1).join(', ')}]`, '9f0102030405060708090a0b0c0d0e0f101112131415161718181819ff'],
  ['{_ "a": 1, "b": [_ 2, 3]}', 'bf61610161629f0203ffff'],
  ['["a", {_ "b": "c"}]', '826161bf61626163ff'],
  ['{_ "Fun": true, "Amt": -2}', 'bf6346756ef563416d7421ff'],
]

describe('CBOR — RFC 8949 Appendix A', () => {
  it.each(appendixA)('%s ← %s', (diag, encoded) => {
    const bytes = hex(encoded)
    const r = decodeCbor(bytes)
    expect(r.errors).toEqual([])
    expect(r.items).toBe(1)
    expect(r.consumed).toBe(bytes.length)
    expect(notation(r.nodes[0])).toBe(diag)
    expect(r.nodes[0].start).toBe(0)
    expect(r.nodes[0].end).toBe(bytes.length)
  })

  it('interprets bignums, dates and embedded CBOR', () => {
    expect(decodeCbor(hex('c249010000000000000000')).nodes[0].value).toBe('18446744073709551616')
    expect(decodeCbor(hex('c349010000000000000000')).nodes[0].value).toBe('-18446744073709551617')
    expect(decodeCbor(hex('c074323031332d30332d32315432303a30343a30305a')).nodes[0].value).toBe('2013-03-21T20:04:00Z')
    expect(decodeCbor(hex('c11a514b67b0')).nodes[0].value).toBe('2013-03-21T20:04:00Z')
    expect(decodeCbor(hex('c1fb41d452d9ec200000')).nodes[0].value).toBe('2013-03-21T20:04:00.5Z')
    const embedded = decodeCbor(hex('d818456449455446')).nodes[0]
    expect(embedded.views?.[embedded.view!].name).toBe('embedded CBOR')
    expect(embedded.views?.[0].children?.[0].value).toBe('"IETF"')
    expect(embedded.views?.[0].children?.[0].start).toBe(3)
  })

  it('shows decimal fractions and bigfloats exactly (RFC 8949 §3.4.4)', () => {
    // 4([-2, 27315]) = 273.15, 5([-1, 3]) = 1.5
    expect(decodeCbor(hex('c48221196ab3')).nodes[0].value).toBe('273.15 (27315 × 10^-2)')
    expect(decodeCbor(hex('c5822003')).nodes[0].value).toBe('1.5 (3 × 2^-1)')
    // A bignum mantissa: 4([-1, 2(h'010000000000000000')])
    expect(decodeCbor(hex('c48220c249010000000000000000')).nodes[0].value).toBe('1844674407370955161.6 (18446744073709551616 × 10^-1)')
  })

  it('records byte offsets and header ends', () => {
    const r = decodeCbor(hex('a26161016162820203'))
    const [a, b] = r.nodes[0].children!
    expect(a.key).toMatchObject({ start: 1, end: 3, head: 2 })
    expect(a).toMatchObject({ label: '"a"', start: 3, end: 4 })
    expect(b).toMatchObject({ label: '"b"', start: 6, head: 7, end: 9 })
    expect(b.children!.map((c) => c.start)).toEqual([7, 8])
  })

  it('reads CBOR sequences (RFC 8742)', () => {
    const r = decodeCbor(hex('0102f6'))
    expect(r.errors).toEqual([])
    expect(r.nodes.map((n) => [n.label, n.value])).toEqual([['item 0', '1'], ['item 1', '2'], ['item 2', 'null']])
  })
})

describe('CBOR — deterministic-encoding warnings (§4.2.1)', () => {
  const warnings = (h: string) => decodeCbor(hex(h)).warnings.map((w) => w.message)

  it('accepts the deterministic vectors quietly', () => {
    for (const h of ['00', '1818', '1903e8', 'f93e00', 'fb3ff199999999999a', 'a201020304', 'a26161016162820203']) expect(warnings(h)).toEqual([])
  })

  it('flags non-shortest integers and lengths', () => {
    expect(warnings('1801')[0]).toMatch(/1 is written with 1 argument bytes where none would do/)
    expect(warnings('190020')[0]).toMatch(/32 is written with 2 argument bytes where fewer would do/)
    expect(warnings('5801ff')[0]).toMatch(/Not deterministic/)
  })

  it('flags floats that fit a shorter width', () => {
    expect(warnings('fa3fc00000')[0]).toMatch(/1.5 fits in a float16/)
    expect(warnings('fb3ff8000000000000')[0]).toMatch(/fits in a float16/)
    expect(warnings('fb3ff3333340000000')[0]).toMatch(/fits in a float32/)
    expect(warnings('fb7ff8000000000000')[0]).toMatch(/NaN fits in a float16/)
  })

  it('flags indefinite lengths, unsorted and duplicate keys', () => {
    expect(warnings('9fff')[0]).toMatch(/indefinite-length array/)
    expect(warnings('a2616201616101')).toEqual([expect.stringMatching(/not in bytewise lexicographic order/)])
    // Deterministic order compares encodings: 10 (0x0a) sorts before -1 (0x20), and short keys before long ones.
    expect(warnings('a20a012002')).toEqual([])
    expect(warnings('a2616101616101')).toEqual([expect.stringMatching(/Duplicate map key "a"/)])
  })

  it('flags bignums that fit in a plain integer', () => {
    expect(warnings('c24101')[0]).toMatch(/fits in a plain unsigned integer/)
  })
})

describe('CBOR — malformed input is reported with its offset', () => {
  const first = (h: string) => decodeCbor(hex(h)).errors[0]

  it('rejects a 2^64 length without allocating', () => {
    const e = first('5bffffffffffffffff00')
    expect(e.offset).toBe(0)
    expect(e.message).toMatch(/length 18446744073709551615 cannot fit in the 1 bytes left/)
    expect(first('9bffffffffffffffff').message).toMatch(/Array of length/)
    expect(first('bbffffffffffffffff').message).toMatch(/Map of length/)
  })

  it('reports truncation, reserved values and stray breaks', () => {
    expect(first('1a0001')).toEqual({ offset: 0, message: expect.stringMatching(/needs 4 more bytes, only 2 left/) })
    expect(first('811c')).toEqual({ offset: 1, message: expect.stringMatching(/reserved additional information 28/) })
    expect(first('81ff')).toEqual({ offset: 1, message: expect.stringMatching(/Unexpected break/) })
    expect(first('f801')).toEqual({ offset: 0, message: expect.stringMatching(/simple\(1\) must be written in the initial byte/) })
    expect(first('1f').message).toMatch(/cannot have an indefinite length/)
    expect(first('5f6161ff')).toEqual({ offset: 1, message: expect.stringMatching(/must be a definite-length byte string/) })
    expect(first('bf6161ff')).toEqual({ offset: 3, message: expect.stringMatching(/key with no value/) })
    expect(first('9f01').message).toMatch(/no break/)
  })

  it('keeps the partial tree and closes open containers', () => {
    const r = decodeCbor(hex('8301021a00'))
    expect(r.errors[0]).toMatchObject({ offset: 3 })
    expect(r.nodes[0].children!.map((c) => c.value)).toEqual(['1', '2'])
    expect(r.nodes[0].end).toBeGreaterThan(0)
    expect(r.nodes[0].notes?.[0].text).toMatch(/Incomplete/)
  })

  it('caps nesting depth', () => {
    const deep = new Uint8Array(200).fill(0x81)
    expect(decodeCbor(deep).errors[0].message).toMatch(/Nested more than 64 levels/)
  })

  it('caps the item count and says the tree is cut', () => {
    const many = new Uint8Array(5000)
    many.set([0x99, 0x0f, 0xa0])
    const r = decodeCbor(many, new Budget(100))
    expect(r.truncated).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings.at(-1)?.message).toMatch(/Stopped after 100 items/)
  })

  it('warns about invalid UTF-8 in a text string', () => {
    const r = decodeCbor(hex('62c328'))
    expect(r.errors).toEqual([])
    expect(r.warnings[0].message).toMatch(/not valid UTF-8/)
    expect(r.nodes[0].value).toBe("h'c328'")
  })
})
