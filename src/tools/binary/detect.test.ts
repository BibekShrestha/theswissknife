import { describe, expect, it } from 'vitest'
import { handleDecode } from './decode'
import { hex } from './testkit'
import type { FormatChoice } from './types'

const run = (h: string, format: FormatChoice = 'auto', proto = '') =>
  handleDecode({ bytes: hex(h), format, options: { packed: false, proto, root: '' } })

describe('format detection', () => {
  it('recognises each format from a typical message', () => {
    expect(run('0a0341646110' + '2a').detection).toMatchObject({ format: 'protobuf', confidence: 'high' })
    expect(run('a26161016162820203').detection).toMatchObject({ format: 'cbor', confidence: 'high' })
    expect(run('82a7636f6d70616374c3a6736368656d6100').detection).toMatchObject({ format: 'msgpack', confidence: 'high' })
  })

  it('names the runners-up and where they stop', () => {
    const d = run('089601').detection!
    expect(d.reason).toMatch(/^Only Protobuf reads every byte\./)
    expect(d.reason).toMatch(/CBOR stops at byte 1/)
    expect(d.reason).toMatch(/MessagePack stops at byte 1/)
  })

  it('is only medium-confident when two formats read the bytes', () => {
    const d = run('01').detection!
    expect(d.confidence).toBe('medium')
    expect(d.reason).toMatch(/but so does/)
  })

  it('trusts the self-described CBOR tag', () => {
    expect(run('d9d9f701').detection).toMatchObject({ format: 'cbor' })
  })

  it('is low-confident when nothing reads every byte', () => {
    const d = run('c1c1c1ff').detection!
    expect(d.confidence).toBe('low')
    expect(d.reason).toMatch(/No format reads every byte/)
  })

  it('does not claim every byte was read when the item cap stopped decoding', () => {
    const r = handleDecode({ bytes: new Uint8Array(300_000), format: 'auto', options: { packed: false, proto: '', root: '' } })
    expect(r.result.truncated).toBe(true)
    expect(r.detection!.reason).toMatch(/^CBOR reads without error up to the item cap/)
    expect(r.detection!.reason).not.toMatch(/every byte/)
  })

  it('honours an explicit format and the .proto', () => {
    const r = run('089601', 'cbor')
    expect(r.detection).toBeNull()
    expect(r.result.format).toBe('cbor')
    expect(r.result.errors[0].offset).toBe(1)
    const named = run('089601', 'protobuf', 'message M { int32 count = 1; }')
    expect(named.result.nodes[0].label).toBe('count (1)')
    expect(named.schema).toMatchObject({ messages: ['M'], root: 'M', errors: [] })
  })

  it('caps the warning list', () => {
    const many = '98ff' + '1801'.repeat(255)
    const r = run(many, 'cbor')
    expect(r.result.warnings.length).toBe(255)
    const big = handleDecode({ bytes: new Uint8Array([0x99, 0x03, 0x00, ...Array.from({ length: 768 }, () => [0x18, 0x01]).flat()]), format: 'cbor', options: { packed: false, proto: '', root: '' } })
    expect(big.result.warnings.length).toBe(501)
    expect(big.result.warnings.at(-1)!.message).toMatch(/and 268 more warnings/)
  })
})
