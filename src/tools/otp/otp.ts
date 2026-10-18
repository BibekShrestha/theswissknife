/**
 * HOTP (RFC 4226) and TOTP (RFC 6238) on WebCrypto's HMAC. TOTP is HOTP
 * with the counter T = floor((unix time − T0) / period), T0 = 0.
 */

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512'
export type OtpType = 'totp' | 'hotp'

export const ALGORITHMS: Algorithm[] = ['SHA1', 'SHA256', 'SHA512']
export const MIN_DIGITS = 6
export const MAX_DIGITS = 8
export const DEFAULT_PERIOD = 30
export const MAX_COUNTER = (1n << 64n) - 1n

const WEBCRYPTO_HASH: Record<Algorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }

export function importSecret(secret: Uint8Array, algorithm: Algorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: WEBCRYPTO_HASH[algorithm] }, false, ['sign'])
}

/** The 8-byte big-endian counter HOTP signs. */
export function counterBytes(counter: bigint): Uint8Array {
  if (counter < 0n || counter > MAX_COUNTER) throw new RangeError('The counter must be between 0 and 2^64 − 1')
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, counter)
  return out
}

/** RFC 4226 §5.3 dynamic truncation: a 31-bit integer picked out of the HMAC by its last nibble. */
export function truncate(hmac: Uint8Array): number {
  const offset = hmac[hmac.length - 1] & 0x0f
  return ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
}

export async function hmac(key: CryptoKey, counter: bigint): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter) as BufferSource))
}

export async function hotp(key: CryptoKey, counter: bigint, digits: number): Promise<string> {
  const value = truncate(await hmac(key, counter)) % 10 ** digits
  return String(value).padStart(digits, '0')
}

/** The TOTP counter for a Unix time in seconds. */
export function totpCounter(unixSeconds: number, period: number): bigint {
  return BigInt(Math.floor(unixSeconds / period))
}

export function totp(key: CryptoKey, unixSeconds: number, period: number, digits: number): Promise<string> {
  return hotp(key, totpCounter(unixSeconds, period), digits)
}

export interface Match {
  counter: bigint
  /** Counter − the centre it was searched around. */
  offset: number
}

/**
 * Looks for `code` at counters centre−window … centre+window, nearest first,
 * so a code that appears twice reports the smaller offset. Counters below 0
 * or above 2^64 − 1 are skipped.
 */
export async function findCode(key: CryptoKey, code: string, centre: bigint, window: number, digits: number): Promise<Match | null> {
  const offsets = [0]
  for (let i = 1; i <= window; i++) offsets.push(-i, i)
  for (const offset of offsets) {
    const counter = centre + BigInt(offset)
    if (counter < 0n || counter > MAX_COUNTER) continue
    if (await hotp(key, counter, digits) === code) return { counter, offset }
  }
  return null
}
