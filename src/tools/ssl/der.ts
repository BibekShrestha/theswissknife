/**
 * Strict DER reading (and the little writing the key tools need), shared by
 * the certificate, CSR and key parsers in this folder. Lengths must be in
 * their shortest form, indefinite lengths and high tag numbers are refused,
 * and a container must be filled exactly by its children.
 */

export interface AsnNode {
  tag: number
  start: number
  contentStart: number
  end: number
  bytes: Uint8Array
}

export function readNode(bytes: Uint8Array, start = 0): AsnNode {
  if (start + 2 > bytes.length) throw new Error('Truncated ASN.1 value')
  const tag = bytes[start]
  // no X.509, PKCS#8 or PKCS#10 structure uses tag numbers above 30
  if ((tag & 0x1f) === 0x1f) throw new Error('Invalid DER: unsupported tag form')
  let cursor = start + 1
  let length = bytes[cursor++]
  if (length & 0x80) {
    const count = length & 0x7f
    if (!count || count > 4 || cursor + count > bytes.length) throw new Error('Invalid ASN.1 length')
    // DER: the shortest length form only — no leading zero bytes, no long form below 128
    if (bytes[cursor] === 0) throw new Error('Invalid DER: non-minimal length')
    length = 0
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[cursor++]
    if (length < 0x80) throw new Error('Invalid DER: non-minimal length')
  }
  const end = cursor + length
  if (end > bytes.length) throw new Error('Truncated ASN.1 content')
  return { tag, start, contentStart: cursor, end, bytes }
}

/** The single top-level value of `der`, which must fill it exactly. */
export function readWhole(der: Uint8Array, what: string): AsnNode {
  const node = readNode(der)
  if (node.end !== der.length) throw new Error(`${what}: trailing bytes after the DER value`)
  return node
}

export function children(node: AsnNode): AsnNode[] {
  const out: AsnNode[] = []
  let cursor = node.contentStart
  while (cursor < node.end) {
    const child = readNode(node.bytes, cursor)
    out.push(child)
    cursor = child.end
  }
  if (cursor !== node.end) throw new Error('Invalid ASN.1 container')
  return out
}

export function content(node: AsnNode): Uint8Array {
  return node.bytes.slice(node.contentStart, node.end)
}

export function whole(node: AsnNode): Uint8Array {
  return node.bytes.slice(node.start, node.end)
}

export function expectTag(node: AsnNode | undefined, tag: number, what: string): AsnNode {
  if (!node || node.tag !== tag) throw new Error(`${what} is missing or malformed`)
  return node
}

export function oid(node: AsnNode): string {
  const data = content(node)
  if (!data.length) throw new Error('Empty object identifier')
  if (data[data.length - 1] & 0x80) throw new Error('Truncated object identifier')
  const parts = [Math.min(2, Math.floor(data[0] / 40)), data[0] < 80 ? data[0] % 40 : data[0] - 80]
  let value = 0
  for (let i = 1; i < data.length; i += 1) {
    value = value * 128 + (data[i] & 0x7f)
    if (!(data[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

export function integer(node: AsnNode): number {
  let value = 0
  for (const byte of content(node)) value = value * 256 + byte
  return value
}

/**
 * A non-negative INTEGER's magnitude (no sign byte). DER: the shortest
 * two's-complement form, so a leading 00 only before a byte ≥ 0x80.
 */
export function uintBytes(node: AsnNode | undefined, what: string): Uint8Array {
  const value = content(expectTag(node, 0x02, what))
  if (!value.length) throw new Error(`${what}: empty INTEGER`)
  if (value[0] & 0x80) throw new Error(`${what}: negative INTEGER`)
  if (value.length > 1 && value[0] === 0 && !(value[1] & 0x80)) throw new Error(`Invalid DER: non-minimal INTEGER (${what})`)
  return value[0] === 0 && value.length > 1 ? value.slice(1) : value
}

/** A small non-negative INTEGER (version numbers, iteration counts). */
export function smallUint(node: AsnNode | undefined, what: string): number {
  const bytes = uintBytes(node, what)
  if (bytes.length > 6) throw new Error(`${what} is out of range`)
  return bytes.reduce((n, byte) => n * 256 + byte, 0)
}

/** A BIT STRING holding whole bytes (keys, signatures). */
export function bitStringBytes(node: AsnNode | undefined, what: string): Uint8Array {
  const value = content(expectTag(node, 0x03, what))
  if (!value.length || value[0] !== 0) throw new Error(`${what}: BIT STRING with unused bits`)
  return value.slice(1)
}

export function text(node: AsnNode): string {
  const data = content(node)
  if (node.tag === 0x1e) {
    let value = ''
    for (let i = 0; i + 1 < data.length; i += 2) value += String.fromCharCode(data[i] * 256 + data[i + 1])
    return value
  }
  if (node.tag === 0x1c) {
    let value = ''
    for (let i = 0; i + 3 < data.length; i += 4) value += String.fromCodePoint(data[i] * 0x1000000 + data[i + 1] * 0x10000 + data[i + 2] * 0x100 + data[i + 3])
    return value
  }
  return new TextDecoder().decode(data)
}

export function hex(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(separator).toUpperCase()
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

// ---- writing: only what rebuilding a SubjectPublicKeyInfo needs ----

export function encode(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts)
  const n = body.length
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]
  return concatBytes([Uint8Array.of(tag, ...length), body])
}

export function encodeUint(magnitude: Uint8Array): Uint8Array {
  let start = 0
  while (start < magnitude.length - 1 && magnitude[start] === 0) start += 1
  const trimmed = magnitude.slice(start)
  return encode(0x02, trimmed[0] & 0x80 ? concatBytes([Uint8Array.of(0), trimmed]) : trimmed.length ? trimmed : Uint8Array.of(0))
}

export function encodeOid(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map(Number)
  const out = [40 * arcs[0] + arcs[1]]
  for (const arc of arcs.slice(2)) {
    const chunk = [arc & 0x7f]
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80)
    out.push(...chunk)
  }
  return encode(0x06, Uint8Array.from(out))
}

export const encodeNull = () => Uint8Array.of(0x05, 0x00)
export const encodeBits = (bytes: Uint8Array) => encode(0x03, Uint8Array.of(0), bytes)

// ---- Base64 ----

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

/** Strict standard Base64 (whitespace ignored, padding optional), or throws. */
export function fromBase64(encoded: string, what: string): Uint8Array {
  const clean = encoded.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.replace(/=+$/, '').length % 4 === 1) {
    throw new Error(`${what} contains invalid Base64 data`)
  }
  const padded = clean.replace(/=+$/, '')
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (character) => character.charCodeAt(0))
}
