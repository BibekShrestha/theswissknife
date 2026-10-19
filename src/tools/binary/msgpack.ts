/**
 * Schemaless MessagePack decoder covering every format in the spec,
 * including ext types and the timestamp extension (type -1, all three
 * sizes). Reads a stream: one or more objects back to back. Lengths are
 * checked against the bytes left before anything is sliced or looped over;
 * nesting is capped at MAX_DEPTH and the item count at the Budget.
 *
 * The spec asks serializers to use the shortest format, so longer ones are
 * reported as warnings (an uint 16 holding 5, a str 8 of 3 bytes…).
 */

import { MAX_DEPTH, type DecodeResult, type DNode, type Issue } from './types'
import { Budget, DecodeError, closeOpen, epochToIso, formatFloat, hexRange, isPrintable, quote, utf8 } from './util'

interface Ctx {
  b: Uint8Array
  view: DataView
  pos: number
  end: number
  budget: Budget
  warnings: Issue[]
}

const warn = (ctx: Ctx, node: DNode, offset: number, text: string) => {
  ctx.warnings.push({ offset, message: text })
  ;(node.notes ??= []).push({ level: 'warn', text })
}

function need(ctx: Ctx, count: number, start: number, what: string) {
  if (count > ctx.end - ctx.pos) {
    throw new DecodeError(start, `${what} needs ${count} more bytes, only ${ctx.end - ctx.pos} left`)
  }
}

function readUint(ctx: Ctx, size: number, start: number, what: string): number {
  need(ctx, size, start, what)
  const v = ctx.view
  const at = ctx.pos
  ctx.pos += size
  if (size === 1) return v.getUint8(at)
  if (size === 2) return v.getUint16(at)
  return v.getUint32(at)
}

const fixedSizes: Record<number, number> = { 0xd4: 1, 0xd5: 2, 0xd6: 4, 0xd7: 8, 0xd8: 16 }

function shortestUint(value: bigint): string {
  if (value < 128n) return 'a positive fixint'
  if (value < 0x100n) return 'a uint 8'
  if (value < 0x10000n) return 'a uint 16'
  return 'a uint 32'
}

function shortestInt(value: bigint): string {
  if (value >= 0n) return shortestUint(value)
  if (value >= -32n) return 'a negative fixint'
  if (value >= -128n) return 'an int 8'
  if (value >= -32768n) return 'an int 16'
  return 'an int 32'
}

function lengthName(kind: 'str' | 'bin' | 'array' | 'map', len: number): string {
  if (kind === 'str' && len < 32) return 'fixstr'
  if ((kind === 'array' || kind === 'map') && len < 16) return `fix${kind}`
  if (kind !== 'array' && kind !== 'map' && len < 0x100) return `${kind} 8`
  if (len < 0x10000) return `${kind} 16`
  return `${kind} 32`
}

function keyPreview(key: DNode): string {
  const text = key.value ?? key.kind
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

function decodeItem(ctx: Ctx, depth: number, out: DNode[], label: string, key?: DNode): DNode {
  if (ctx.pos >= ctx.end) throw new DecodeError(ctx.pos, 'Unexpected end of input — another object was expected')
  if (depth > MAX_DEPTH) throw new DecodeError(ctx.pos, `Nested more than ${MAX_DEPTH} levels deep — stopped here`)
  ctx.budget.take(ctx.pos)
  const start = ctx.pos
  const t = ctx.b[ctx.pos++]
  const node: DNode = { label, kind: '', start, end: -1, head: ctx.pos }
  if (key) node.key = key
  out.push(node)

  const finishHead = () => {
    node.head = ctx.pos
  }

  if (t <= 0x7f) {
    node.kind = 'positive fixint'
    node.value = String(t)
  } else if (t <= 0x8f) {
    decodeMap(ctx, depth, node, t & 0x0f, 'fixmap')
  } else if (t <= 0x9f) {
    decodeArray(ctx, depth, node, t & 0x0f, 'fixarray')
  } else if (t <= 0xbf) {
    decodeStr(ctx, node, t & 0x1f, 'fixstr')
  } else if (t >= 0xe0) {
    node.kind = 'negative fixint'
    node.value = String(t - 256)
  } else {
    switch (t) {
      case 0xc0:
        node.kind = 'nil'
        node.value = 'null'
        break
      case 0xc1:
        throw new DecodeError(start, 'Type byte 0xc1 is never used in MessagePack')
      case 0xc2:
      case 0xc3:
        node.kind = 'bool'
        node.value = t === 0xc3 ? 'true' : 'false'
        break
      case 0xc4:
      case 0xc5:
      case 0xc6: {
        const size = 1 << (t - 0xc4)
        const kind = `bin ${size * 8}`
        const len = readUint(ctx, size, start, kind)
        finishHead()
        decodeBin(ctx, node, len, kind)
        break
      }
      case 0xc7:
      case 0xc8:
      case 0xc9: {
        const size = 1 << (t - 0xc7)
        const kind = `ext ${size * 8}`
        const len = readUint(ctx, size, start, kind)
        need(ctx, 1, start, kind)
        const type = ctx.view.getInt8(ctx.pos++)
        finishHead()
        node.kind = kind
        const best = lengthName('bin', len).replace('bin', 'ext')
        if ([1, 2, 4, 8, 16].includes(len)) warn(ctx, node, start, `Not the shortest form: a ${len}-byte ext fits in a fixext ${len}`)
        else if (best !== kind) warn(ctx, node, start, `Not the shortest form: ${len} bytes fit in an ${best}`)
        decodeExt(ctx, node, type, len)
        break
      }
      case 0xca: {
        need(ctx, 4, start, 'float 32')
        const x = ctx.view.getFloat32(ctx.pos)
        ctx.pos += 4
        node.kind = 'float 32'
        node.value = formatFloat(x)
        break
      }
      case 0xcb: {
        need(ctx, 8, start, 'float 64')
        const x = ctx.view.getFloat64(ctx.pos)
        ctx.pos += 8
        node.kind = 'float 64'
        node.value = formatFloat(x)
        break
      }
      case 0xcc:
      case 0xcd:
      case 0xce:
      case 0xcf: {
        const size = 1 << (t - 0xcc)
        node.kind = `uint ${size * 8}`
        need(ctx, size, start, node.kind)
        const value = size === 8 ? ctx.view.getBigUint64(ctx.pos) : BigInt(readUint(ctx, size, start, node.kind))
        if (size === 8) ctx.pos += 8
        node.value = value.toString()
        const best = shortestUint(value)
        if (best !== `a ${node.kind}`) warn(ctx, node, start, `Not the shortest form: ${value} fits in ${best}`)
        break
      }
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3: {
        const size = 1 << (t - 0xd0)
        node.kind = `int ${size * 8}`
        need(ctx, size, start, node.kind)
        const v = ctx.view
        const at = ctx.pos
        const value = size === 1 ? BigInt(v.getInt8(at)) : size === 2 ? BigInt(v.getInt16(at)) : size === 4 ? BigInt(v.getInt32(at)) : v.getBigInt64(at)
        ctx.pos += size
        node.value = value.toString()
        const best = shortestInt(value)
        if (best !== `an ${node.kind}`) warn(ctx, node, start, `Not the shortest form: ${value} fits in ${best}`)
        break
      }
      case 0xd4:
      case 0xd5:
      case 0xd6:
      case 0xd7:
      case 0xd8: {
        const len = fixedSizes[t]
        need(ctx, 1, start, 'fixext')
        const type = ctx.view.getInt8(ctx.pos++)
        finishHead()
        node.kind = `fixext ${len}`
        decodeExt(ctx, node, type, len)
        break
      }
      case 0xd9:
      case 0xda:
      case 0xdb: {
        const size = 1 << (t - 0xd9)
        const kind = `str ${size * 8}`
        decodeStr(ctx, node, readUint(ctx, size, start, kind), kind)
        break
      }
      case 0xdc:
      case 0xdd: {
        const kind = t === 0xdc ? 'array 16' : 'array 32'
        decodeArray(ctx, depth, node, readUint(ctx, t === 0xdc ? 2 : 4, start, kind), kind)
        break
      }
      case 0xde:
      case 0xdf: {
        const kind = t === 0xde ? 'map 16' : 'map 32'
        decodeMap(ctx, depth, node, readUint(ctx, t === 0xde ? 2 : 4, start, kind), kind)
        break
      }
    }
  }
  node.end = ctx.pos
  return node
}

function checkFits(ctx: Ctx, node: DNode, len: number, perItem: number, what: string) {
  const left = ctx.end - ctx.pos
  if (len * perItem > left) throw new DecodeError(node.start, `${what} of length ${len} cannot fit in the ${left} bytes left`)
}

function decodeStr(ctx: Ctx, node: DNode, len: number, kind: string) {
  node.kind = kind
  node.head = ctx.pos
  checkFits(ctx, node, len, 1, kind)
  const bytes = ctx.b.subarray(ctx.pos, ctx.pos + len)
  ctx.pos += len
  const best = lengthName('str', len)
  if (best !== kind) warn(ctx, node, node.start, `Not the shortest form: a ${len}-byte string fits in ${best === 'fixstr' ? 'a fixstr' : `a ${best}`}`)
  const text = utf8(bytes)
  if (text === null) {
    warn(ctx, node, node.start, 'String is not valid UTF-8 — shown as bytes')
    node.value = `h'${hexRange(bytes, 0, len)}'`
  } else {
    node.value = quote(text)
    if (!isPrintable(text)) (node.notes ??= []).push({ level: 'info', text: 'Contains control characters' })
  }
  node.readings = [{ name: 'length', value: `${len} bytes` }]
}

function decodeBin(ctx: Ctx, node: DNode, len: number, kind: string) {
  node.kind = kind
  checkFits(ctx, node, len, 1, kind)
  const bytes = ctx.b.subarray(ctx.pos, ctx.pos + len)
  ctx.pos += len
  const best = lengthName('bin', len)
  if (best !== kind) warn(ctx, node, node.start, `Not the shortest form: ${len} bytes fit in a ${best}`)
  node.value = `h'${hexRange(bytes, 0, len)}'`
  node.readings = [{ name: 'length', value: `${len} bytes` }]
  const text = len ? utf8(bytes) : null
  if (text && isPrintable(text)) node.readings.unshift({ name: 'as UTF-8', value: quote(text) })
}

function decodeExt(ctx: Ctx, node: DNode, type: number, len: number) {
  checkFits(ctx, node, len, 1, node.kind)
  const at = ctx.pos
  const bytes = ctx.b.subarray(at, at + len)
  ctx.pos += len
  node.readings = [
    { name: 'ext type', value: type === -1 ? '-1 (timestamp)' : type < 0 ? `${type} (reserved by the spec)` : `${type} (application-defined)` },
    { name: 'data', value: `h'${hexRange(bytes, 0, len)}' (${len} bytes)` },
  ]
  node.value = `ext(${type}, h'${hexRange(bytes, 0, len)}')`
  if (type !== -1) return
  const v = ctx.view
  let seconds: bigint
  let nanos = 0
  if (len === 4) seconds = BigInt(v.getUint32(at))
  else if (len === 8) {
    const word = v.getBigUint64(at)
    nanos = Number(word >> 34n)
    seconds = word & 0x3_ffff_ffffn
  } else if (len === 12) {
    nanos = v.getUint32(at)
    seconds = v.getBigInt64(at + 4)
  } else {
    warn(ctx, node, node.start, `Timestamp ext must hold 4, 8 or 12 bytes, not ${len}`)
    return
  }
  node.kind = `timestamp ${len * 8}`
  if (nanos > 999_999_999) {
    warn(ctx, node, node.start, `Timestamp nanoseconds ${nanos} exceed 999999999`)
    return
  }
  const iso = epochToIso(Number(seconds), nanos)
  node.value = iso ?? `${seconds} s + ${nanos} ns (outside the representable date range)`
  node.readings.unshift({ name: 'seconds', value: seconds.toString() }, { name: 'nanoseconds', value: String(nanos) })
  if (len === 8 && seconds < 0x1_0000_0000n && nanos === 0) warn(ctx, node, node.start, 'Not the shortest form: this timestamp fits in timestamp 32')
  if (len === 12 && seconds >= 0n && seconds < 0x4_0000_0000n) warn(ctx, node, node.start, 'Not the shortest form: this timestamp fits in timestamp 64')
}

function decodeArray(ctx: Ctx, depth: number, node: DNode, count: number, kind: string) {
  node.kind = `${kind} (${count})`
  node.head = ctx.pos
  node.syn = 'array'
  node.children = []
  checkFits(ctx, node, count, 1, kind)
  const best = lengthName('array', count)
  if (best !== kind) warn(ctx, node, node.start, `Not the shortest form: ${count} items fit in a ${best}`)
  for (let i = 0; i < count; i++) decodeItem(ctx, depth + 1, node.children, `[${i}]`)
  node.value = `${count} ${count === 1 ? 'item' : 'items'}`
}

function decodeMap(ctx: Ctx, depth: number, node: DNode, count: number, kind: string) {
  node.kind = `${kind} (${count})`
  node.head = ctx.pos
  node.syn = 'map'
  node.children = []
  checkFits(ctx, node, count, 2, kind)
  const best = lengthName('map', count)
  if (best !== kind) warn(ctx, node, node.start, `Not the shortest form: ${count} pairs fit in a ${best}`)
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    const holder: DNode[] = []
    const key = decodeItem(ctx, depth + 1, holder, 'key')
    const value = decodeItem(ctx, depth + 1, node.children, keyPreview(key), key)
    if (key.end - key.start <= 256) {
      const sig = hexRange(ctx.b, key.start, key.end, 256)
      if (seen.has(sig)) warn(ctx, value, key.start, `Duplicate map key ${keyPreview(key)}`)
      seen.add(sig)
    }
  }
  node.value = `${count} ${count === 1 ? 'pair' : 'pairs'}`
}

export function decodeMsgpack(bytes: Uint8Array, budget = new Budget()): DecodeResult {
  const ctx: Ctx = { b: bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0, end: bytes.length, budget, warnings: [] }
  const nodes: DNode[] = []
  const errors: Issue[] = []
  let truncated = false
  try {
    while (ctx.pos < ctx.end) decodeItem(ctx, 0, nodes, '')
  } catch (error) {
    if (!(error instanceof DecodeError)) throw error
    if (error.limit) {
      truncated = true
      ctx.warnings.push({ offset: error.offset, message: error.message })
    } else errors.push({ offset: error.offset, message: error.message })
    closeOpen(nodes, error.offset)
  }
  nodes.forEach((node, i) => {
    node.label = nodes.length === 1 ? 'root' : `item ${i}`
  })
  if (!bytes.length) errors.push({ offset: 0, message: 'No bytes to decode' })
  return { format: 'msgpack', nodes, errors, warnings: ctx.warnings, truncated, consumed: ctx.pos, items: nodes.length }
}

