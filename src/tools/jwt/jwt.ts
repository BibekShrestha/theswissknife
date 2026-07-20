/** JWT parsing and claim helpers — pure functions, no crypto here. */

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

export function b64urlDecodeBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function b64urlDecodeString(s: string): string {
  return new TextDecoder().decode(b64urlDecodeBytes(s))
}

export interface ParsedJwt {
  headerJson: string
  payloadJson: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signatureB64: string
  signingInput: string
}

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
  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(headerJson) as Record<string, unknown>
  } catch {
    return { error: 'Header is not valid JSON.' }
  }
  try {
    payload = JSON.parse(payloadJson) as Record<string, unknown>
  } catch {
    return { error: 'Payload is not valid JSON.' }
  }
  return { headerJson, payloadJson, header, payload, signatureB64: s, signingInput: `${h}.${p}` }
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
    const deltaSec = Math.round(v - nowMs / 1000)
    out.push({
      claim,
      label: CLAIM_LABELS[claim],
      epoch: v,
      iso: new Date(v * 1000).toISOString(),
      relative: relativeTime(deltaSec),
      problem: (claim === 'exp' && deltaSec < 0) || (claim === 'nbf' && deltaSec > 0),
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
      const n = Math.round(abs / size)
      return deltaSec < 0 ? `${n}${name} ago` : `in ${n}${name}`
    }
  }
  return 'now'
}
