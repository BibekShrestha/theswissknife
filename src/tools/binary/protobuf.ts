/**
 * Schemaless Protobuf wire-format decoder. Every field shows its number and
 * wire type; scalars carry each reading the wire allows (a varint as
 * unsigned, two's-complement signed and zigzag; I32/I64 as int, uint and
 * float), and length-delimited fields carry every plausible view — nested
 * message, UTF-8 text, packed repeated numbers (when asked for) and raw
 * bytes — with a default picked by plausibility, or by the .proto when one
 * is given.
 *
 * Bounds: every length is checked against the bytes left; nesting is
 * capped at MAX_DEPTH; nodes are counted by the Budget (speculative views
 * that fail are refunded); and trying fields as nested messages stops after
 * MAX_WORK field reads, so a deeply self-similar input stays linear-ish.
 */

import type { FieldDef, MessageDef, ProtoSchema } from './proto-schema'
import { MAX_DEPTH, type DecodeResult, type DNode, type Issue, type Reading, type View } from './types'
import { Budget, DecodeError, formatFloat, formatFloat32, hexRange, isPrintable, quote, utf8 } from './util'

export interface ProtobufOptions {
  /** Also offer length-delimited fields as packed varints / fixed32 / fixed64. */
  packed?: boolean
  schema?: ProtoSchema | null
  /** The message type of the whole input (from the schema). */
  root?: MessageDef | null
}

/** Field reads after which nested-message attempts stop (they can revisit bytes once per nesting level). */
export const MAX_WORK = 4_000_000
/** Packed views stop adding element nodes after this many. */
const PACKED_CAP = 10_000
/** Element nodes all schemaless packed views together may add. */
const PACKED_TOTAL = 30_000
/** A length-delimited field this long that already reads as a message is not also tried as text. */
const TEXT_TRY_CAP = 1 << 20

const WIRE = ['VARINT', 'I64', 'LEN', 'SGROUP', 'EGROUP', 'I32']

interface Ctx {
  b: Uint8Array
  budget: Budget
  packed: boolean
  schema: ProtoSchema | null
  warnings: Issue[]
  work: number
  workNoted: boolean
  packedLeft: number
}

type Varint = { value: bigint; next: number } | { error: string }

export function readVarint(b: Uint8Array, pos: number, end: number): Varint {
  let value = 0n
  for (let n = 0; n < 10; n++) {
    if (pos + n >= end) return { error: 'varint runs past the end of the data' }
    const byte = b[pos + n]
    if (n === 9 && byte > 1) return { error: 'varint is wider than 64 bits' }
    value |= BigInt(byte & 0x7f) << BigInt(7 * n)
    if (!(byte & 0x80)) return { value, next: pos + n + 1 }
  }
  return { error: 'varint is longer than 10 bytes' }
}

const varintSize = (v: bigint) => {
  let n = 1
  while (v >= 0x80n) {
    v >>= 7n
    n++
  }
  return n
}

export const zigzag = (v: bigint): bigint => (v >> 1n) ^ -(v & 1n)

export function varintReadings(v: bigint): Reading[] {
  const signed = BigInt.asIntN(64, v)
  const readings: Reading[] = [
    { name: 'unsigned (uint64)', value: v.toString() },
    { name: 'signed (int64)', value: signed.toString() },
    { name: 'zigzag (sint64)', value: zigzag(v).toString() },
  ]
  if (v <= 1n) readings.push({ name: 'bool', value: v ? 'true' : 'false' })
  return readings
}

/** A float that reads like a number someone wrote (1.5, -273.15), rather than reinterpreted integer bits. */
function niceFloat(x: number): boolean {
  if (x === 0) return true
  if (!Number.isFinite(x)) return false
  const a = Math.abs(x)
  return a >= 1e-12 && a < 1e15
}

const shortName = (full: string) => full.slice(full.lastIndexOf('.') + 1)

const VARINT_TYPES = new Set(['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'bool'])
const I64_TYPES = new Set(['fixed64', 'sfixed64', 'double'])
const I32_TYPES = new Set(['fixed32', 'sfixed32', 'float'])

function expectedWire(field: FieldDef): number {
  if (field.kind === 'enum' || VARINT_TYPES.has(field.type)) return 0
  if (I64_TYPES.has(field.type)) return 1
  if (I32_TYPES.has(field.type)) return 5
  return 2
}

function typedVarint(ctx: Ctx, field: FieldDef, v: bigint): string | null {
  switch (field.type) {
    case 'int32':
      return BigInt.asIntN(32, v).toString()
    case 'int64':
      return BigInt.asIntN(64, v).toString()
    case 'uint32':
      return BigInt.asUintN(32, v).toString()
    case 'uint64':
      return v.toString()
    case 'sint32':
      return zigzag(BigInt.asUintN(32, v)).toString()
    case 'sint64':
      return zigzag(v).toString()
    case 'bool':
      return v ? 'true' : 'false'
  }
  if (field.kind === 'enum') {
    const n = Number(BigInt.asIntN(32, v))
    const name = ctx.schema?.enums.get(field.type)?.get(n)
    return name ? `${name} (${n})` : `${n} (not a value of ${shortName(field.type)})`
  }
  return null
}

function fixed32Readings(view: DataView, at: number): { readings: Reading[]; int: string; float: string; floatNice: boolean } {
  const u = view.getUint32(at, true)
  const i = view.getInt32(at, true)
  const f = view.getFloat32(at, true)
  const float = formatFloat32(f)
  return {
    readings: [
      { name: 'unsigned (fixed32)', value: String(u) },
      { name: 'signed (sfixed32)', value: String(i) },
      { name: 'float', value: float },
    ],
    int: String(i),
    float,
    floatNice: niceFloat(f) && Math.abs(i) >= 1 << 24,
  }
}

function fixed64Readings(view: DataView, at: number): { readings: Reading[]; int: string; float: string; floatNice: boolean } {
  const u = view.getBigUint64(at, true)
  const i = view.getBigInt64(at, true)
  const f = view.getFloat64(at, true)
  const float = formatFloat(f)
  return {
    readings: [
      { name: 'unsigned (fixed64)', value: u.toString() },
      { name: 'signed (sfixed64)', value: i.toString() },
      { name: 'double', value: float },
    ],
    int: i.toString(),
    float,
    floatNice: niceFloat(f) && (i >= 1n << 40n || i <= -(1n << 40n)),
  }
}

function typedFixed(field: FieldDef, r: { readings: Reading[] }): string | null {
  const pick = (prefix: string) => r.readings.find((x) => x.name.startsWith(prefix))?.value ?? null
  switch (field.type) {
    case 'fixed32':
    case 'fixed64':
      return pick('unsigned')
    case 'sfixed32':
    case 'sfixed64':
      return pick('signed')
    case 'float':
    case 'double':
      return pick(field.type === 'float' ? 'float' : 'double')
  }
  return null
}

interface Parsed {
  pos: number
  error: Issue | null
  /** True when a group's end-group tag closed it. */
  closed: boolean
}

function fieldLabel(number: number, field: FieldDef | undefined): string {
  return field ? `${field.name} (${number})` : String(number)
}

function note(node: DNode, level: 'warn' | 'info', text: string) {
  ;(node.notes ??= []).push({ level, text })
}

function warnNode(ctx: Ctx, node: DNode, text: string) {
  note(node, 'warn', text)
  ctx.warnings.push({ offset: node.start, message: `Field ${node.label}: ${text}` })
}

/**
 * Reads fields from start to end into `out`. Errors are returned, not
 * thrown (a failed nested attempt just means "not a message"); only the
 * Budget's limit throws, and it ends the whole decode.
 */
function parseFields(ctx: Ctx, start: number, end: number, depth: number, msg: MessageDef | null, group: number | null, out: DNode[]): Parsed {
  const b = ctx.b
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let pos = start
  const fail = (offset: number, message: string): Parsed => ({ pos, error: { offset, message }, closed: false })
  while (pos < end) {
    ctx.work++
    const tagStart = pos
    const tag = readVarint(b, pos, end)
    if ('error' in tag) return fail(pos, `Field tag: ${tag.error}`)
    if (tag.value > 0xffff_ffffn) return fail(pos, 'Field tag is wider than 32 bits')
    const number = Number(tag.value >> 3n)
    const wt = Number(tag.value & 7n)
    if (number === 0) return fail(pos, 'Field number 0 is not allowed')
    if (wt === 6 || wt === 7) return fail(pos, `Invalid wire type ${wt} (field ${number})`)
    pos = tag.next
    if (wt === 4) {
      if (group === number) return { pos, error: null, closed: true }
      return fail(tagStart, group === null ? `End-group tag for field ${number} with no group open` : `End-group tag for field ${number} inside group ${group}`)
    }
    ctx.budget.take(tagStart)
    const field = msg?.fields.get(number)
    const node: DNode = { label: fieldLabel(number, field), kind: WIRE[wt], start: tagStart, head: pos, end: pos }
    if (number >= 19000 && number <= 19999) note(node, 'info', 'Field numbers 19000–19999 are reserved for the protobuf implementation')
    if (field) {
      node.readings = [{ name: 'declared', value: `${field.label ? `${field.label} ` : ''}${field.written}` }]
      const want = expectedWire(field)
      const packedOk = wt === 2 && field.label === 'repeated' && want !== 2
      if (field.kind !== 'unknown' && want !== wt && !packedOk) warnNode(ctx, node, `declared ${field.written}, but sent as ${WIRE[wt]}`)
    }

    if (wt === 0) {
      const v = readVarint(b, pos, end)
      if ('error' in v) return fail(pos, `Field ${number}: ${v.error}`)
      const size = v.next - pos
      pos = v.next
      node.end = pos
      node.readings = [...(node.readings ?? []), ...varintReadings(v.value)]
      node.value = (field && typedVarint(ctx, field, v.value)) ?? v.value.toString()
      if (size > varintSize(v.value)) note(node, 'info', `Over-long varint: ${size} bytes where ${varintSize(v.value)} would do`)
    } else if (wt === 1 || wt === 5) {
      const size = wt === 1 ? 8 : 4
      if (end - pos < size) return fail(tagStart, `Field ${number}: ${WIRE[wt]} needs ${size} bytes, only ${end - pos} left`)
      const r = wt === 1 ? fixed64Readings(view, pos) : fixed32Readings(view, pos)
      pos += size
      node.end = pos
      node.readings = [...(node.readings ?? []), ...r.readings]
      node.value = (field && typedFixed(field, r)) ?? (r.floatNice ? r.float : r.int)
    } else if (wt === 2) {
      const len = readVarint(b, pos, end)
      if ('error' in len) return fail(pos, `Field ${number} length: ${len.error}`)
      if (len.value > BigInt(end - len.next)) return fail(tagStart, `Field ${number}: length ${len.value} runs past the end (${end - len.next} bytes left)`)
      const contentStart = len.next
      const contentEnd = contentStart + Number(len.value)
      node.head = contentStart
      node.end = contentEnd
      pos = contentEnd
      lengthDelimited(ctx, node, contentStart, contentEnd, depth, field)
    } else {
      // SGROUP: fields until the matching EGROUP.
      if (depth + 1 > MAX_DEPTH) return fail(tagStart, `Groups nested more than ${MAX_DEPTH} levels deep`)
      node.children = []
      const inner = field?.kind === 'message' ? ctx.schema?.messages.get(field.type) ?? null : null
      const r = parseFields(ctx, pos, end, depth + 1, inner, number, node.children)
      if (r.error) {
        out.push(node)
        node.end = r.pos
        return { pos: r.pos, error: r.error, closed: false }
      }
      if (!r.closed) return fail(tagStart, `Group ${number} has no end-group tag`)
      pos = r.pos
      node.end = pos
      node.value = `${node.children.length} ${node.children.length === 1 ? 'field' : 'fields'} (group, deprecated)`
    }
    out.push(node)
  }
  return { pos, error: null, closed: false }
}

type PackedKind = 'varint' | 'fixed32' | 'fixed64'

function packedKindOf(field: FieldDef | undefined): PackedKind | null {
  if (!field || field.label !== 'repeated') return null
  const wire = expectedWire(field)
  return wire === 0 ? 'varint' : wire === 1 ? 'fixed64' : wire === 5 ? 'fixed32' : null
}

/** True when start..end is a whole number of valid varints (a byte scan, no decoding). */
function allVarints(b: Uint8Array, start: number, end: number): { ok: boolean; count: number } {
  let count = 0
  let run = 0
  for (let i = start; i < end; i++) {
    const byte = b[i]
    if (byte & 0x80) {
      if (++run > 9) return { ok: false, count }
      continue
    }
    if (run === 9 && byte > 1) return { ok: false, count }
    run = 0
    count++
  }
  return { ok: run === 0, count }
}

/**
 * Packed repeated scalars; null when the bytes do not split evenly into
 * that kind. Element nodes are only built for the first PACKED_CAP, and
 * speculative packed views across the whole decode share PACKED_TOTAL.
 */
function packed(ctx: Ctx, kind: PackedKind, start: number, end: number, field: FieldDef | undefined): View | null {
  const b = ctx.b
  const len = end - start
  if (!len) return null
  if (kind === 'fixed32' && len % 4) return null
  if (kind === 'fixed64' && len % 8) return null
  let count = len / (kind === 'fixed64' ? 8 : 4)
  if (kind === 'varint') {
    const scan = allVarints(b, start, end)
    if (!scan.ok) return null
    count = scan.count
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const children: DNode[] = []
  const values: string[] = []
  const build = Math.min(count, PACKED_CAP, field ? count : ctx.packedLeft)
  let pos = start
  for (let i = 0; i < Math.max(build, Math.min(count, 20)); i++) {
    const at = pos
    let value: string
    let readings: Reading[]
    if (kind === 'varint') {
      const v = readVarint(b, pos, end)
      if ('error' in v) return null
      pos = v.next
      readings = varintReadings(v.value)
      value = (field && typedVarint(ctx, field, v.value)) ?? v.value.toString()
    } else {
      const r = kind === 'fixed64' ? fixed64Readings(view, pos) : fixed32Readings(view, pos)
      pos += kind === 'fixed64' ? 8 : 4
      readings = r.readings
      value = (field && typedFixed(field, r)) ?? (r.floatNice ? r.float : r.int)
    }
    if (values.length < 20) values.push(value)
    if (i < build && ctx.budget.tryTake()) children.push({ label: `[${i}]`, kind, start: at, head: at, end: pos, value, readings })
  }
  if (!field) ctx.packedLeft -= children.length
  const summary = `[${values.join(', ')}${count > values.length ? ', …' : ''}]`
  return {
    name: `packed ${kind}`,
    kind: `packed ${kind} × ${count}`,
    value: children.length < count ? `${summary} — ${children.length.toLocaleString('en-US')} of ${count.toLocaleString('en-US')} listed` : summary,
    children,
  }
}

function lengthDelimited(ctx: Ctx, node: DNode, start: number, end: number, depth: number, field: FieldDef | undefined) {
  const len = end - start
  const views: View[] = []
  let preferred: string | null = null
  let msgDef: MessageDef | null = null
  const packedKind = packedKindOf(field)
  if (field) {
    if (field.kind === 'message') {
      preferred = 'message'
      msgDef = ctx.schema?.messages.get(field.type) ?? null
    } else if (field.type === 'string') preferred = 'text'
    else if (field.type === 'bytes') preferred = 'bytes'
    else if (packedKind) preferred = `packed ${packedKind}`
  }

  // 1. A nested message.
  let messageOk = false
  if (len > 0 && depth + 1 <= MAX_DEPTH && ctx.work < MAX_WORK) {
    const budgetBefore = ctx.budget.count
    const warningsBefore = ctx.warnings.length
    const children: DNode[] = []
    const r = parseFields(ctx, start, end, depth + 1, msgDef, null, children)
    if (!r.error) {
      messageOk = true
      views.push({
        name: 'message',
        kind: msgDef ? shortName(msgDef.fullName) : 'message',
        value: `${children.length} ${children.length === 1 ? 'field' : 'fields'}`,
        children,
      })
    } else {
      ctx.budget.count = budgetBefore
      ctx.warnings.length = warningsBefore
      if (preferred === 'message') warnNode(ctx, node, `declared ${field!.written}, but the bytes are not a valid message (${r.error.message} at byte ${r.error.offset})`)
    }
  } else if (len > 0 && ctx.work >= MAX_WORK && !ctx.workNoted) {
    ctx.workNoted = true
    ctx.warnings.push({ offset: start, message: 'Stopped trying length-delimited fields as nested messages here — the input nests too much to try them all' })
  }
  if (len === 0) views.push({ name: 'message', kind: 'message', value: 'empty message', children: [] })

  // 2. UTF-8 text.
  let printable = false
  if (len <= TEXT_TRY_CAP || !messageOk) {
    const text = utf8(ctx.b.subarray(start, end))
    if (text !== null) {
      printable = isPrintable(text)
      views.push({ name: 'text', kind: 'string', value: quote(text) })
    } else if (preferred === 'text') warnNode(ctx, node, 'declared string, but the bytes are not valid UTF-8')
  }

  // 3. Packed repeated numbers.
  const kinds: PackedKind[] = packedKind ? [packedKind] : ctx.packed ? ['varint', 'fixed32', 'fixed64'] : []
  for (const kind of kinds) {
    const v = packed(ctx, kind, start, end, field)
    if (v) views.push(v)
  }

  // 4. Raw bytes, always.
  views.push({ name: 'bytes', kind: 'bytes', value: `h'${hexRange(ctx.b, start, end)}'` })

  const find = (name: string) => views.findIndex((v) => v.name === name)
  let chosen = preferred ? find(preferred) : -1
  if (chosen < 0) {
    const text = find('text')
    const message = find('message')
    const firstPacked = views.findIndex((v) => v.name.startsWith('packed'))
    if (len === 0) chosen = text
    else if (text >= 0 && printable) chosen = text
    else if (message >= 0) chosen = message
    else if (firstPacked >= 0) chosen = firstPacked
    else if (text >= 0) chosen = text
    else chosen = find('bytes')
  }
  node.views = views
  node.view = chosen
  node.value = views[chosen].value
  node.readings = [...(node.readings ?? []), { name: 'length', value: `${len} bytes` }]
  if (len === 0) note(node, 'info', 'Zero length: an empty string, empty bytes and an empty message all encode this way')
  else if (views.length > 2) note(node, 'info', `Also reads as ${views.filter((_, i) => i !== chosen).map((v) => v.name).join(', ')} — pick a reading in the details`)
}

export function decodeProtobuf(bytes: Uint8Array, options: ProtobufOptions = {}, budget = new Budget()): DecodeResult {
  const ctx: Ctx = { b: bytes, budget, packed: Boolean(options.packed), schema: options.schema ?? null, warnings: [], work: 0, workNoted: false, packedLeft: PACKED_TOTAL }
  const nodes: DNode[] = []
  const errors: Issue[] = []
  let truncated = false
  let consumed = bytes.length
  try {
    const r = parseFields(ctx, 0, bytes.length, 0, options.root ?? null, null, nodes)
    if (r.error) {
      errors.push(r.error)
      consumed = r.error.offset
    }
  } catch (error) {
    if (!(error instanceof DecodeError) || !error.limit) throw error
    truncated = true
    consumed = error.offset
    ctx.warnings.push({ offset: error.offset, message: error.message })
  }
  if (!bytes.length) errors.push({ offset: 0, message: 'No bytes to decode' })
  return { format: 'protobuf', nodes, errors, warnings: ctx.warnings, truncated, consumed, items: nodes.length }
}
