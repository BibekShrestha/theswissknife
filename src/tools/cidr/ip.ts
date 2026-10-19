/**
 * IPv4 and IPv6 address text, hand-written. Every address is a `bigint` so
 * IPv6's 128 bits need no special casing; `family` says how many bits count.
 *
 * Parsing is strict on purpose. inet_aton() (and therefore ping, curl and
 * many C libraries) reads `010.1` as 8.0.0.1 — octal octets and shorthand
 * forms — while browsers' WHATWG parser and most languages read the same text
 * differently or reject it. A subnet calculator that silently picks one
 * reading hands out the wrong network, so those forms are errors that say
 * why.
 */

export type Family = 4 | 6

export interface Addr {
  family: Family
  value: bigint
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = <T>(error: string): Result<T> => ({ ok: false, error })

export const bitsOf = (family: Family): number => (family === 4 ? 32 : 128)
export const maxOf = (family: Family): bigint => (1n << BigInt(bitsOf(family))) - 1n

/** Number of significant bits in a non-negative bigint (0 for 0n). */
export function bitLength(value: bigint): number {
  let n = 0
  let v = value
  while (v > 0xffffffffn) { v >>= 32n; n += 32 }
  while (v > 0n) { v >>= 1n; n++ }
  return n
}

const ordinal = ['first', 'second', 'third', 'fourth']

/** Strict dotted-quad IPv4: four decimal octets 0–255, no leading zeros. */
export function parseIPv4(text: string): Result<bigint> {
  if (text === '') return fail('Empty address.')
  if (/^\d+$/.test(text)) {
    return fail(`“${clip(text)}” is a bare number. inet_aton() would read it as a 32-bit address, but that form is ambiguous and rarely intended — write four dotted octets.`)
  }
  if (/^0x[0-9a-f]+$/i.test(text)) return fail(`“${clip(text)}” is a hex number, not a dotted IPv4 address.`)
  const parts = text.split('.')
  if (parts.length !== 4) {
    if (parts.length >= 2 && parts.length < 4 && parts.every((part) => /^\d+$/.test(part))) {
      return fail(`“${clip(text)}” has ${parts.length} parts. Shorthand like 10.1 is ambiguous: inet_aton() reads it as 10.0.0.1, other parsers reject it. Write all four octets.`)
    }
    if (parts.length > 4) return fail(`“${clip(text)}” has ${parts.length} dotted parts; an IPv4 address has four.`)
    return fail(`“${clip(text)}” is not an IPv4 address — expected four dotted octets like 192.0.2.1.`)
  }
  let value = 0n
  for (let i = 0; i < 4; i++) {
    const part = parts[i]
    const which = ordinal[i]
    if (part === '') return fail(`The ${which} octet is empty.`)
    if (/^0x/i.test(part)) return fail(`The ${which} octet “${clip(part)}” is hex. inet_aton() accepts hex octets, most other parsers do not — write it in decimal.`)
    if (!/^[0-9]+$/.test(part)) return fail(`The ${which} octet “${clip(part)}” is not a decimal number.`)
    if (part.length > 1 && part[0] === '0') {
      const octal = /^[0-7]+$/.test(part) ? Number.parseInt(part, 8) : null
      const decimal = Number(part)
      const reading = octal === null
        ? `it isn’t valid octal, so some parsers reject it while others read decimal ${decimal}`
        : octal === decimal
          ? `here both readings agree, but the form is still rejected`
          : `inet_aton() reads it as octal ${octal}, others as decimal ${decimal}`
      return fail(`The ${which} octet “${clip(part)}” has a leading zero, which is ambiguous: ${reading}. Write it without leading zeros.`)
    }
    const n = Number(part)
    if (n > 255) return fail(`The ${which} octet is ${part.length > 6 ? clip(part) : n}, out of range — octets are 0–255.`)
    value = (value << 8n) | BigInt(n)
  }
  return ok(value)
}

export interface ParsedV6 {
  value: bigint
  zone?: string
}

/**
 * IPv6 text (RFC 4291 §2.2): eight 16-bit hex groups, one `::` for a run of
 * zero groups, an optional dotted IPv4 in the last 32 bits, and an optional
 * `%zone` (RFC 4007 §11).
 */
export function parseIPv6(input: string): Result<ParsedV6> {
  let text = input
  let zone: string | undefined
  const percent = text.indexOf('%')
  if (percent >= 0) {
    zone = text.slice(percent + 1)
    text = text.slice(0, percent)
    if (zone === '') return fail('Empty zone id after “%”.')
    if (/[\s%/[\]]/.test(zone)) return fail(`Zone id “${clip(zone)}” contains a space, “%”, “/” or a bracket.`)
  }
  if (text === '') return fail('Empty address.')
  const bad = /[^0-9a-fA-F:.]/.exec(text)
  if (bad) return fail(`“${bad[0]}” can’t appear in an IPv6 address (only hex digits, “:” and a dotted IPv4 tail).`)
  if (text.includes(':::')) return fail('Three colons in a row — “::” is the only allowed double colon.')
  if (/^:[^:]/.test(text) || text === ':') return fail('The address starts with a single “:”. Use “::” for leading zero groups.')
  if (/[^:]:$/.test(text)) return fail('The address ends with a single “:”. Use “::” for trailing zero groups.')
  const pieces = text.split('::')
  if (pieces.length > 2) {
    return fail('More than one “::”. Each “::” stands for a run of zero groups, so with two of them the length of each run is ambiguous (RFC 4291 §2.2 allows one).')
  }
  const compressed = pieces.length === 2
  const head = pieces[0] === '' ? [] : pieces[0].split(':')
  const tail = compressed ? (pieces[1] === '' ? [] : pieces[1].split(':')) : []
  const groups = [...head, ...tail]

  const words: number[] = []
  const headWords: number[] = []
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const isLast = i === groups.length - 1
    if (group === '') {
      if (!compressed && (i === 0 || isLast)) return fail(`The address ${i === 0 ? 'starts' : 'ends'} with a single “:”. Use “::” for zero groups.`)
      return fail('Empty group between colons — use “::” (once) for zero groups.')
    }
    if (group.includes('.')) {
      if (!isLast || (compressed && i < head.length)) return fail(`“${clip(group)}”: a dotted IPv4 part may only be the last 32 bits of the address.`)
      const v4 = parseIPv4(group)
      if (!v4.ok) return fail(`Embedded IPv4 “${clip(group)}”: ${v4.error}`)
      const pair = [Number(v4.value >> 16n), Number(v4.value & 0xffffn)]
      words.push(...pair)
      if (i < head.length) headWords.push(...pair)
      continue
    }
    if (group.length > 4) return fail(`Group “${clip(group)}” has ${group.length} hex digits; a group holds at most four.`)
    const word = Number.parseInt(group, 16)
    words.push(word)
    if (i < head.length) headWords.push(word)
  }

  if (!compressed) {
    if (words.length < 8) return fail(`Only ${words.length} of 8 groups. Write all eight, or use “::” for the zero groups.`)
    if (words.length > 8) return fail(`${words.length} groups — an IPv6 address has eight.`)
  } else if (words.length > 7) {
    return fail(`“::” must stand for at least one zero group, but the other groups already make ${words.length}.`)
  }

  const full = compressed
    ? [...headWords, ...new Array<number>(8 - words.length).fill(0), ...words.slice(headWords.length)]
    : words
  let value = 0n
  for (const word of full) value = (value << 16n) | BigInt(word)
  return ok(zone === undefined ? { value } : { value, zone })
}

export interface ParsedAddr extends Addr {
  zone?: string
}

/** Either family, chosen by the presence of a colon. Brackets are allowed around IPv6. */
export function parseAddress(raw: string): Result<ParsedAddr> {
  let text = raw.trim()
  if (text === '') return fail('Enter an address.')
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) return fail('Unclosed “[” around the IPv6 address.')
    text = text.slice(1, -1)
    if (!text.includes(':')) return fail('Brackets are only for IPv6 addresses.')
  }
  if (text.includes(':')) {
    const v6 = parseIPv6(text)
    return v6.ok ? ok({ family: 6, value: v6.value.value, ...(v6.value.zone !== undefined && { zone: v6.value.zone }) }) : v6
  }
  if (text.includes('%')) return fail('Zone ids (“%…”) only apply to IPv6 addresses.')
  const v4 = parseIPv4(text)
  return v4.ok ? ok({ family: 4, value: v4.value }) : v4
}

export function formatIPv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.')
}

function words(value: bigint): number[] {
  const out: number[] = []
  for (let shift = 112n; shift >= 0n; shift -= 16n) out.push(Number((value >> shift) & 0xffffn))
  return out
}

const MAPPED_PREFIX = 0xffffn << 32n

/** True for ::ffff:0:0/96, the IPv4-mapped block. */
export const isMapped = (value: bigint): boolean => value >> 32n === 0xffffn

/**
 * RFC 5952 §4 canonical text: lowercase, no leading zeros, the longest run of
 * two or more zero groups shortened to "::" (the first run on a tie), never a
 * single zero group. IPv4-mapped addresses use mixed notation (§5).
 */
export function formatIPv6(value: bigint): string {
  if (isMapped(value)) return `::ffff:${formatIPv4(value - MAPPED_PREFIX)}`
  const groups = words(value)
  let bestStart = -1
  let bestLen = 1
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) { bestStart = i; bestLen = j - i }
    i = j
  }
  const hex = groups.map((group) => group.toString(16))
  if (bestStart < 0) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`
}

/** All eight groups, four digits each. */
export function expandIPv6(value: bigint): string {
  return words(value).map((group) => group.toString(16).padStart(4, '0')).join(':')
}

export function formatAddr(addr: Addr): string {
  return addr.family === 4 ? formatIPv4(addr.value) : formatIPv6(addr.value)
}

/** PTR owner name: reversed octets under in-addr.arpa, reversed nibbles under ip6.arpa. */
export function reverseName(addr: Addr): string {
  return reverseZone(addr, bitsOf(addr.family))
}

/**
 * The reverse-DNS name covering the first `prefix` bits, rounded down to a
 * label boundary (8 bits for IPv4, 4 for IPv6). `aligned` is false when the
 * prefix does not end on that boundary (RFC 2317 classless delegation then
 * needs CNAMEs).
 */
export function reverseZone(addr: Addr, prefix: number): string {
  if (addr.family === 4) {
    const labels = Math.floor(prefix / 8)
    const octets = formatIPv4(addr.value).split('.').slice(0, labels).reverse()
    return [...octets, 'in-addr', 'arpa'].join('.')
  }
  const labels = Math.floor(prefix / 4)
  const nibbles = expandIPv6(addr.value).replaceAll(':', '').slice(0, labels).split('').reverse()
  return [...nibbles, 'ip6', 'arpa'].join('.')
}

export const labelBits = (family: Family): number => (family === 4 ? 8 : 4)

/** Binary digits, grouped per octet (IPv4) or per 16-bit group (IPv6). */
export function binaryGroups(addr: Addr): string[] {
  const size = addr.family === 4 ? 8 : 16
  const all = addr.value.toString(2).padStart(bitsOf(addr.family), '0')
  const out: string[] = []
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size))
  return out
}

/** Keeps user text in error messages short. */
export function clip(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
