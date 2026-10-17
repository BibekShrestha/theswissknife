/**
 * ULID (https://github.com/ulid/spec): 48-bit Unix-millisecond timestamp
 * followed by 80 random bits, written as 26 Crockford base32 characters.
 * 26 × 5 = 130 bits, so the first character carries only 3 bits and may not
 * exceed '7' — "7ZZZZZZZZZZZZZZZZZZZZZZZZZ" is the largest legal ULID.
 */

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const ULID_MAX = '7ZZZZZZZZZZZZZZZZZZZZZZZZZ'
export const ULID_TIME_MAX = 2 ** 48 - 1

export type Rng = (bytes: Uint8Array<ArrayBuffer>) => void
export const cryptoRng: Rng = (bytes) => { crypto.getRandomValues(bytes) }

/** Crockford decoding: case-insensitive, I and L read as 1, O as 0. U is not a digit. */
function digitValue(char: string): number {
  const upper = char.toUpperCase()
  if (upper === 'I' || upper === 'L') return 1
  if (upper === 'O') return 0
  return CROCKFORD.indexOf(upper)
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

export function bigIntToBytes(value: bigint, length = 16): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

export type UlidParse = { bytes: Uint8Array; error: null } | { bytes: null; error: string }

/** Decodes a 26-character ULID into its 16 bytes. */
export function parseUlid(input: string): UlidParse {
  const text = input.trim()
  if (text.length !== 26) return { bytes: null, error: `A ULID is 26 characters; got ${text.length}.` }
  let value = 0n
  for (let i = 0; i < text.length; i++) {
    const digit = digitValue(text[i])
    if (digit < 0) return { bytes: null, error: `'${text[i]}' at position ${i + 1} is not a Crockford base32 digit.` }
    value = (value << 5n) | BigInt(digit)
  }
  if (value >> 128n) return { bytes: null, error: `ULID overflows 128 bits — the largest is ${ULID_MAX}.` }
  return { bytes: bigIntToBytes(value), error: null }
}

/** Encodes 16 bytes as a canonical (uppercase) ULID. */
export function encodeUlid(bytes: Uint8Array): string {
  let value = bytesToBigInt(bytes)
  let out = ''
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out
    value >>= 5n
  }
  return out
}

/** The 48-bit millisecond timestamp in the first six bytes. */
export function ulidTime(bytes: Uint8Array): number {
  let ms = 0
  for (let i = 0; i < 6; i++) ms = ms * 256 + bytes[i]
  return ms
}

/**
 * Monotonic ULID factory. Within one millisecond (or if the clock steps
 * backwards) the previous 80-bit random part is incremented by one, as the
 * spec's monotonic mode describes, so a batch sorts in generation order.
 * Where the spec would throw on random overflow we move to the next
 * millisecond instead — 2^80 IDs in one millisecond will not happen.
 */
export function createUlidGenerator(rng: Rng = cryptoRng, now: () => number = Date.now) {
  let lastTime = -1
  let lastRandom = 0n
  const RANDOM_MAX = (1n << 80n) - 1n
  return function nextUlid(): Uint8Array {
    let time = now()
    if (!Number.isInteger(time) || time < 0 || time > ULID_TIME_MAX) throw new RangeError('Clock is outside the 48-bit ULID range.')
    let random: bigint
    if (time <= lastTime) {
      time = lastTime
      if (lastRandom === RANDOM_MAX) {
        time += 1
        random = freshRandom(rng)
      } else {
        random = lastRandom + 1n
      }
    } else {
      random = freshRandom(rng)
    }
    lastTime = time
    lastRandom = random
    const bytes = bigIntToBytes(random)
    for (let i = 5; i >= 0; i--) {
      bytes[i] = time % 256
      time = Math.floor(time / 256)
    }
    return bytes
  }
}

function freshRandom(rng: Rng): bigint {
  const bytes = new Uint8Array(10)
  rng(bytes)
  return bytesToBigInt(bytes)
}
