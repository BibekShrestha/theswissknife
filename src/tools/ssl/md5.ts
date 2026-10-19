/**
 * MD5 (RFC 1321), only for OpenSSH's legacy `MD5:` key fingerprint —
 * WebCrypto has no MD5. Never use it for anything that needs a secure hash.
 */

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5(input: Uint8Array): Uint8Array {
  const length = input.length
  const padded = new Uint8Array(((length + 8) >> 6 << 6) + 64)
  padded.set(input)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(length / 0x20000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const m = new Uint32Array(16)
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i += 1) m[i] = view.getUint32(block + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i += 1) {
      const round = i >> 4
      let f: number
      let g: number
      if (round === 0) {
        f = (b & c) | (~b & d)
        g = i
      } else if (round === 1) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) & 15
      } else if (round === 2) {
        f = b ^ c ^ d
        g = (3 * i + 5) & 15
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) & 15
      }
      const shift = S[round * 4 + (i & 3)]
      const sum = (a + f + K[i] + m[g]) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const outView = new DataView(out.buffer)
  ;[a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true))
  return out
}
