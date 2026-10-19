import { describe, expect, it } from 'vitest'
import { decodeMsgpack } from './msgpack'
import { hex, notation } from './testkit'

const one = (h: string) => {
  const r = decodeMsgpack(hex(h))
  expect(r.errors).toEqual([])
  expect(r.items).toBe(1)
  return r.nodes[0]
}

describe('MessagePack — every format in the spec', () => {
  it('decodes the msgpack.org front-page example', () => {
    // {"compact": true, "schema": 0} in 18 bytes
    const root = one('82a7636f6d70616374c3a6736368656d6100')
    expect(notation(root)).toBe('{"compact": true, "schema": 0}')
    expect(root.kind).toBe('fixmap (2)')
    expect(root.children![0]).toMatchObject({ label: '"compact"', start: 9, end: 10, kind: 'bool' })
    expect(root.children![0].key).toMatchObject({ start: 1, head: 2, end: 9, kind: 'fixstr' })
  })

  it.each([
    ['00', '0', 'positive fixint'],
    ['7f', '127', 'positive fixint'],
    ['e0', '-32', 'negative fixint'],
    ['ff', '-1', 'negative fixint'],
    ['c0', 'null', 'nil'],
    ['c2', 'false', 'bool'],
    ['c3', 'true', 'bool'],
    ['ccff', '255', 'uint 8'],
    ['cd0100', '256', 'uint 16'],
    ['ce00010000', '65536', 'uint 32'],
    ['cf0000000100000000', '4294967296', 'uint 64'],
    ['cfffffffffffffffff', '18446744073709551615', 'uint 64'],
    ['d0df', '-33', 'int 8'],
    ['d1ff7f', '-129', 'int 16'],
    ['d2ffff7fff', '-32769', 'int 32'],
    ['d38000000000000000', '-9223372036854775808', 'int 64'],
    ['ca3fc00000', '1.5', 'float 32'],
    ['cb3ff8000000000000', '1.5', 'float 64'],
    ['cbfff0000000000000', '-Infinity', 'float 64'],
    ['a0', '""', 'fixstr'],
    ['a3616263', '"abc"', 'fixstr'],
    [`d920${'61'.repeat(32)}`, `"${'a'.repeat(32)}"`, 'str 8'],
    [`da0100${'62'.repeat(256)}`, `"${'b'.repeat(256)}"`, 'str 16'],
    ['c400', "h''", 'bin 8'],
    ['c403010203', "h'010203'", 'bin 8'],
    ['90', '[]', 'fixarray (0)'],
    ['93010203', '[1, 2, 3]', 'fixarray (3)'],
    [`dc0010${'01'.repeat(16)}`, `[${Array(16).fill(1).join(', ')}]`, 'array 16 (16)'],
    ['80', '{}', 'fixmap (0)'],
    ['81a16101', '{"a": 1}', 'fixmap (1)'],
    ['d4012a', "ext(1, h'2a')", 'fixext 1'],
    ['d5fe0102', "ext(-2, h'0102')", 'fixext 2'],
    [`d805${'00'.repeat(16)}`, `ext(5, h'${'00'.repeat(16)}')`, 'fixext 16'],
    ['c703070a0b0c', "ext(7, h'0a0b0c')", 'ext 8'],
  ])('%s → %s (%s)', (h, diag, kind) => {
    const node = one(h)
    expect(notation(node)).toBe(diag)
    expect(node.kind).toBe(kind)
    expect(node.end).toBe(h.length / 2)
  })

  it('decodes all three timestamp sizes (ext -1)', () => {
    expect(one('d6ff00000001')).toMatchObject({ kind: 'timestamp 32', value: '1970-01-01T00:00:01Z' })
    // timestamp 64: nanoseconds in the top 30 bits, seconds in the low 34.
    expect(one('d7ff7735940000000001')).toMatchObject({ kind: 'timestamp 64', value: '1970-01-01T00:00:01.5Z' })
    expect(one('c70cff00000000ffffffffffffffff')).toMatchObject({ kind: 'timestamp 96', value: '1969-12-31T23:59:59Z' })
    expect(one('c70cff000003e8000000174876e800').value).toBe('5138-11-16T09:46:40.000001Z')
  })

  it('warns about invalid timestamps', () => {
    expect(decodeMsgpack(hex('d5ff0000')).warnings[0].message).toMatch(/must hold 4, 8 or 12 bytes/)
    expect(decodeMsgpack(hex('d7ffffffffff00000000')).warnings[0].message).toMatch(/exceed 999999999/)
  })

  it('reads a stream of several objects', () => {
    const r = decodeMsgpack(hex('01c0a161'))
    expect(r.errors).toEqual([])
    expect(r.nodes.map((n) => n.value)).toEqual(['1', 'null', '"a"'])
  })
})

describe('MessagePack — shortest-form warnings', () => {
  const warnings = (h: string) => decodeMsgpack(hex(h)).warnings.map((w) => w.message)

  it('is quiet on shortest encodings', () => {
    for (const h of ['7f', 'ccff', 'd0df', 'a3616263', '93010203', 'd6ff00000001']) expect(warnings(h)).toEqual([])
  })

  it('flags longer forms than needed', () => {
    expect(warnings('cc05')).toEqual(['Not the shortest form: 5 fits in a positive fixint'])
    expect(warnings('d1ffff')).toEqual(['Not the shortest form: -1 fits in a negative fixint'])
    expect(warnings('d00a')).toEqual(['Not the shortest form: 10 fits in a positive fixint'])
    expect(warnings('d903616263')).toEqual(['Not the shortest form: a 3-byte string fits in a fixstr'])
    expect(warnings('dc000101')).toEqual(['Not the shortest form: 1 items fit in a fixarray'])
    expect(warnings('c701012a')).toEqual(['Not the shortest form: a 1-byte ext fits in a fixext 1'])
    expect(warnings('d7ff0000000000000001')).toEqual(['Not the shortest form: this timestamp fits in timestamp 32'])
  })

  it('flags duplicate keys and invalid UTF-8', () => {
    expect(warnings('82a16101a16102')).toEqual(['Duplicate map key "a"'])
    expect(warnings('a2c328')).toEqual(['String is not valid UTF-8 — shown as bytes'])
  })
})

describe('MessagePack — malformed input', () => {
  const first = (h: string) => decodeMsgpack(hex(h)).errors[0]

  it('reports errors with their offsets', () => {
    expect(first('91c1')).toEqual({ offset: 1, message: 'Type byte 0xc1 is never used in MessagePack' })
    expect(first('cd01')).toEqual({ offset: 0, message: 'uint 16 needs 2 more bytes, only 1 left' })
    expect(first('a5616263')).toEqual({ offset: 0, message: 'fixstr of length 5 cannot fit in the 3 bytes left' })
    expect(first('9301cd0102')).toEqual({ offset: 5, message: 'Unexpected end of input — another object was expected' })
  })

  it('rejects 2^32 lengths without allocating', () => {
    expect(first('dbffffffff').message).toMatch(/str 32 of length 4294967295 cannot fit/)
    expect(first('ddffffffff').message).toMatch(/array 32 of length 4294967295 cannot fit/)
    expect(first('dfffffffff').message).toMatch(/map 32 of length 4294967295 cannot fit/)
    expect(first('c9ffffffff01').message).toMatch(/ext 32 of length 4294967295 cannot fit/)
  })

  it('caps nesting depth', () => {
    expect(decodeMsgpack(new Uint8Array(100).fill(0x91)).errors[0].message).toMatch(/Nested more than 64 levels/)
  })
})
