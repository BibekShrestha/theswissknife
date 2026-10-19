/**
 * Schemaless CBOR (RFC 8949) decoder. Reads a CBOR sequence (RFC 8742): one
 * or more items back to back. Every length is checked against the bytes
 * left before anything is sliced or looped over, so a declared length of
 * 2^64 is an error at its offset, never an allocation; nesting is capped at
 * MAX_DEPTH and the item count at the Budget.
 *
 * Besides decoding, it notes everything that breaks the deterministic
 * encoding rules of §4.2.1 (preferred serialization, no indefinite lengths,
 * bytewise-sorted map keys) as warnings with their offsets.
 */

import { MAX_DEPTH, type DecodeResult, type DNode, type Issue } from './types'
import {
  Budget,
  DecodeError,
  bytesToBigint,
  closeOpen,
  compareRanges,
  epochToIso,
  fitsHalf,
  fitsSingle,
  formatFloat,
  halfToNumber,
  hexByte,
  hexRange,
  isPrintable,
  quote,
  utf8,
} from './util'

interface Ctx {
  b: Uint8Array
  pos: number
  end: number
  budget: Budget
  warnings: Issue[]
}

/** What a tag needs to know about its content beyond the display node. */
interface Item {
  node: DNode
  major: number
  int?: bigint
  num?: number
  bytes?: Uint8Array | null
  text?: string | null
  elems?: Item[]
  /** Definite-length byte string: where its content starts (for tag 24). */
  contentStart?: number
}

interface Head {
  major: number
  ai: number
  /** -1n for indefinite length (ai 31). */
  arg: bigint
  start: number
}

const majorName = ['unsigned integer', 'negative integer', 'byte string', 'text string', 'array', 'map', 'tag', 'simple/float']

export const tagNames: Record<string, string> = {
  0: 'Standard date/time string (RFC 3339)',
  1: 'Epoch-based date/time',
  2: 'Unsigned bignum',
  3: 'Negative bignum',
  4: 'Decimal fraction',
  5: 'Bigfloat',
  16: 'COSE_Encrypt0',
  17: 'COSE_Mac0',
  18: 'COSE_Sign1',
  21: 'Expected conversion to base64url',
  22: 'Expected conversion to base64',
  23: 'Expected conversion to base16',
  24: 'Encoded CBOR data item',
  32: 'URI',
  33: 'base64url text',
  34: 'base64 text',
  35: 'Regular expression',
  36: 'MIME message',
  37: 'UUID',
  61: 'CBOR Web Token (CWT)',
  96: 'COSE_Encrypt',
  97: 'COSE_Mac',
  98: 'COSE_Sign',
  100: 'Days since 1970-01-01',
  258: 'Set',
  1004: 'Full date (RFC 3339)',
  55799: 'Self-described CBOR',
}

const warn = (ctx: Ctx, node: DNode, offset: number, text: string) => {
  ctx.warnings.push({ offset, message: text })
  ;(node.notes ??= []).push({ level: 'warn', text })
}

const info = (node: DNode, text: string) => {
  ;(node.notes ??= []).push({ level: 'info', text })
}

function need(ctx: Ctx, count: number, start: number, what: string) {
  if (count > ctx.end - ctx.pos) {
    throw new DecodeError(start, `${what} needs ${count} more bytes, only ${ctx.end - ctx.pos} left`)
  }
}

function readHead(ctx: Ctx): Head {
  const start = ctx.pos
  const ib = ctx.b[ctx.pos++]
  const major = ib >> 5
  const ai = ib & 31
  let arg = 0n
  if (ai < 24) arg = BigInt(ai)
  else if (ai <= 27) {
    const size = 1 << (ai - 24)
    need(ctx, size, start, `Initial byte 0x${hexByte(ib)}`)
    let value = 0n
    for (let i = 0; i < size; i++) value = (value << 8n) | BigInt(ctx.b[ctx.pos++])
    arg = value
  } else if (ai <= 30) {
    throw new DecodeError(start, `Initial byte 0x${hexByte(ib)} uses reserved additional information ${ai} — not well-formed`)
  } else {
    arg = -1n
  }
  return { major, ai, arg, start }
}

/** Preferred serialization: the argument must use the shortest of the five forms. */
function checkShortest(ctx: Ctx, node: DNode, h: Head) {
  const { ai, arg } = h
  const limit = ai === 24 ? 24n : ai === 25 ? 0x100n : ai === 26 ? 0x10000n : ai === 27 ? 0x1_0000_0000n : -1n
  if (limit > 0n && arg < limit) {
    warn(ctx, node, h.start, `Not deterministic: ${arg} is written with ${1 << (ai - 24)} argument bytes where ${arg < 24n ? 'none' : 'fewer'} would do`)
  }
}

function lengthOf(ctx: Ctx, h: Head, perItem: number, what: string): number {
  const left = ctx.end - ctx.pos
  if (h.arg * BigInt(perItem) > BigInt(left)) {
    throw new DecodeError(h.start, `${what} of length ${h.arg} cannot fit in the ${left} bytes left`)
  }
  return Number(h.arg)
}

function keyPreview(key: DNode): string {
  const text = key.value ?? key.kind
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

function decodeItem(ctx: Ctx, depth: number, out: DNode[], label: string, key?: DNode): Item {
  if (ctx.pos >= ctx.end) throw new DecodeError(ctx.pos, 'Unexpected end of input — another item was expected')
  if (depth > MAX_DEPTH) throw new DecodeError(ctx.pos, `Nested more than ${MAX_DEPTH} levels deep — stopped here`)
  ctx.budget.take(ctx.pos)
  const h = readHead(ctx)
  const node: DNode = { label, kind: majorName[h.major], start: h.start, end: -1, head: ctx.pos }
  if (key) node.key = key
  out.push(node)
  const item: Item = { node, major: h.major }
  if (h.major !== 7 && h.arg >= 0n) checkShortest(ctx, node, h)
  if (h.arg < 0n && (h.major < 2 || h.major === 6)) {
    throw new DecodeError(h.start, `Major type ${h.major} (${majorName[h.major]}) cannot have an indefinite length — not well-formed`)
  }

  switch (h.major) {
    case 0:
      node.kind = 'uint'
      item.int = h.arg
      node.value = h.arg.toString()
      break
    case 1:
      node.kind = 'nint'
      item.int = -1n - h.arg
      node.value = item.int.toString()
      break
    case 2:
    case 3:
      decodeString(ctx, depth, h, item)
      break
    case 4:
      decodeArray(ctx, depth, h, item)
      break
    case 5:
      decodeMap(ctx, depth, h, item)
      break
    case 6:
      decodeTag(ctx, depth, h, item)
      break
    default:
      decodeSimple(ctx, h, item)
  }
  node.end = ctx.pos
  return item
}

function decodeString(ctx: Ctx, depth: number, h: Head, item: Item) {
  const node = item.node
  const text = h.major === 3
  node.kind = text ? 'text' : 'bytes'
  if (h.arg >= 0n) {
    const len = lengthOf(ctx, h, 1, text ? 'Text string' : 'Byte string')
    const bytes = ctx.b.subarray(ctx.pos, ctx.pos + len)
    item.contentStart = ctx.pos
    ctx.pos += len
    item.bytes = bytes
    if (text) {
      const decoded = utf8(bytes)
      item.text = decoded
      if (decoded === null) {
        warn(ctx, node, h.start, 'Text string is not valid UTF-8 — shown as bytes')
        node.value = `h'${hexRange(bytes, 0, len)}'`
      } else {
        node.value = quote(decoded)
        if (!isPrintable(decoded)) info(node, 'Contains control characters')
      }
    } else {
      node.value = `h'${hexRange(bytes, 0, len)}'`
      const asText = len ? utf8(bytes) : null
      if (asText && isPrintable(asText)) node.readings = [{ name: 'as UTF-8', value: quote(asText) }]
    }
    node.readings = [...(node.readings ?? []), { name: 'length', value: `${len} bytes` }]
    return
  }

  // Indefinite length: definite chunks of the same major type until a break.
  node.syn = 'chunks'
  node.indef = true
  node.children = []
  warn(ctx, node, h.start, 'Not deterministic: indefinite-length string')
  const parts: Uint8Array[] = []
  let total = 0
  let texts: string[] | null = text ? [] : null
  let index = 0
  for (;;) {
    if (ctx.pos >= ctx.end) throw new DecodeError(ctx.pos, 'Indefinite-length string has no break (0xff) before the end')
    if (ctx.b[ctx.pos] === 0xff) {
      ctx.pos++
      break
    }
    if (depth + 1 > MAX_DEPTH) throw new DecodeError(ctx.pos, `Nested more than ${MAX_DEPTH} levels deep — stopped here`)
    ctx.budget.take(ctx.pos)
    const ch = readHead(ctx)
    if (ch.major !== h.major || ch.arg < 0n) {
      throw new DecodeError(ch.start, `A chunk of an indefinite-length ${text ? 'text' : 'byte'} string must be a definite-length ${text ? 'text' : 'byte'} string — not well-formed`)
    }
    const len = lengthOf(ctx, ch, 1, 'Chunk')
    const bytes = ctx.b.subarray(ctx.pos, ctx.pos + len)
    const chunk: DNode = { label: `chunk ${index++}`, kind: text ? 'text' : 'bytes', start: ch.start, head: ctx.pos, end: ctx.pos + len }
    checkShortest(ctx, chunk, ch)
    ctx.pos += len
    if (text) {
      const decoded = utf8(bytes)
      if (decoded === null) {
        warn(ctx, chunk, ch.start, 'Chunk is not valid UTF-8 on its own')
        chunk.value = `h'${hexRange(bytes, 0, len)}'`
        texts = null
      } else {
        chunk.value = quote(decoded)
        texts?.push(decoded)
      }
    } else {
      chunk.value = `h'${hexRange(bytes, 0, len)}'`
    }
    node.children.push(chunk)
    total += len
    if (total <= 65536) parts.push(bytes)
  }
  if (total <= 65536) {
    const joined = new Uint8Array(total)
    let at = 0
    for (const part of parts) {
      joined.set(part, at)
      at += part.length
    }
    item.bytes = joined
  } else item.bytes = null
  if (texts) {
    item.text = texts.join('')
    node.value = quote(item.text)
  } else if (item.bytes) {
    node.value = `h'${hexRange(item.bytes, 0, item.bytes.length)}'`
  } else {
    node.value = `${total.toLocaleString('en-US')} bytes in ${node.children.length} chunks`
  }
  node.readings = [{ name: 'length', value: `${total} bytes in ${node.children.length} chunks` }]
}

function decodeArray(ctx: Ctx, depth: number, h: Head, item: Item) {
  const node = item.node
  node.syn = 'array'
  node.children = []
  const elems: Item[] = []
  if (h.arg >= 0n) {
    const count = lengthOf(ctx, h, 1, 'Array')
    node.kind = `array(${count})`
    for (let i = 0; i < count; i++) {
      const elem = decodeItem(ctx, depth + 1, node.children, `[${i}]`)
      if (count <= 2) elems.push(elem)
    }
  } else {
    node.indef = true
    node.kind = 'array(_)'
    warn(ctx, node, h.start, 'Not deterministic: indefinite-length array')
    for (let i = 0; ; i++) {
      if (ctx.pos >= ctx.end) throw new DecodeError(ctx.pos, 'Indefinite-length array has no break (0xff) before the end')
      if (ctx.b[ctx.pos] === 0xff) {
        ctx.pos++
        break
      }
      const elem = decodeItem(ctx, depth + 1, node.children, `[${i}]`)
      if (i < 3) elems.push(elem)
    }
    node.kind = `array(_ ${node.children.length})`
  }
  item.elems = elems
  node.value = `${node.children.length} ${node.children.length === 1 ? 'item' : 'items'}`
}

function decodeMap(ctx: Ctx, depth: number, h: Head, item: Item) {
  const node = item.node
  node.syn = 'map'
  node.children = []
  const definite = h.arg >= 0n
  const count = definite ? lengthOf(ctx, h, 2, 'Map') : -1
  if (!definite) {
    node.indef = true
    warn(ctx, node, h.start, 'Not deterministic: indefinite-length map')
  }
  node.kind = definite ? `map(${count})` : 'map(_)'
  let previous: [number, number] | null = null
  let unsorted = false
  const seen = new Set<string>()
  for (let i = 0; definite ? i < count : true; i++) {
    if (!definite) {
      if (ctx.pos >= ctx.end) throw new DecodeError(ctx.pos, 'Indefinite-length map has no break (0xff) before the end')
      if (ctx.b[ctx.pos] === 0xff) {
        ctx.pos++
        break
      }
    }
    const holder: DNode[] = []
    const keyItem = decodeItem(ctx, depth + 1, holder, 'key')
    const keyNode = keyItem.node
    const range: [number, number] = [keyNode.start, keyNode.end]
    if (!definite && ctx.pos < ctx.end && ctx.b[ctx.pos] === 0xff) {
      throw new DecodeError(ctx.pos, 'Map ends (break) after a key with no value — not well-formed')
    }
    const valueItem = decodeItem(ctx, depth + 1, node.children, keyPreview(keyNode), keyNode)
    if (previous && !unsorted && compareRanges(ctx.b, previous, range) > 0) {
      unsorted = true
      warn(ctx, valueItem.node, keyNode.start, 'Not deterministic: map keys are not in bytewise lexicographic order of their encodings')
    }
    if (range[1] - range[0] <= 256) {
      const sig = hexRange(ctx.b, range[0], range[1], 256)
      if (seen.has(sig)) warn(ctx, valueItem.node, keyNode.start, `Duplicate map key ${keyPreview(keyNode)} — decoders disagree on which value wins`)
      seen.add(sig)
    }
    previous = range
  }
  if (!definite) node.kind = `map(_ ${node.children.length})`
  node.value = `${node.children.length} ${node.children.length === 1 ? 'pair' : 'pairs'}`
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/

/** Exact decimal of m × 10^e, or null when the exponent is absurd. */
function decimalString(m: bigint, e: bigint): string | null {
  if (e > 1000n || e < -1000n) return null
  const neg = m < 0n
  let digits = (neg ? -m : m).toString()
  const exp = Number(e)
  if (exp >= 0) digits = m === 0n ? '0' : digits + '0'.repeat(exp)
  else {
    const places = -exp
    digits = digits.padStart(places + 1, '0')
    digits = `${digits.slice(0, digits.length - places)}.${digits.slice(digits.length - places)}`.replace(/\.?0+$/, '')
  }
  return (neg && m !== 0n ? '-' : '') + digits
}

/** Exact decimal of m × 2^e. */
function bigfloatString(m: bigint, e: bigint): string | null {
  if (e > 4096n || e < -1100n) return null
  if (e >= 0n) return (m << e).toString()
  return decimalString(m * 5n ** -e, e)
}

/** An integer, or a bignum tag (which carries its value on the tag item). */
const integerOf = (item: Item): bigint | null => item.int ?? null

function decodeTag(ctx: Ctx, depth: number, h: Head, item: Item) {
  const node = item.node
  const tag = h.arg
  node.syn = 'tag'
  node.tag = tag.toString()
  node.kind = `tag ${tag}`
  node.children = []
  const content = decodeItem(ctx, depth + 1, node.children, 'content')
  const name = tagNames[node.tag]
  node.readings = [{ name: 'tag', value: name ? `${tag} — ${name}` : `${tag} — not one this decoder knows` }]
  const c = content.node
  node.value = `${tag}(${c.value ?? c.kind})`

  const expect = (ok: boolean, what: string) => {
    if (!ok) warn(ctx, node, h.start, `Tag ${tag} expects ${what}, found ${c.kind}`)
    return ok
  }

  switch (Number(tag)) {
    case 0:
      if (expect(content.major === 3 && typeof content.text === 'string', 'a text string')) {
        node.value = content.text!
        if (!RFC3339.test(content.text!)) warn(ctx, node, h.start, 'Tag 0 text is not an RFC 3339 date-time')
      }
      break
    case 1: {
      const seconds = content.int !== undefined ? Number(content.int) : content.num
      if (expect(seconds !== undefined, 'an integer or float')) {
        const iso = epochToIso(seconds!)
        node.value = iso ?? `${c.value} s (outside the representable date range)`
      }
      break
    }
    case 2:
    case 3:
      if (expect(content.major === 2, 'a byte string')) {
        if (content.bytes) {
          const n = bytesToBigint(content.bytes)
          if (n === null) node.value = `${content.bytes.length}-byte bignum (too long to print in decimal)`
          else {
            item.int = tag === 2n ? n : -1n - n
            node.value = item.int.toString()
            if (n < 0x1_0000_0000_0000_0000n) warn(ctx, node, h.start, `Not preferred: this bignum fits in a plain ${tag === 2n ? 'unsigned' : 'negative'} integer`)
            else if (content.bytes[0] === 0) warn(ctx, node, h.start, 'Not preferred: bignum has leading zero bytes')
          }
        }
      }
      break
    case 4:
    case 5: {
      const pair = content.elems
      if (expect(content.major === 4 && pair?.length === 2 && c.children?.length === 2, 'an array of [exponent, mantissa]')) {
        const e = pair![0].major <= 1 ? pair![0].int : undefined
        const m = integerOf(pair![1])
        if (e === undefined || m === null) warn(ctx, node, h.start, `Tag ${tag} needs an integer exponent and an integer or bignum mantissa`)
        else {
          const exact = tag === 4n ? decimalString(m, e) : bigfloatString(m, e)
          const formula = `${m} × ${tag === 4n ? 10 : 2}^${e}`
          node.value = exact ? `${exact} (${formula})` : formula
        }
      }
      break
    }
    case 24:
      if (expect(content.major === 2, 'a byte string') && content.contentStart !== undefined && content.bytes) {
        const views = embedded(ctx, depth, content.contentStart, content.contentStart + content.bytes.length)
        if (views) {
          node.views = [{ name: 'embedded CBOR', value: views.value, children: views.children }, { name: 'tag content', value: c.value ?? '', children: node.children }]
          node.view = 0
          node.value = `24(<<${views.value}>>)`
        } else info(node, 'Content is not a single well-formed CBOR item')
      }
      break
    case 32:
    case 33:
    case 34:
    case 35:
    case 36:
    case 1004:
      if (expect(content.major === 3, 'a text string') && typeof content.text === 'string') node.value = content.text
      break
    case 37:
      if (expect(content.major === 2 && content.bytes?.length === 16, 'a 16-byte byte string') && content.bytes) {
        const hex = hexRange(content.bytes, 0, 16)
        node.value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      }
      break
    case 100:
      if (expect(content.major <= 1, 'an integer') && content.int !== undefined) {
        const iso = epochToIso(Number(content.int) * 86400)
        if (iso) node.value = iso.slice(0, 10)
      }
      break
    case 55799:
      info(node, 'Magic number marking the bytes as CBOR (0xd9d9f7)')
      node.value = c.value ?? c.kind
      break
  }
}

/** Tag 24's content read as one CBOR item; null when it is not exactly one. */
function embedded(ctx: Ctx, depth: number, start: number, end: number): { value: string; children: DNode[] } | null {
  const inner: Ctx = { b: ctx.b, pos: start, end, budget: ctx.budget, warnings: [] }
  const children: DNode[] = []
  try {
    const it = decodeItem(inner, depth + 1, children, 'embedded')
    if (inner.pos !== end) return null
    ctx.warnings.push(...inner.warnings)
    return { value: it.node.value ?? it.node.kind, children }
  } catch (error) {
    if (error instanceof DecodeError && !error.limit) return null
    throw error
  }
}

function decodeSimple(ctx: Ctx, h: Head, item: Item) {
  const node = item.node
  const { ai, start } = h
  const b = ctx.b
  if (ai < 20) {
    node.kind = 'simple'
    node.value = `simple(${ai})`
    info(node, 'Unassigned simple value')
    return
  }
  switch (ai) {
    case 20:
    case 21:
      node.kind = 'bool'
      node.value = ai === 21 ? 'true' : 'false'
      return
    case 22:
      node.kind = 'null'
      node.value = 'null'
      return
    case 23:
      node.kind = 'undefined'
      node.value = 'undefined'
      return
    case 24: {
      const v = Number(h.arg)
      if (v < 32) throw new DecodeError(start, `simple(${v}) must be written in the initial byte, not with 0xf8 — not well-formed`)
      node.kind = 'simple'
      node.value = `simple(${v})`
      info(node, 'Unassigned simple value')
      return
    }
    case 25: {
      const bits = Number(h.arg)
      const x = halfToNumber(bits)
      node.kind = 'float16'
      item.num = x
      node.value = formatFloat(x)
      if (Number.isNaN(x) && bits !== 0x7e00) warn(ctx, node, start, 'Not deterministic: NaN with a payload (preferred NaN is 0xf97e00)')
      break
    }
    case 26: {
      const x = new DataView(b.buffer, b.byteOffset + start + 1, 4).getFloat32(0)
      node.kind = 'float32'
      item.num = x
      node.value = formatFloat(x)
      if (fitsHalf(x)) warn(ctx, node, start, `Not deterministic: ${Number.isNaN(x) ? 'NaN' : node.value} fits in a float16`)
      break
    }
    case 27: {
      const x = new DataView(b.buffer, b.byteOffset + start + 1, 8).getFloat64(0)
      node.kind = 'float64'
      item.num = x
      node.value = formatFloat(x)
      if (fitsSingle(x)) warn(ctx, node, start, `Not deterministic: ${Number.isNaN(x) ? 'NaN' : node.value} fits in a ${fitsHalf(x) ? 'float16' : 'float32'}`)
      break
    }
    default:
      throw new DecodeError(start, 'Unexpected break (0xff) outside an indefinite-length item')
  }
}

export function decodeCbor(bytes: Uint8Array, budget = new Budget()): DecodeResult {
  const ctx: Ctx = { b: bytes, pos: 0, end: bytes.length, budget, warnings: [] }
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
  return { format: 'cbor', nodes, errors, warnings: ctx.warnings, truncated, consumed: ctx.pos, items: nodes.length }
}

