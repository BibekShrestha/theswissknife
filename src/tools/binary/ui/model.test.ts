import { describe, expect, it } from 'vitest'
import { decodeCbor } from '../cbor'
import { handleDecode } from '../decode'
import { decodeProtobuf } from '../protobuf'
import { samples } from '../samples'
import { hex } from '../testkit'
import type { Format } from '../types'
import { displayOf, flatten, hexWindow, initialExpansion, MAX_SCROLL_PX, nodeAt, pathTo, scrollTopForRow } from './model'

describe('tree model', () => {
  const roots = decodeCbor(hex('8301820203820405')).nodes

  it('flattens only expanded nodes, with levels and positions', () => {
    expect(flatten(roots, new Set(), new Map()).map((r) => r.id)).toEqual(['0'])
    const rows = flatten(roots, new Set(['0', '0.1']), new Map())
    expect(rows.map((r) => [r.id, r.depth, r.posinset, r.setsize, r.hasChildren, r.expanded])).toEqual([
      ['0', 0, 1, 1, true, true],
      ['0.0', 1, 1, 3, false, false],
      ['0.1', 1, 2, 3, true, true],
      ['0.1.0', 2, 1, 2, false, false],
      ['0.1.1', 2, 2, 2, false, false],
      ['0.2', 1, 3, 3, true, false],
    ])
  })

  it('expands breadth-first within a row budget', () => {
    expect([...initialExpansion(roots, new Map())]).toEqual(['0', '0.1', '0.2'])
    expect([...initialExpansion(roots, new Map(), 4)]).toEqual(['0'])
  })

  it('follows the chosen reading of a node', () => {
    const pb = decodeProtobuf(hex('0a020810'), { packed: true }).nodes
    const viewNames = pb[0].views!.map((v) => v.name)
    const message = flatten(pb, new Set(['0']), new Map())
    expect(message.map((r) => r.id)).toEqual(['0', '0v0.0'])
    const packed = flatten(pb, new Set(['0']), new Map([['0', viewNames.indexOf('packed varint')]]))
    expect(packed.map((r) => [r.id, r.node.value])).toEqual([['0', pb[0].value], ['0v2.0', '8'], ['0v2.1', '16']])
  })

  it('finds the innermost node at an offset, keys included', () => {
    expect(pathTo(roots, 4, new Map())).toEqual(['0', '0.1', '0.1.1'])
    expect(pathTo(roots, 0, new Map())).toEqual(['0'])
    expect(pathTo(roots, 99, new Map())).toEqual([])
    const map = decodeCbor(hex('a26161016162820203')).nodes
    expect(pathTo(map, 1, new Map())).toEqual(['0', '0.0'])
    expect(pathTo(decodeProtobuf(hex('1a03089601')).nodes, 3, new Map())).toEqual(['0', '0v0.0'])
  })
})

describe('node lookup', () => {
  it('resolves ids, including chosen readings, and rejects stale ones', () => {
    const roots = decodeCbor(hex('8301820203820405')).nodes
    expect(nodeAt(roots, '0.1.1', new Map())?.value).toBe('3')
    expect(nodeAt(roots, '0.9', new Map())).toBeNull()
    const pb = decodeProtobuf(hex('0a020810'), { packed: true }).nodes
    expect(nodeAt(pb, '0v0.0', new Map())?.value).toBe('16')
    expect(nodeAt(pb, '0v2.1', new Map([['0', 2]]))?.value).toBe('16')
    expect(nodeAt(pb, '0v0.0', new Map([['0', 2]]))).toBeNull()
    expect(displayOf(pb[0], '0', new Map([['0', 2]]))).toEqual({ value: '[8, 16]', kind: 'LEN · packed varint × 2' })
  })
})

describe('hex window', () => {
  it('windows small inputs one row per row height', () => {
    expect(hexWindow(0, 200, 1000, 20)).toEqual({ first: 0, count: 11, top: 0, total: 20_000 })
    expect(hexWindow(410, 200, 1000, 20)).toEqual({ first: 20, count: 11, top: 400, total: 20_000 })
    expect(hexWindow(19_900, 200, 1000, 20).first + hexWindow(19_900, 200, 1000, 20).count).toBe(1000)
    expect(scrollTopForRow(20, 200, 1000, 20)).toBe(400)
  })

  it('scales the scroll range for inputs too tall for the browser', () => {
    const rows = 2_000_000 // 32 MiB at 16 bytes per row
    const end = hexWindow(MAX_SCROLL_PX - 200, 200, rows, 20)
    expect(end.total).toBe(MAX_SCROLL_PX)
    expect(end.first + end.count).toBe(rows)
    expect(hexWindow(0, 200, rows, 20).first).toBe(0)
    const mid = scrollTopForRow(1_000_000, 200, rows, 20)
    expect(Math.abs(hexWindow(mid, 200, rows, 20).first - 1_000_000)).toBeLessThanOrEqual(1)
  })
})

describe('samples', () => {
  it.each(['protobuf', 'cbor', 'msgpack'] as Format[])('%s sample decodes cleanly and is detected', (format) => {
    const r = handleDecode({ bytes: hex(samples[format].hex), format: 'auto', options: { packed: false, proto: '', root: '' } })
    expect(r.detection).toMatchObject({ format, confidence: 'high' })
    expect(r.result.errors).toEqual([])
  })
})
