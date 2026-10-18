/**
 * Hash & HMAC logic — WebCrypto only (SHA-1/256/384/512). MD5 is not offered
 * because crypto.subtle has no MD5.
 */

export const ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const
export type Algorithm = (typeof ALGORITHMS)[number]

export type KeyEncoding = 'utf8' | 'hex' | 'base64'
export type OutputEncoding = 'hex' | 'base64'

/** One computed digest, e.g. { id: 'HMAC-SHA-256', bytes }. */
export interface DigestRow {
  id: string
  algorithm: Algorithm
  hmac: boolean
  bytes: Uint8Array
}

const encoder = new TextEncoder()

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function encodeDigest(bytes: Uint8Array, encoding: OutputEncoding): string {
  return encoding === 'hex' ? toHex(bytes) : toBase64(bytes)
}

/** Strict hex: even length, hex digits only (whitespace removed first). */
export function parseHex(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.replace(/\s+/g, '')
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** Base64 or Base64URL, padding optional (whitespace removed first). */
export function parseBase64(text: string): Uint8Array<ArrayBuffer> | null {
  let clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null
  clean = clean.replace(/=+$/, '')
  if (clean.length % 4 === 1) return null
  clean += '='.repeat((4 - (clean.length % 4)) % 4)
  try {
    const binary = atob(clean)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export type KeyResult = { bytes: Uint8Array<ArrayBuffer>; error: null } | { bytes: null; error: string }

export function decodeKey(text: string, encoding: KeyEncoding): KeyResult {
  if (encoding === 'utf8') return { bytes: utf8(text), error: null }
  if (encoding === 'hex') {
    const bytes = parseHex(text)
    return bytes ? { bytes, error: null } : { bytes: null, error: 'Key is not valid hex (even number of 0-9, a-f digits)' }
  }
  const bytes = parseBase64(text)
  return bytes ? { bytes, error: null } : { bytes: null, error: 'Key is not valid Base64' }
}

export async function digest(algorithm: Algorithm, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data))
}

export async function hmac(algorithm: Algorithm, key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algorithm }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data))
}

export async function digestAll(data: Uint8Array<ArrayBuffer>): Promise<DigestRow[]> {
  return Promise.all(ALGORITHMS.map(async (algorithm) => ({ id: algorithm, algorithm, hmac: false, bytes: await digest(algorithm, data) })))
}

export async function hmacAll(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<DigestRow[]> {
  return Promise.all(ALGORITHMS.map(async (algorithm) => ({ id: `HMAC-${algorithm}`, algorithm, hmac: true, bytes: await hmac(algorithm, key, data) })))
}

export interface CompareMatch {
  id: string
  encoding: OutputEncoding
}

export type CompareResult =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'none' }
  | { status: 'match'; matches: CompareMatch[] }

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Compare an expected checksum against every computed row. Whitespace is
 * ignored; hex is matched case-insensitively; Base64/Base64URL with or
 * without padding; hex may be colon-separated (AB:CD:…) or 0x-prefixed.
 * A string that is valid as both is tried both ways. A
 * whole checksum line also works: `sha256sum` output ("<hash>  file") is
 * read by its first word, BSD style ("SHA256 (file) = <hash>") by its last.
 */
export function compareDigest(expected: string, rows: DigestRow[]): CompareResult {
  const words = expected.trim().split(/\s+/)
  // The shortest digest here (SHA-1) is 27 Base64 characters unpadded, so a
  // shorter word cannot be one — that keeps "not a digest" invalid.
  const lineWords = words.length > 1 ? [words[0], words[words.length - 1]].filter((w) => w.length >= 27) : []
  const candidates = [...new Set([expected.replace(/\s+/g, ''), ...lineWords])]
  if (!candidates[0]) return { status: 'empty' }
  let parsed = false
  const matches: CompareMatch[] = []
  for (const candidate of candidates) {
    // fingerprints are often written AB:CD:… (openssl, browsers) or 0x…;
    // neither ':' nor a leading 0x changes what the Base64 reading sees
    const hexForm = /^(?:[0-9a-f]{2}:)+[0-9a-f]{2}$/i.test(candidate)
      ? candidate.replace(/:/g, '')
      : /^0x[0-9a-f]+$/i.test(candidate) ? candidate.slice(2) : candidate
    const asHex = parseHex(hexForm)
    const asBase64 = parseBase64(candidate)
    if (!asHex && !asBase64) continue
    parsed = true
    for (const row of rows) {
      if (matches.some((m) => m.id === row.id)) continue
      if (asHex && equalBytes(asHex, row.bytes)) matches.push({ id: row.id, encoding: 'hex' })
      else if (asBase64 && equalBytes(asBase64, row.bytes)) matches.push({ id: row.id, encoding: 'base64' })
    }
  }
  if (matches.length) return { status: 'match', matches }
  return parsed ? { status: 'none' } : { status: 'invalid' }
}
