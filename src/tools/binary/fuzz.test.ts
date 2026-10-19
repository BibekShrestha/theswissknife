/**
 * Fuzz-style tests: random and mutated bytes must never throw out of a
 * decoder, every node's range must stay inside the input, and every decode
 * must finish (a hang would time the test out — nothing here measures time).
 */

import { describe, expect, it } from 'vitest'
import { decodeCbor } from './cbor'
import { handleDecode } from './decode'
import { decodeMsgpack } from './msgpack'
import { parseProto } from './proto-schema'
import { decodeProtobuf } from './protobuf'
import { hex, rng, walk } from './testkit'
import { Budget, closeOpen } from './util'
import type { DecodeResult } from './types'

const schema = parseProto('message R { string s = 1; repeated int64 xs = 2; R child = 3; map<string, R> m = 4; repeated float f = 5; E e = 6; enum E { A = 0; } }')
const root = schema.messages.get('R')!

const decoders: [string, (b: Uint8Array) => DecodeResult][] = [
  ['cbor', (b) => decodeCbor(b, new Budget(20_000))],
  ['msgpack', (b) => decodeMsgpack(b, new Budget(20_000))],
  ['protobuf', (b) => decodeProtobuf(b, {}, new Budget(20_000))],
  ['protobuf packed', (b) => decodeProtobuf(b, { packed: true }, new Budget(20_000))],
  ['protobuf schema', (b) => decodeProtobuf(b, { packed: true, schema, root }, new Budget(20_000))],
]

function check(name: string, bytes: Uint8Array, r: DecodeResult) {
  for (const issue of [...r.errors, ...r.warnings]) {
    if (issue.offset < 0 || issue.offset > bytes.length) throw new Error(`${name}: issue offset ${issue.offset} outside 0..${bytes.length}`)
  }
  for (const node of walk(r.nodes)) {
    if (!(node.start >= 0 && node.start <= node.head && node.head <= node.end && node.end <= bytes.length)) {
      throw new Error(`${name}: node ${node.label} has range ${node.start}/${node.head}/${node.end} for ${bytes.length} bytes`)
    }
  }
}

const seeds = [
  '089601', '120774657374696e67', '1a03089601', '3206038e029ea705', '0b08010c',
  'a26161016162820203', '9f018202039f0405ffff', 'bf6346756ef563416d7421ff', 'c249010000000000000000', 'd818456449455446', 'c48221196ab3',
  '82a7636f6d70616374c3a6736368656d6100', 'c70cff00000000ffffffffffffffff', 'd7ff7735940000000001', 'de0001a16101',
]

describe('fuzz', () => {
  it.each(decoders)('%s never throws on random bytes', (name, decode) => {
    const next = rng(0xb1a5 + name.length)
    for (let round = 0; round < 1500; round++) {
      const len = Math.floor(next() * (round % 10 === 0 ? 2000 : 64))
      const bytes = new Uint8Array(len)
      // Bias towards the interesting bytes: headers, breaks, maximal lengths.
      for (let i = 0; i < len; i++) bytes[i] = next() < 0.2 ? [0x00, 0x0a, 0x1b, 0x5f, 0x9f, 0xbf, 0xff, 0xdd, 0xc7, 0xd8, 0x80][Math.floor(next() * 11)] : Math.floor(next() * 256)
      let r: DecodeResult
      try {
        r = decode(bytes)
      } catch (error) {
        throw new Error(`${name} threw on ${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}: ${String(error)}`)
      }
      check(name, bytes, r)
    }
  })

  it.each(decoders)('%s never throws on mutated valid messages', (name, decode) => {
    const next = rng(0x5eed + name.length)
    for (const seed of seeds) {
      const base = hex(seed)
      for (let round = 0; round < 300; round++) {
        const bytes = new Uint8Array(base)
        const kind = round % 4
        if (kind === 0) bytes[Math.floor(next() * bytes.length)] ^= 1 << Math.floor(next() * 8)
        else if (kind === 1) bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256)
        const cut = kind === 2 ? bytes.subarray(0, Math.floor(next() * bytes.length)) : bytes
        const input = kind === 3 ? new Uint8Array([...bytes, ...bytes.subarray(0, Math.floor(next() * bytes.length))]) : cut
        let r: DecodeResult
        try {
          r = decode(input)
        } catch (error) {
          throw new Error(`${name} threw on mutation of ${seed}: ${String(error)}`)
        }
        check(name, input, r)
      }
    }
  })

  it('survives adversarial shapes', () => {
    const shapes: Uint8Array[] = [
      new Uint8Array(10_000).fill(0x81), // CBOR: array of array of …
      new Uint8Array(10_000).fill(0x9f), // CBOR: indefinite arrays, never closed
      new Uint8Array(10_000).fill(0x91), // MessagePack: fixarray of fixarray of …
      new Uint8Array(10_000).fill(0x0b), // Protobuf: groups opened forever
      new Uint8Array(20_000).fill(0x00), // A long run of zeros
      hex('9bffffffffffffffff'),
      hex('bbffffffffffffffff'),
      hex('dfffffffff'),
      hex('0affffffffffffffffff01'),
    ]
    // Protobuf: 0x0a <len> nested many times, each level a valid message.
    let nested = hex('0801')
    while (nested.length < 20_000) {
      const len = nested.length
      const prefix = [0x0a]
      let v = len
      while (v >= 0x80) {
        prefix.push((v & 0x7f) | 0x80)
        v >>>= 7
      }
      prefix.push(v)
      const out = new Uint8Array(prefix.length + len)
      out.set(prefix)
      out.set(nested, prefix.length)
      nested = out
    }
    shapes.push(nested)
    // A long packed field with every view possible.
    shapes.push(new Uint8Array([0x0a, 0x80, 0x80, 0x04, ...new Uint8Array(65536).fill(0x01)]))
    for (const bytes of shapes) {
      for (const [name, decode] of decoders) check(name, bytes, decode(bytes))
      const response = handleDecode({ bytes, format: 'auto', options: { packed: true, proto: '', root: '' } })
      expect(response.error).toBeNull()
    }
  })

  it('closes a huge open container without spreading its children into one call', () => {
    // Regression: closeOpen used push(...children), which overflows a worker's smaller stack at 100,000 items.
    const children = Array.from({ length: 1_000_000 }, (_, i) => ({ label: '', kind: 'uint', start: i, head: i, end: i + 1 }))
    const nodes = [{ label: 'root', kind: 'array', start: 0, head: 3, end: -1, children }]
    expect(() => closeOpen(nodes, 10)).not.toThrow()
    expect(nodes[0].end).toBe(10)
  })

  it('caps every result at the node budget', () => {
    const bytes = new Uint8Array(300_000)
    const response = handleDecode({ bytes, format: 'msgpack', options: { packed: false, proto: '', root: '' } })
    expect(response.result.truncated).toBe(true)
    expect(response.result.nodes.length).toBe(100_000)
  })
})
