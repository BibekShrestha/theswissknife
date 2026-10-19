/**
 * Prefix math on bigint addresses: parsing "address/len", "address mask" and
 * "start - end", plus split, summarise (aggregate), contains/overlap and
 * range → CIDR. Nothing here builds a list proportional to an address count:
 * splits are indexed (`subnetAt`), and every other output is bounded by the
 * input size times the address width.
 */
import { type Family, type Result, bitLength, bitsOf, clip, formatAddr, maxOf, parseAddress } from './ip'

export interface Net {
  family: Family
  /** Network address (host bits zero). */
  base: bigint
  prefix: number
}

export interface Range {
  family: Family
  start: bigint
  end: bigint
}

export type Form = 'address' | 'prefix' | 'netmask' | 'wildcard'

export interface CidrInput {
  family: Family
  /** The address as written (host bits may be set). */
  addr: bigint
  prefix: number
  zone?: string
  form: Form
  notes: string[]
}

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

export const sizeOf = (family: Family, prefix: number): bigint => 1n << BigInt(bitsOf(family) - prefix)
export const hostMask = (family: Family, prefix: number): bigint => sizeOf(family, prefix) - 1n
export const netMask = (family: Family, prefix: number): bigint => maxOf(family) ^ hostMask(family, prefix)
export const lastOf = (net: Net): bigint => net.base + hostMask(net.family, net.prefix)
export const toRange = (net: Net): Range => ({ family: net.family, start: net.base, end: lastOf(net) })
export const netOf = (family: Family, addr: bigint, prefix: number): Net => ({ family, base: addr & netMask(family, prefix), prefix })
export const formatNet = (net: Net): string => `${formatAddr({ family: net.family, value: net.base })}/${net.prefix}`

function parsePrefixLength(text: string, family: Family): Result<number> {
  const bits = bitsOf(family)
  if (text === '') return fail('Missing prefix length after “/”.')
  if (!/^\d+$/.test(text)) return fail(`Prefix length “${clip(text)}” is not a number.`)
  if (text.length > 1 && text[0] === '0') return fail(`Prefix length “${clip(text)}” has a leading zero — write /${Number(text)}.`)
  const n = Number(text)
  if (n > bits) return fail(`/${text.length > 4 ? clip(text) : n} is out of range — IPv${family} prefix lengths are 0–${bits}.`)
  return ok(n)
}

interface MaskReading { prefix: number; form: 'netmask' | 'wildcard'; note?: string }

/**
 * A contiguous netmask (ones then zeros) or wildcard mask (zeros then ones,
 * as in Cisco ACLs). All-zeros and all-ones read either way; they are taken
 * as netmasks, and the note says so.
 */
export function readMask(family: Family, mask: bigint, text: string): Result<MaskReading> {
  const bits = bitsOf(family)
  const max = maxOf(family)
  const inverted = max ^ mask
  const asNetmask = (inverted & (inverted + 1n)) === 0n
  const asWildcard = (mask & (mask + 1n)) === 0n
  if (asNetmask) {
    const prefix = bits - bitLength(inverted)
    const note = asWildcard ? `${text} reads as a netmask (/${prefix}); as a wildcard mask it would mean /${bits - prefix}.` : undefined
    return ok({ prefix, form: 'netmask', ...(note && { note }) })
  }
  if (asWildcard) return ok({ prefix: bits - bitLength(mask), form: 'wildcard' })
  return fail(`${text} is not a contiguous mask: a netmask is all ones then all zeros (255.255.255.0), a wildcard mask the reverse (0.0.0.255).`)
}

/**
 * One address with an optional prefix: "192.0.2.1", "192.0.2.0/24",
 * "192.0.2.0/255.255.255.0", "192.0.2.0 255.255.255.0" (netmask or wildcard),
 * "2001:db8::/32", "fe80::1%eth0/64".
 */
export function parseCidr(raw: string): Result<CidrInput> {
  const text = raw.trim()
  if (text === '') return fail('Enter an address or CIDR.')
  let addrText = text
  let maskText: string | undefined
  let viaSlash = false
  const slash = text.indexOf('/')
  if (slash >= 0) {
    if (text.indexOf('/', slash + 1) >= 0) return fail('More than one “/”.')
    addrText = text.slice(0, slash).trim()
    maskText = text.slice(slash + 1).trim()
    viaSlash = true
  } else {
    const parts = text.split(/\s+/)
    if (parts.length > 2) return fail('Expected an address and at most one mask, e.g. 192.0.2.0 255.255.255.0.')
    if (parts.length === 2) [addrText, maskText] = parts
  }
  const addr = parseAddress(addrText)
  if (!addr.ok) return addr
  const { family, value, zone } = addr.value
  const base = { family, addr: value, ...(zone !== undefined && { zone }) }
  if (maskText === undefined) return ok({ ...base, prefix: bitsOf(family), form: 'address', notes: [] })

  if (/^\d+$/.test(maskText) || (viaSlash && !/[.:]/.test(maskText))) {
    const prefix = parsePrefixLength(maskText, family)
    if (!prefix.ok) return prefix
    return ok({ ...base, prefix: prefix.value, form: 'prefix', notes: [] })
  }
  const mask = parseAddress(maskText)
  if (!mask.ok) return fail(`Mask: ${mask.error}`)
  if (mask.value.family !== family) return fail(`The mask is IPv${mask.value.family} but the address is IPv${family}.`)
  if (mask.value.zone !== undefined) return fail('A mask has no zone id.')
  const reading = readMask(family, mask.value.value, maskText)
  if (!reading.ok) return reading
  return ok({ ...base, prefix: reading.value.prefix, form: reading.value.form, notes: reading.value.note ? [reading.value.note] : [] })
}

/** The network a parsed input names; notes when the address had host bits set. */
export function toNet(input: CidrInput): { net: Net; hostBits: boolean } {
  const net = netOf(input.family, input.addr, input.prefix)
  return { net, hostBits: net.base !== input.addr }
}

export interface Hosts {
  first: bigint
  last: bigint
  usable: bigint
  broadcast?: bigint
  rule: string
}

/**
 * Usable hosts. IPv4 loses the network and broadcast addresses, except /31
 * (RFC 3021 point-to-point: both usable, no broadcast) and /32 (one host).
 * IPv6 has no broadcast; the all-zero host is the Subnet-Router anycast
 * address (RFC 4291 §2.6.1), except /127 (RFC 6164: anycast is disabled,
 * both usable) and /128 (one host).
 */
export function hostsOf(net: Net): Hosts {
  const last = lastOf(net)
  const bits = bitsOf(net.family)
  const size = sizeOf(net.family, net.prefix)
  if (net.prefix === bits) return { first: net.base, last, usable: 1n, rule: `A /${bits} is a single address.` }
  if (net.prefix === bits - 1) {
    return {
      first: net.base,
      last,
      usable: 2n,
      rule: net.family === 4
        ? 'A /31 is a point-to-point link: both addresses are usable and there is no broadcast (RFC 3021).'
        : 'A /127 is a point-to-point link: both addresses are usable, and routers disable the Subnet-Router anycast address on it (RFC 6164).',
    }
  }
  if (net.family === 4) {
    return { first: net.base + 1n, last: last - 1n, usable: size - 2n, broadcast: last, rule: 'The network and broadcast addresses are not assignable to hosts.' }
  }
  return {
    first: net.base + 1n,
    last,
    usable: size - 1n,
    rule: 'IPv6 has no broadcast. The first address is the Subnet-Router anycast address (RFC 4291 §2.6.1), so hosts start one later.',
  }
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function trailingZeros(value: bigint, bits: number): number {
  if (value === 0n) return bits
  let n = 0
  let v = value
  while ((v & 1n) === 0n) { v >>= 1n; n++ }
  return n
}

/** The fewest CIDR blocks covering exactly start..end (at most 2 × bits − 2). */
export function rangeToCidrs(range: Range): Net[] {
  const { family } = range
  const bits = bitsOf(family)
  const max = maxOf(family)
  const out: Net[] = []
  let start = range.start
  while (start <= range.end) {
    let host = trailingZeros(start, bits)
    while (host > 0 && start + (1n << BigInt(host)) - 1n > range.end) host--
    out.push({ family, base: start, prefix: bits - host })
    const next = start + (1n << BigInt(host))
    if (next > max) break
    start = next
  }
  return out
}

/** Union of ranges of one family, sorted and with adjacent/overlapping ranges merged. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => compareBig(a.start, b.start) || compareBig(b.end, a.end))
  const out: Range[] = []
  for (const range of sorted) {
    const top = out[out.length - 1]
    if (top && range.start <= top.end + 1n) {
      if (range.end > top.end) top.end = range.end
    } else {
      out.push({ ...range })
    }
  }
  return out
}

export interface SummaryLine {
  line: number
  text: string
}

export interface SummaryResult {
  /** Minimal CIDR list, IPv4 first, each family sorted. */
  output: Net[]
  errors: (SummaryLine & { error: string })[]
  /** Inputs with host bits set, and the network they were read as. */
  normalised: (SummaryLine & { net: Net })[]
  /** Inputs inside (or equal to) an earlier-sorting input. */
  redundant: (SummaryLine & { within: Net })[]
  inputs: number
  addresses: { 4: bigint; 6: bigint }
}

/**
 * Aggregate CIDRs (one per line; commas and spaces also separate) into the
 * fewest blocks covering exactly the same addresses. Bare addresses count as
 * /32 or /128; "start - end" ranges are accepted too.
 */
export function summarise(text: string): SummaryResult {
  const result: SummaryResult = { output: [], errors: [], normalised: [], redundant: [], inputs: 0, addresses: { 4: 0n, 6: 0n } }
  const entries: { line: number; text: string; net?: Net; range: Range }[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((lineText, index) => {
    const stripped = lineText.replace(/#.*$/, '')
    for (const token of splitTokens(stripped)) {
      result.inputs++
      const line = index + 1
      const parsed = parseAny(token)
      if (!parsed.ok) { result.errors.push({ line, text: token, error: parsed.error }); continue }
      if (parsed.value.kind === 'range') { entries.push({ line, text: token, range: parsed.value.range }); continue }
      const { net, hostBits } = toNet(parsed.value.input)
      if (hostBits) result.normalised.push({ line, text: token, net })
      entries.push({ line, text: token, net, range: toRange(net) })
    }
  })

  // Laminar sweep: CIDR blocks are nested or disjoint, so a block ending at or
  // before the furthest end seen so far (same family) lies inside that block.
  const sorted = [...entries].sort((a, b) => a.range.family - b.range.family || compareBig(a.range.start, b.range.start) || compareBig(b.range.end, a.range.end))
  let cover: (typeof entries)[number] | undefined
  for (const entry of sorted) {
    if (cover && cover.range.family === entry.range.family && entry.range.end <= cover.range.end && entry.range.start >= cover.range.start && cover.net && entry.net) {
      result.redundant.push({ line: entry.line, text: entry.text, within: cover.net })
      continue
    }
    if (!cover || cover.range.family !== entry.range.family || entry.range.end > cover.range.end) cover = entry
  }

  for (const family of [4, 6] as const) {
    const merged = mergeRanges(entries.filter((entry) => entry.range.family === family).map((entry) => entry.range))
    for (const range of merged) {
      result.addresses[family] += range.end - range.start + 1n
      result.output.push(...rangeToCidrs(range))
    }
  }
  return result
}

/**
 * Ranges keep their spaces ("10.0.0.1 - 10.0.0.9"), and so do "address mask"
 * pairs — but only when the second word really is a contiguous mask, so
 * "10.0.0.1 10.0.0.2" is still two addresses.
 */
export function splitTokens(line: string): string[] {
  const out: string[] = []
  for (const chunk of line.split(/[,;]/)) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const words = trimmed.split(/\s+/)
    if (RANGE_SEP.test(trimmed) || (words.length === 2 && !words[0].includes('/') && isMask(words[1]))) out.push(trimmed)
    else out.push(...words)
  }
  return out
}

function isMask(text: string): boolean {
  const mask = parseAddress(text)
  return mask.ok && mask.value.family === 4 && readMask(4, mask.value.value, text).ok
}

const RANGE_SEP = /\s*(?:-|–|—|\bto\b)\s*/

export type AnyInput =
  | { kind: 'cidr'; input: CidrInput }
  | { kind: 'range'; range: Range; notes: string[] }

/** "start - end" (hyphen, en/em dash or "to"), or anything parseCidr reads. */
export function parseAny(raw: string): Result<AnyInput> {
  const text = raw.trim()
  const parts = text.split(RANGE_SEP)
  if (parts.length === 2 && parts[0] !== '' && parts[1] !== '' && !text.includes('/')) {
    const range = parseRangeParts(parts[0], parts[1])
    return range.ok ? ok({ kind: 'range', range: range.value.range, notes: range.value.notes }) : range
  }
  if (parts.length > 2) return fail('A range has one start and one end.')
  if (parts.length === 2) {
    if (parts[0] === '' || parts[1] === '') return fail('A range needs both a start and an end.')
    return fail('Write a range as start - end, without a prefix length.')
  }
  const input = parseCidr(text)
  return input.ok ? ok({ kind: 'cidr', input: input.value }) : input
}

function parseRangeParts(startText: string, endText: string): Result<{ range: Range; notes: string[] }> {
  const start = parseAddress(startText)
  if (!start.ok) return fail(`Start: ${start.error}`)
  const end = parseAddress(endText)
  if (!end.ok) return fail(`End: ${end.error}`)
  if (start.value.family !== end.value.family) return fail(`The start is IPv${start.value.family} and the end IPv${end.value.family}.`)
  if (start.value.value > end.value.value) return fail(`The start (${formatAddr(start.value)}) is after the end (${formatAddr(end.value)}).`)
  const notes = start.value.zone !== undefined || end.value.zone !== undefined ? ['Zone ids are ignored in ranges.'] : []
  return ok({ range: { family: start.value.family, start: start.value.value, end: end.value.value }, notes })
}

/** The range any input covers: a CIDR's whole network, a bare address, or a range. */
export function rangeOfAny(input: AnyInput): Range {
  if (input.kind === 'range') return input.range
  return toRange(toNet(input.input).net)
}

export type Relation = 'equal' | 'a-in-b' | 'b-in-a' | 'overlap' | 'disjoint' | 'family'

export interface Comparison {
  relation: Relation
  /** Shared addresses, when there are any. */
  overlap?: Range
  overlapCount: bigint
}

export function compareRanges(a: Range, b: Range): Comparison {
  if (a.family !== b.family) return { relation: 'family', overlapCount: 0n }
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  if (start > end) return { relation: 'disjoint', overlapCount: 0n }
  const overlap = { family: a.family, start, end }
  const overlapCount = end - start + 1n
  if (a.start === b.start && a.end === b.end) return { relation: 'equal', overlap, overlapCount }
  if (a.start >= b.start && a.end <= b.end) return { relation: 'a-in-b', overlap, overlapCount }
  if (b.start >= a.start && b.end <= a.end) return { relation: 'b-in-a', overlap, overlapCount }
  return { relation: 'overlap', overlap, overlapCount }
}

export interface SplitPlan {
  net: Net
  prefix: number
  count: bigint
  /** For "into N": how many were asked for, when it was not a power of two. */
  requested?: bigint
}

/** Split into equal subnets of /prefix. */
export function planSplitByPrefix(net: Net, prefix: number): Result<SplitPlan> {
  const bits = bitsOf(net.family)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return fail(`IPv${net.family} prefix lengths are 0–${bits}.`)
  if (prefix < net.prefix) return fail(`/${prefix} is larger than the /${net.prefix} being split — pick /${net.prefix} or longer.`)
  return ok({ net, prefix, count: 1n << BigInt(prefix - net.prefix) })
}

/** Split into at least N equal subnets: the smallest power of two ≥ N. */
export function planSplitByCount(net: Net, count: bigint): Result<SplitPlan> {
  if (count < 1n) return fail('Ask for at least one subnet.')
  const extra = bitLength(count - 1n)
  const prefix = net.prefix + extra
  const bits = bitsOf(net.family)
  if (prefix > bits) {
    return fail(`A /${net.prefix} holds ${sizeOf(net.family, net.prefix).toLocaleString('en-US')} address${net.prefix === bits ? '' : 'es'}, so it can’t be split into ${count.toLocaleString('en-US')} subnets.`)
  }
  const total = 1n << BigInt(extra)
  return ok({ net, prefix, count: total, ...(total !== count && { requested: count }) })
}

/** The i-th subnet of a plan (0-based) — computed, never listed. */
export function subnetAt(plan: SplitPlan, index: bigint): Net {
  return { family: plan.net.family, base: plan.net.base + index * sizeOf(plan.net.family, plan.prefix), prefix: plan.prefix }
}

/** Rows offset..offset+limit−1 of a plan, clipped to its end. */
export function subnetPage(plan: SplitPlan, offset: bigint, limit: number): Net[] {
  const out: Net[] = []
  for (let i = offset; i < plan.count && out.length < limit; i++) out.push(subnetAt(plan, i))
  return out
}

/** Parses a positive decimal count, as bigint (IPv6 splits can exceed 2^53). */
export function parseCount(text: string): Result<bigint> {
  const trimmed = text.trim().replace(/[,_\s]/g, '')
  if (!/^\d+$/.test(trimmed)) return fail('Enter a whole number.')
  if (trimmed.length > 40) return fail('That number is too large.')
  return ok(BigInt(trimmed))
}

/** Exact count with thousands separators, plus 2^n when it is a power of two above 2^16. */
export function formatCount(value: bigint): string {
  const text = value.toLocaleString('en-US')
  if (value > 65536n && (value & (value - 1n)) === 0n) return `${text} (2^${bitLength(value) - 1})`
  return text
}
