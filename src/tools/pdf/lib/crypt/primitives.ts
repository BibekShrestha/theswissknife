/**
 * The cryptographic building blocks of the PDF Standard security handler.
 * WebCrypto has SHA-2 and AES but not MD5 or RC4, which the older handler
 * revisions (R2–R4) are built on — those two are written out here.
 */

const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0)

export function md5(data: Uint8Array): Uint8Array {
  const len = data.length
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64)
  padded.set(data)
  padded[len] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476
  const m = new Int32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getInt32(off + i * 4, true)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      f = (f + a + MD5_K[i] + m[g]) | 0
      a = d
      d = c
      c = b
      b = (b + ((f << MD5_SHIFT[i]) | (f >>> (32 - MD5_SHIFT[i])))) | 0
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }
  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  outView.setInt32(0, a0, true)
  outView.setInt32(4, b0, true)
  outView.setInt32(8, c0, true)
  outView.setInt32(12, d0, true)
  return out
}

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]) & 255
    const t = s[i]; s[i] = s[j]; s[j] = t
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}

/** A copy backed by a plain ArrayBuffer, which is what WebCrypto's types ask for. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(`SHA-${bits}`, own(data)))
}

export function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', own(raw), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt'])
}

/** AES-CBC with PKCS#7 padding, which is what PDF strings and streams use. */
export async function cbcEncrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: own(iv) }, key, own(data)))
}

/** AES-CBC over whole blocks with no padding (the R6 key wraps and hash). */
export async function cbcEncryptRaw(key: CryptoKey, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error('cbcEncryptRaw needs whole blocks')
  return (await cbcEncrypt(key, iv, data)).subarray(0, data.length)
}

/**
 * AES-CBC decryption that never rejects over padding. WebCrypto insists on
 * valid PKCS#7, so a block that decrypts to exactly that padding is appended
 * (E(0x10… XOR last ciphertext block), via a one-block CBC encryption) and
 * WebCrypto strips it again, returning the raw plaintext. Padding, if
 * present, is then removed only when it is well formed — real files carry
 * truncated and badly padded strings, and pdf.js reads them too.
 */
export async function cbcDecrypt(key: CryptoKey, iv: Uint8Array, data: Uint8Array, unpad: boolean): Promise<Uint8Array> {
  const n = data.length - (data.length % 16)
  if (n === 0) return new Uint8Array(0)
  const body = data.subarray(0, n)
  const filler = (await cbcEncrypt(key, body.subarray(n - 16), new Uint8Array(16).fill(16))).subarray(0, 16)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: own(iv) }, key, own(concat(body, filler))))
  if (!unpad) return plain
  const pad = plain[plain.length - 1]
  if (pad < 1 || pad > 16 || pad > plain.length) return plain
  for (let i = plain.length - pad; i < plain.length; i++) if (plain[i] !== pad) return plain
  return plain.subarray(0, plain.length - pad)
}
