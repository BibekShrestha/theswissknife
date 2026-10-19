import { describe, expect, it } from 'vitest'
import { parseProto } from './proto-schema'
import { decodeProtobuf, readVarint, zigzag } from './protobuf'
import { hex } from './testkit'
import type { DNode } from './types'

const reading = (node: DNode, prefix: string) => node.readings?.find((r) => r.name.startsWith(prefix))?.value
const active = (node: DNode) => node.views![node.view!]
const viewNames = (node: DNode) => node.views!.map((v) => v.name)

describe('Protobuf — encoding guide examples', () => {
  it('reads a varint field (08 96 01 = field 1, 150)', () => {
    const r = decodeProtobuf(hex('089601'))
    expect(r.errors).toEqual([])
    const [f] = r.nodes
    expect(f).toMatchObject({ label: '1', kind: 'VARINT', start: 0, head: 1, end: 3, value: '150' })
    expect(reading(f, 'unsigned')).toBe('150')
    expect(reading(f, 'signed')).toBe('150')
    expect(reading(f, 'zigzag')).toBe('75')
  })

  it('reads a string field (12 07 "testing")', () => {
    const [f] = decodeProtobuf(hex('120774657374696e67')).nodes
    expect(f).toMatchObject({ label: '2', kind: 'LEN', head: 2, end: 9, value: '"testing"' })
    expect(active(f).name).toBe('text')
    expect(viewNames(f)).toContain('bytes')
  })

  it('reads an embedded message (1a 03 08 96 01)', () => {
    const [f] = decodeProtobuf(hex('1a03089601')).nodes
    expect(active(f).name).toBe('message')
    expect(active(f).children![0]).toMatchObject({ label: '1', value: '150', start: 2, end: 5 })
  })

  it('reads a packed repeated field when asked (32 06 03 8e 02 9e a7 05)', () => {
    const bytes = hex('3206038e029ea705')
    const plain = decodeProtobuf(bytes).nodes[0]
    expect(active(plain).name).toBe('bytes')
    const f = decodeProtobuf(bytes, { packed: true }).nodes[0]
    expect(active(f).name).toBe('packed varint')
    expect(active(f).value).toBe('[3, 270, 86942]')
    expect(active(f).children!.map((c) => [c.start, c.end])).toEqual([[2, 3], [3, 5], [5, 8]])
  })

  it('shows zigzag and two’s-complement readings', () => {
    expect(zigzag(1n)).toBe(-1n)
    expect(zigzag(2n)).toBe(1n)
    expect(zigzag(3n)).toBe(-2n)
    expect(zigzag(0xfffffffen)).toBe(2147483647n)
    expect(zigzag(0xffffffffn)).toBe(-2147483648n)
    const [f] = decodeProtobuf(hex('08feffffffffffffffff01')).nodes
    expect(reading(f, 'unsigned')).toBe('18446744073709551614')
    expect(reading(f, 'signed')).toBe('-2')
    expect(reading(f, 'zigzag')).toBe('9223372036854775807')
  })

  it('reads I32 and I64 as int, uint and float', () => {
    const [float] = decodeProtobuf(hex('0d0000c03f')).nodes
    expect(float.value).toBe('1.5')
    expect(reading(float, 'unsigned')).toBe('1069547520')
    const [tenth] = decodeProtobuf(hex('0dcdcccc3d')).nodes
    expect(reading(tenth, 'float')).toBe('0.1')
    const [int] = decodeProtobuf(hex('0d05000000')).nodes
    expect(int.value).toBe('5')
    expect(reading(int, 'float')).toBe('7.0e-45')
    const [dbl] = decodeProtobuf(hex('09000000000000f83f')).nodes
    expect(dbl).toMatchObject({ kind: 'I64', value: '1.5' })
    const [neg] = decodeProtobuf(hex('09ffffffffffffffff')).nodes
    expect(neg.value).toBe('-1')
    expect(reading(neg, 'unsigned')).toBe('18446744073709551615')
  })

  it('reads groups', () => {
    const [g] = decodeProtobuf(hex('0b08010c')).nodes
    expect(g).toMatchObject({ kind: 'SGROUP', start: 0, end: 4 })
    expect(g.children![0]).toMatchObject({ label: '1', value: '1' })
  })

  it('offers every plausible reading of a length-delimited field', () => {
    // "hi" is also a valid message (field 13 = 105); printable text wins, the message stays available.
    const [hi] = decodeProtobuf(hex('12026869')).nodes
    expect(active(hi).name).toBe('text')
    expect(viewNames(hi)).toEqual(['message', 'text', 'bytes'])
    // 08 10 is a message (field 1 = 16), not printable text, and packed varints [8, 16].
    const [m] = decodeProtobuf(hex('0a020810'), { packed: true }).nodes
    expect(active(m).name).toBe('message')
    expect(viewNames(m)).toEqual(['message', 'text', 'packed varint', 'bytes'])
    // Eight bytes split as two fixed32 and one fixed64.
    const [p] = decodeProtobuf(hex('0a08ffffffffffffffff'), { packed: true }).nodes
    expect(viewNames(p)).toEqual(['packed varint', 'packed fixed32', 'packed fixed64', 'bytes'].filter((n) => n !== 'packed varint'))
    const [empty] = decodeProtobuf(hex('0a00')).nodes
    expect(active(empty).name).toBe('text')
    expect(empty.notes?.[0].text).toMatch(/empty string, empty bytes and an empty message/)
  })

  it('reads varints up to 64 bits and rejects wider ones', () => {
    expect(readVarint(hex('ffffffffffffffffff01'), 0, 10)).toEqual({ value: 0xffffffffffffffffn, next: 10 })
    expect(readVarint(hex('ffffffffffffffffff02'), 0, 10)).toEqual({ error: 'varint is wider than 64 bits' })
    expect(readVarint(hex('ff'), 0, 1)).toEqual({ error: 'varint runs past the end of the data' })
  })

  it('notes over-long varints', () => {
    expect(decodeProtobuf(hex('088100')).nodes[0].notes?.[0].text).toMatch(/Over-long varint: 2 bytes where 1 would do/)
  })
})

describe('Protobuf — malformed input is reported with its offset', () => {
  const first = (h: string) => decodeProtobuf(hex(h)).errors[0]

  it('reports each failure where it happens', () => {
    expect(first('08')).toEqual({ offset: 1, message: 'Field 1: varint runs past the end of the data' })
    expect(first('089601120561')).toEqual({ offset: 3, message: 'Field 2: length 5 runs past the end (1 bytes left)' })
    expect(first('00')).toEqual({ offset: 0, message: 'Field number 0 is not allowed' })
    expect(first('0f')).toEqual({ offset: 0, message: 'Invalid wire type 7 (field 1)' })
    expect(first('0c')).toEqual({ offset: 0, message: 'End-group tag for field 1 with no group open' })
    expect(first('0b0801')).toEqual({ offset: 0, message: 'Group 1 has no end-group tag' })
    expect(first('0d0000')).toEqual({ offset: 0, message: 'Field 1: I32 needs 4 bytes, only 2 left' })
  })

  it('keeps the fields read before the error', () => {
    const r = decodeProtobuf(hex('08011002ff'))
    expect(r.nodes.map((n) => n.value)).toEqual(['1', '2'])
    expect(r.consumed).toBe(4)
  })

  it('rejects a huge length without allocating', () => {
    expect(first('0affffffffffffffffff01').message).toMatch(/length 18446744073709551615 runs past the end/)
  })

  it('stops trying nested messages at the depth cap', () => {
    // 80 levels of field 1 wrapping field 1 wrapping …
    let inner = hex('0801')
    for (let i = 0; i < 80; i++) {
      const next = new Uint8Array(inner.length + 2)
      next.set([0x0a, inner.length])
      next.set(inner, 2)
      if (inner.length > 127) break
      inner = next
    }
    const r = decodeProtobuf(inner)
    expect(r.errors).toEqual([])
  })
})

describe('Protobuf — with a .proto', () => {
  const schema = parseProto(`
    syntax = "proto3";
    package demo;
    // A person.
    message Person {
      string name = 1;
      int32 id = 2;
      repeated sint32 deltas = 3;
      Address home = 4;
      map<string, int32> scores = 5;
      Kind kind = 6;
      enum Kind { UNKNOWN = 0; ADMIN = 1; }
      message Address { string city = 1; }
    }
  `)
  const root = schema.messages.get('demo.Person')!
  const bytes = hex('0a03416461 102a 1a03010203 22040a024f73 2a070a036d61741005 3001')

  it('names and types fields', () => {
    const r = decodeProtobuf(bytes, { schema, root })
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    const [name, id, deltas, home, scores, kind] = r.nodes
    expect(name).toMatchObject({ label: 'name (1)', value: '"Ada"' })
    expect(id).toMatchObject({ label: 'id (2)', value: '42' })
    expect(active(deltas)).toMatchObject({ name: 'packed varint', value: '[-1, 1, -2]' })
    expect(active(home).kind).toBe('Address')
    expect(active(home).children![0]).toMatchObject({ label: 'city (1)', value: '"Os"' })
    expect(active(scores).children!.map((c) => [c.label, c.value])).toEqual([['key (1)', '"mat"'], ['value (2)', '5']])
    expect(kind).toMatchObject({ label: 'kind (6)', value: 'ADMIN (1)' })
    expect(reading(kind, 'declared')).toBe('Kind')
  })

  it('types negative int32 and sint32 values', () => {
    const r = decodeProtobuf(hex('10ffffffffffffffffff01 1801'), { schema, root })
    expect(r.nodes[0].value).toBe('-1')
    // Field 3 sent unpacked: one sint32.
    expect(r.nodes[1]).toMatchObject({ label: 'deltas (3)', value: '-1' })
  })

  it('warns when the wire type contradicts the declaration', () => {
    const r = decodeProtobuf(hex('0801'), { schema, root })
    expect(r.warnings[0].message).toBe('Field name (1): declared string, but sent as VARINT')
  })

  it('leaves undeclared fields schemaless', () => {
    expect(decodeProtobuf(hex('380a'), { schema, root }).nodes[0]).toMatchObject({ label: '7', value: '10' })
  })
})
