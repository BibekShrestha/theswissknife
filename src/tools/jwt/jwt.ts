/** JWT parsing and claim helpers — pure functions, no crypto here. */

import { duplicateKeys } from './jsontext'

export function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlEncodeString(s: string): string {
  return b64urlEncodeBytes(new TextEncoder().encode(s))
}

function binToBytes(bin: string): Uint8Array {
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/**
 * Strict base64url (RFC 7515 §2): URL-safe alphabet, no padding, no
 * whitespace, and the unused trailing bits must be zero — so exactly one
 * spelling decodes to a given byte string.
 */
export function b64urlDecodeBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('Not valid base64url.')
  const bytes = binToBytes(atob(s.replace(/-/g, '+').replace(/_/g, '/')))
  if (b64urlEncodeBytes(bytes) !== s) throw new Error('Not canonical base64url.')
  return bytes
}

/** Lenient decode for a user's HMAC secret: base64 or base64url, padding optional. */
export function b64DecodeLenient(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  return binToBytes(atob(clean))
}

export function b64urlDecodeString(s: string): string {
  return new TextDecoder().decode(b64urlDecodeBytes(s))
}

export interface ParsedJwt {
  /** The decoded JSON text exactly as it appears in the token. */
  headerJson: string
  payloadJson: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  headerDuplicates: string[]
  payloadDuplicates: string[]
  signatureB64: string
  signingInput: string
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseJwt(token: string): ParsedJwt | { error: string } {
  const trimmed = token.trim()
  if (!trimmed) return { error: 'Paste a JWT to decode it.' }
  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return { error: `A JWT has 3 dot-separated parts — got ${parts.length}.` }
  }
  const [h, p, s] = parts
  let headerJson: string
  let payloadJson: string
  try {
    headerJson = b64urlDecodeString(h)
  } catch {
    return { error: 'Header is not valid base64url.' }
  }
  try {
    payloadJson = b64urlDecodeString(p)
  } catch {
    return { error: 'Payload is not valid base64url.' }
  }
  let header: unknown
  let payload: unknown
  try {
    header = JSON.parse(headerJson)
  } catch {
    return { error: 'Header is not valid JSON.' }
  }
  try {
    payload = JSON.parse(payloadJson)
  } catch {
    return { error: 'Payload is not valid JSON.' }
  }
  if (!isObject(header)) return { error: 'Header must be a JSON object.' }
  if (!isObject(payload)) return { error: 'Payload must be a JSON object.' }
  try {
    b64urlDecodeBytes(s)
  } catch {
    return { error: 'Signature is not valid base64url.' }
  }
  return {
    headerJson,
    payloadJson,
    header,
    payload,
    headerDuplicates: duplicateKeys(headerJson),
    payloadDuplicates: duplicateKeys(payloadJson),
    signatureB64: s,
    signingInput: `${h}.${p}`,
  }
}

export interface ClaimTime {
  claim: 'exp' | 'iat' | 'nbf'
  label: string
  epoch: number
  iso: string
  relative: string
  problem: boolean
}

const CLAIM_LABELS = { exp: 'expires', iat: 'issued', nbf: 'not before' } as const

export function describeTimeClaims(payload: Record<string, unknown>, nowMs: number): ClaimTime[] {
  const out: ClaimTime[] = []
  for (const claim of ['exp', 'iat', 'nbf'] as const) {
    const v = payload[claim]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const deltaSec = v - nowMs / 1000
    // ECMAScript dates stop at ±8.64e15 ms; past that there is no ISO form.
    const inRange = Math.abs(v * 1000) <= 8.64e15
    out.push({
      claim,
      label: CLAIM_LABELS[claim],
      epoch: v,
      iso: inRange ? new Date(v * 1000).toISOString() : 'out of range',
      relative: inRange ? relativeTime(deltaSec) : 'out of range',
      // RFC 7519: expired once now >= exp; not yet valid while now < nbf
      problem: (claim === 'exp' && deltaSec <= 0) || (claim === 'nbf' && deltaSec > 0),
    })
  }
  return out
}

function relativeTime(deltaSec: number): string {
  const abs = Math.abs(deltaSec)
  const units: [number, string][] = [
    [31536000, 'y'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
    [1, 's'],
  ]
  for (const [size, name] of units) {
    if (abs >= size) {
      const n = Math.floor(abs / size)
      return deltaSec < 0 ? `${n}${name} ago` : `in ${n}${name}`
    }
  }
  return 'now'
}
