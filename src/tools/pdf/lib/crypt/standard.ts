/**
 * The PDF Standard security handler (ISO 32000-2 §7.6.4): password checks,
 * file-key derivation and per-object string/stream ciphers for every revision
 * in use — R2/R3 (RC4), R4 (RC4 or AES-128 crypt filters), R5/R6 (AES-256).
 * Only R6 is ever written (see encrypt.ts); the rest is for reading.
 */
import { aesKey, cbcDecrypt, cbcEncrypt, cbcEncryptRaw, concat, md5, randomBytes, rc4, sha } from './primitives'

export type Method = 'identity' | 'rc4' | 'aesv2' | 'aesv3'

export interface SecurityParams {
  /** Handler revision, /R. */
  r: number
  /** File key length in bytes. */
  keyLength: number
  o: Uint8Array
  u: Uint8Array
  oe?: Uint8Array
  ue?: Uint8Array
  p: number
  encryptMetadata: boolean
  stream: Method
  string: Method
  /** First element of the trailer /ID. */
  id: Uint8Array
}

const PASSWORD_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])

const utf8 = (s: string) => new TextEncoder().encode(s)

/** R2–R4 passwords are PDFDocEncoding; try that (as Latin-1) and UTF-8, like readers do. */
function legacyCandidates(password: string): Uint8Array[] {
  const latin1 = Uint8Array.from(password, (ch) => ch.charCodeAt(0) & 0xff)
  const asUtf8 = utf8(password)
  return sameBytes(latin1, asUtf8) ? [latin1] : [latin1, asUtf8]
}

/** R5/R6 passwords are UTF-8 after SASLprep (approximated by NFKC), at most 127 bytes. */
export function aesPasswordBytes(password: string): Uint8Array {
  return utf8(password.normalize('NFKC')).subarray(0, 127)
}

function aesCandidates(password: string): Uint8Array[] {
  const prepped = aesPasswordBytes(password)
  const raw = utf8(password).subarray(0, 127)
  return sameBytes(prepped, raw) ? [prepped] : [prepped, raw]
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  const n = Math.min(32, password.length)
  out.set(password.subarray(0, n))
  out.set(PASSWORD_PAD.subarray(0, 32 - n), n)
  return out
}

function int32le(n: number): Uint8Array {
  const v = n >>> 0
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])
}

function xorKey(key: Uint8Array, i: number): Uint8Array {
  return key.map((b) => b ^ i)
}

/** Algorithm 2: the file key from a (padded) user password. */
export function legacyFileKey(padded: Uint8Array, p: SecurityParams): Uint8Array {
  const extra = p.r >= 4 && !p.encryptMetadata ? new Uint8Array([0xff, 0xff, 0xff, 0xff]) : new Uint8Array(0)
  const n = p.r === 2 ? 5 : p.keyLength
  let hash = md5(concat(padded, p.o.subarray(0, 32), int32le(p.p), p.id, extra))
  if (p.r >= 3) for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, n))
  return hash.slice(0, n)
}

/** Algorithms 4/5: the /U value a file key produces (first 16 bytes significant for R3+). */
export function legacyUserValue(key: Uint8Array, p: SecurityParams): Uint8Array {
  if (p.r === 2) return rc4(key, PASSWORD_PAD)
  let x = rc4(key, md5(concat(PASSWORD_PAD, p.id)))
  for (let i = 1; i <= 19; i++) x = rc4(xorKey(key, i), x)
  return concat(x, new Uint8Array(16))
}

/** Algorithm 3 steps a–d: the RC4 key an owner password unlocks /O with. */
export function legacyOwnerKey(ownerPassword: Uint8Array, p: SecurityParams): Uint8Array {
  let hash = md5(padPassword(ownerPassword))
  if (p.r >= 3) for (let i = 0; i < 50; i++) hash = md5(hash)
  return hash.slice(0, p.r === 2 ? 5 : p.keyLength)
}

function legacyCheckUser(key: Uint8Array, p: SecurityParams): boolean {
  const expected = legacyUserValue(key, p)
  const n = p.r === 2 ? 32 : 16
  return sameBytes(expected.subarray(0, n), p.u.subarray(0, n))
}

/** Algorithm 2.B (R6) or plain SHA-256 (R5). */
export async function aesHash(r: number, password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concat(password, salt, udata))
  if (r === 5) return k
  let e: Uint8Array = new Uint8Array(0)
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const block = concat(password, k, udata)
    const k1 = new Uint8Array(block.length * 64)
    for (let j = 0; j < 64; j++) k1.set(block, j * block.length)
    e = await cbcEncryptRaw(await aesKey(k.subarray(0, 16)), k.subarray(16, 32), k1)
    let sum = 0
    for (let j = 0; j < 16; j++) sum += e[j]
    k = await sha(([256, 384, 512] as const)[sum % 3], e)
  }
  return k.subarray(0, 32)
}

const ZERO_IV = new Uint8Array(16)

/**
 * Returns the file key the password unlocks, as user or as owner, or null.
 * An empty password is how documents with only an owner password open.
 */
export async function authenticate(p: SecurityParams, password: string): Promise<Uint8Array | null> {
  if (p.r >= 5) {
    if (!p.ue || !p.oe || p.u.length < 48 || p.o.length < 48) return null
    for (const pw of aesCandidates(password)) {
      if (sameBytes(await aesHash(p.r, pw, p.u.subarray(32, 40), new Uint8Array(0)), p.u.subarray(0, 32))) {
        const wrap = await aesKey(await aesHash(p.r, pw, p.u.subarray(40, 48), new Uint8Array(0)))
        return cbcDecrypt(wrap, ZERO_IV, p.ue.subarray(0, 32), false)
      }
      const u48 = p.u.subarray(0, 48)
      if (sameBytes(await aesHash(p.r, pw, p.o.subarray(32, 40), u48), p.o.subarray(0, 32))) {
        const wrap = await aesKey(await aesHash(p.r, pw, p.o.subarray(40, 48), u48))
        return cbcDecrypt(wrap, ZERO_IV, p.oe.subarray(0, 32), false)
      }
    }
    return null
  }
  const candidates = legacyCandidates(password)
  for (const pw of candidates) {
    const key = legacyFileKey(padPassword(pw), p)
    if (legacyCheckUser(key, p)) return key
  }
  for (const pw of candidates) {
    const ownerKey = legacyOwnerKey(pw, p)
    let user = p.o.subarray(0, 32)
    if (p.r === 2) user = rc4(ownerKey, user)
    else for (let i = 19; i >= 0; i--) user = rc4(xorKey(ownerKey, i), user)
    const key = legacyFileKey(user, p)
    if (legacyCheckUser(key, p)) return key
  }
  return null
}

/** Encrypts or decrypts the strings and streams of one object. */
export class ObjectCipher {
  private readonly keys = new Map<string, Promise<CryptoKey>>()

  constructor(private readonly fileKey: Uint8Array, private readonly p: Pick<SecurityParams, 'stream' | 'string'>) {}

  private objectKey(num: number, gen: number, aes: boolean): Uint8Array {
    const salt = aes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0)
    const id = new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff])
    return md5(concat(this.fileKey, id, salt)).slice(0, Math.min(this.fileKey.length + 5, 16))
  }

  private aes(num: number, gen: number, method: 'aesv2' | 'aesv3'): Promise<CryptoKey> {
    const id = method === 'aesv3' ? '' : `${num} ${gen}`
    let key = this.keys.get(id)
    if (!key) {
      key = aesKey(method === 'aesv3' ? this.fileKey : this.objectKey(num, gen, true))
      this.keys.set(id, key)
    }
    return key
  }

  async decrypt(data: Uint8Array, num: number, gen: number, kind: 'stream' | 'string'): Promise<Uint8Array> {
    const method = this.p[kind]
    if (method === 'identity') return data
    if (method === 'rc4') return rc4(this.objectKey(num, gen, false), data)
    if (data.length < 16) return new Uint8Array(0)
    return cbcDecrypt(await this.aes(num, gen, method), data.subarray(0, 16), data.subarray(16), true)
  }

  async encrypt(data: Uint8Array, num: number, gen: number, kind: 'stream' | 'string'): Promise<Uint8Array> {
    const method = this.p[kind]
    if (method === 'identity') return data
    if (method === 'rc4') return rc4(this.objectKey(num, gen, false), data)
    const iv = randomBytes(16)
    return concat(iv, await cbcEncrypt(await this.aes(num, gen, method), iv, data))
  }
}

/** Everything an R6 (AES-256) /Encrypt dictionary needs, for a fresh random file key. */
export async function createR6(userPassword: string, ownerPassword: string, permissions: number) {
  const fileKey = randomBytes(32)
  const upw = aesPasswordBytes(userPassword)
  const opw = aesPasswordBytes(ownerPassword)
  const [uvs, uks, ovs, oks] = [randomBytes(8), randomBytes(8), randomBytes(8), randomBytes(8)]
  const none = new Uint8Array(0)

  const u = concat(await aesHash(6, upw, uvs, none), uvs, uks)
  const ue = await cbcEncryptRaw(await aesKey(await aesHash(6, upw, uks, none)), ZERO_IV, fileKey)
  const o = concat(await aesHash(6, opw, ovs, u), ovs, oks)
  const oe = await cbcEncryptRaw(await aesKey(await aesHash(6, opw, oks, u)), ZERO_IV, fileKey)
  const permsBlock = concat(int32le(permissions), new Uint8Array([0xff, 0xff, 0xff, 0xff]), utf8('Tadb'), randomBytes(4))
  const perms = await cbcEncryptRaw(await aesKey(fileKey), ZERO_IV, permsBlock)
  return { fileKey, o, u, oe, ue, perms }
}
