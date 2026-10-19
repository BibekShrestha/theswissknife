import {
  bitStringBytes, children, concatBytes, encode, encodeBits, encodeNull, encodeOid, encodeUint,
  expectTag, hex, oid, readWhole, toBase64, uintBytes, type AsnNode,
} from './der'
import { md5 } from './md5'

/**
 * Public keys in every encoding the tool reads (SubjectPublicKeyInfo,
 * PKCS#1, OpenSSH wire format) reduced to one model, so a certificate, a
 * CSR, a private key and an `ssh-ed25519 …` line can be compared and
 * fingerprinted the same way.
 */

export const RSA_OID = '1.2.840.113549.1.1.1'
export const RSA_PSS_OID = '1.2.840.113549.1.1.10'
export const EC_OID = '1.2.840.10045.2.1'
export const DSA_OID = '1.2.840.10040.4.1'

export const CURVES: Record<string, { label: string; webCrypto?: string; ssh?: string; size: number }> = {
  '1.2.840.10045.3.1.7': { label: 'P-256', webCrypto: 'P-256', ssh: 'nistp256', size: 32 },
  '1.3.132.0.34': { label: 'P-384', webCrypto: 'P-384', ssh: 'nistp384', size: 48 },
  '1.3.132.0.35': { label: 'P-521', webCrypto: 'P-521', ssh: 'nistp521', size: 66 },
  '1.3.132.0.10': { label: 'secp256k1', size: 32 },
}

/** RFC 8410 algorithms: the key is the raw bytes, no parameters. */
export const OKP: Record<string, { name: string; size: number; ssh?: string }> = {
  '1.3.101.112': { name: 'Ed25519', size: 32, ssh: 'ssh-ed25519' },
  '1.3.101.113': { name: 'Ed448', size: 57, ssh: 'ssh-ed448' },
  '1.3.101.110': { name: 'X25519', size: 32 },
  '1.3.101.111': { name: 'X448', size: 56 },
}

export type KeyMaterial =
  | { type: 'RSA'; n: Uint8Array; e: Uint8Array; pss: boolean }
  | { type: 'EC'; curveOid: string; point: Uint8Array }
  | { type: 'OKP'; oid: string; raw: Uint8Array }
  | { type: 'DSA'; p: Uint8Array; q: Uint8Array; g: Uint8Array; y: Uint8Array }
  /** FIDO security-key SSH keys: no SPKI form, only the OpenSSH blob */
  | { type: 'SK'; blob: Uint8Array; base: string }

export interface PublicKey {
  /** 'RSA', 'EC', 'Ed25519', 'X25519', 'DSA', … or the algorithm OID */
  algorithm: string
  /** '2048-bit RSA', 'P-256 elliptic curve', … */
  detail: string
  bits?: number
  /** WebCrypto curve name, when WebCrypto has the curve */
  curve?: string
  /** SubjectPublicKeyInfo DER: as supplied, or rebuilt the way OpenSSL writes it */
  spki?: Uint8Array
  /** OpenSSH wire-format blob, when the key has an OpenSSH form */
  ssh?: Uint8Array
  /** the same string for the same key whatever its encoding; null when the key cannot be compared */
  identity: string | null
}

const stripZeros = (bytes: Uint8Array) => {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  return bytes.slice(start)
}

function bitLength(magnitude: Uint8Array): number {
  const bytes = stripZeros(magnitude)
  if (!bytes.length || (bytes.length === 1 && bytes[0] === 0)) return 0
  return (bytes.length - 1) * 8 + (32 - Math.clz32(bytes[0]))
}

// ---- OpenSSH wire format (RFC 4251 §5) ----

const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
export const sshString = (bytes: Uint8Array) => concatBytes([u32(bytes.length), bytes])
const sshText = (value: string) => sshString(new TextEncoder().encode(value))
function sshMpint(magnitude: Uint8Array): Uint8Array {
  const bytes = stripZeros(magnitude)
  if (bytes.length === 1 && bytes[0] === 0) return sshString(new Uint8Array(0))
  return sshString(bytes[0] & 0x80 ? concatBytes([Uint8Array.of(0), bytes]) : bytes)
}

/** A cursor over OpenSSH's length-prefixed fields; every read is bounds-checked. */
export class SshReader {
  private at = 0
  constructor(private readonly bytes: Uint8Array, private readonly what: string) {}
  get done() { return this.at === this.bytes.length }
  get offset() { return this.at }
  uint32(): number {
    if (this.at + 4 > this.bytes.length) throw new Error(`${this.what} is truncated`)
    const b = this.bytes
    const value = ((b[this.at] << 24) >>> 0) + (b[this.at + 1] << 16) + (b[this.at + 2] << 8) + b[this.at + 3]
    this.at += 4
    return value
  }
  bytesField(): Uint8Array {
    const length = this.uint32()
    if (length > this.bytes.length - this.at) throw new Error(`${this.what} is truncated`)
    const out = this.bytes.slice(this.at, this.at + length)
    this.at += length
    return out
  }
  text(): string {
    const raw = this.bytesField()
    if (raw.some((byte) => byte < 0x20 || byte > 0x7e)) throw new Error(`${this.what} has a malformed name field`)
    return new TextDecoder().decode(raw)
  }
  /** An mpint's magnitude; negative and non-minimal encodings are refused. */
  mpint(): Uint8Array {
    const raw = this.bytesField()
    if (!raw.length) return Uint8Array.of(0)
    if (raw[0] & 0x80) throw new Error(`${this.what} has a negative integer`)
    if (raw[0] === 0 && (raw.length === 1 || !(raw[1] & 0x80))) throw new Error(`${this.what} has a non-minimal integer`)
    return raw[0] === 0 ? raw.slice(1) : raw
  }
  rest(): Uint8Array { return this.bytes.slice(this.at) }
}

// ---- building ----

function rsaSpki(n: Uint8Array, e: Uint8Array): Uint8Array {
  return encode(0x30, encode(0x30, encodeOid(RSA_OID), encodeNull()), encodeBits(encode(0x30, encodeUint(n), encodeUint(e))))
}

/** The key, described, with its canonical SPKI and OpenSSH forms. `spki` is kept as supplied when given. */
export function describeKey(material: KeyMaterial, suppliedSpki?: Uint8Array): PublicKey {
  if (material.type === 'RSA') {
    const bits = bitLength(material.n)
    return {
      algorithm: 'RSA',
      detail: `${bits}-bit RSA${material.pss ? ' (PSS only)' : ''}`,
      bits,
      spki: suppliedSpki ?? rsaSpki(material.n, material.e),
      ssh: concatBytes([sshText('ssh-rsa'), sshMpint(material.e), sshMpint(material.n)]),
      identity: `rsa:${hex(stripZeros(material.n))}:${hex(stripZeros(material.e))}`,
    }
  }
  if (material.type === 'EC') {
    const curve = CURVES[material.curveOid]
    const label = curve?.label ?? `curve ${material.curveOid}`
    const uncompressed = material.point[0] === 0x04
    return {
      algorithm: 'EC',
      detail: curve ? `${curve.label} elliptic curve` : `EC curve ${material.curveOid}`,
      bits: curve ? curve.size * 8 - (curve.label === 'P-521' ? 7 : 0) : undefined,
      curve: curve?.webCrypto,
      spki: suppliedSpki ?? encode(0x30, encode(0x30, encodeOid(EC_OID), encodeOid(material.curveOid)), encodeBits(material.point)),
      ssh: curve?.ssh && uncompressed ? concatBytes([sshText(`ecdsa-sha2-${curve.ssh}`), sshText(curve.ssh), sshString(material.point)]) : undefined,
      // a compressed point would need a square root to compare; it is compared as written
      identity: `ec:${label}:${hex(material.point)}`,
    }
  }
  if (material.type === 'OKP') {
    const info = OKP[material.oid]
    return {
      algorithm: info?.name ?? material.oid,
      detail: info?.name ?? material.oid,
      bits: info ? info.size * 8 : undefined,
      curve: undefined,
      spki: suppliedSpki ?? encode(0x30, encode(0x30, encodeOid(material.oid)), encodeBits(material.raw)),
      ssh: info?.ssh ? concatBytes([sshText(info.ssh), sshString(material.raw)]) : undefined,
      identity: `okp:${material.oid}:${hex(material.raw)}`,
    }
  }
  if (material.type === 'DSA') {
    const bits = bitLength(material.p)
    const params = encode(0x30, encodeUint(material.p), encodeUint(material.q), encodeUint(material.g))
    return {
      algorithm: 'DSA',
      detail: `${bits}-bit DSA`,
      bits,
      spki: suppliedSpki ?? encode(0x30, encode(0x30, encodeOid(DSA_OID), params), encodeBits(encodeUint(material.y))),
      ssh: concatBytes([sshText('ssh-dss'), ...[material.p, material.q, material.g, material.y].map(sshMpint)]),
      identity: `dsa:${[material.p, material.q, material.g, material.y].map((v) => hex(stripZeros(v))).join(':')}`,
    }
  }
  return {
    algorithm: material.base,
    detail: `${material.base} on a FIDO security key`,
    ssh: material.blob,
    identity: null,
  }
}

// ---- reading ----

function rsaMaterial(sequence: AsnNode, pss: boolean): KeyMaterial {
  const fields = children(expectTag(sequence, 0x30, 'RSA public key'))
  if (fields.length !== 2) throw new Error('RSA public key must hold exactly a modulus and an exponent')
  return { type: 'RSA', n: uintBytes(fields[0], 'RSA modulus'), e: uintBytes(fields[1], 'RSA exponent'), pss }
}

/** PKCS#1 RSAPublicKey (`RSA PUBLIC KEY`). */
export function parsePkcs1Public(der: Uint8Array): PublicKey {
  return describeKey(rsaMaterial(readWhole(der, 'RSA public key'), false))
}

/** The key inside a SubjectPublicKeyInfo node (certificate, CSR or `PUBLIC KEY`). */
export function spkiMaterial(spki: AsnNode): KeyMaterial | { type: 'unknown'; oid: string } {
  const fields = children(expectTag(spki, 0x30, 'SubjectPublicKeyInfo'))
  if (fields.length !== 2) throw new Error('SubjectPublicKeyInfo must hold an algorithm and a key')
  const algorithm = children(expectTag(fields[0], 0x30, 'Public key algorithm'))
  const algorithmOid = oid(expectTag(algorithm[0], 0x06, 'Public key algorithm'))
  const key = bitStringBytes(fields[1], 'Public key')
  if (algorithmOid === RSA_OID || algorithmOid === RSA_PSS_OID) return rsaMaterial(readWhole(key, 'RSA public key'), algorithmOid === RSA_PSS_OID)
  if (algorithmOid === EC_OID) {
    const curveOid = oid(expectTag(algorithm[1], 0x06, 'EC named curve (explicit curve parameters are not supported)'))
    const size = CURVES[curveOid]?.size
    const valid = key[0] === 0x04 ? !size || key.length === 1 + 2 * size : (key[0] === 0x02 || key[0] === 0x03) && (!size || key.length === 1 + size)
    if (!valid) throw new Error('EC public point has the wrong length or form')
    return { type: 'EC', curveOid, point: key }
  }
  const okp = OKP[algorithmOid]
  if (okp) {
    if (algorithm.length !== 1) throw new Error(`${okp.name} keys take no algorithm parameters (RFC 8410)`)
    if (key.length !== okp.size) throw new Error(`${okp.name} public key must be ${okp.size} bytes`)
    return { type: 'OKP', oid: algorithmOid, raw: key }
  }
  if (algorithmOid === DSA_OID && algorithm[1]?.tag === 0x30) {
    const [p, q, g] = children(algorithm[1])
    return { type: 'DSA', p: uintBytes(p, 'DSA p'), q: uintBytes(q, 'DSA q'), g: uintBytes(g, 'DSA g'), y: uintBytes(readWhole(key, 'DSA public key'), 'DSA public key') }
  }
  return { type: 'unknown', oid: algorithmOid }
}

export function publicKeyFromSpkiNode(spki: AsnNode): PublicKey {
  const material = spkiMaterial(spki)
  const supplied = spki.bytes.slice(spki.start, spki.end)
  if (material.type === 'unknown') return { algorithm: material.oid, detail: material.oid, spki: supplied, identity: `spki:${hex(supplied)}` }
  return describeKey(material, supplied)
}

/** SubjectPublicKeyInfo DER (`PUBLIC KEY`). */
export function parseSpki(der: Uint8Array): PublicKey {
  return publicKeyFromSpkiNode(readWhole(der, 'Public key'))
}

const SSH_CURVE_OIDS: Record<string, string> = Object.fromEntries(
  Object.entries(CURVES).filter(([, curve]) => curve.ssh).map(([id, curve]) => [curve.ssh!, id]),
)

/** An OpenSSH public key blob (the Base64 part of an `ssh-ed25519 AAAA…` line). */
export function parseSshBlob(blob: Uint8Array): { type: string; key: PublicKey } {
  const reader = new SshReader(blob, 'OpenSSH public key')
  const type = reader.text()
  let material: KeyMaterial
  if (type === 'ssh-rsa') {
    const e = reader.mpint()
    material = { type: 'RSA', e, n: reader.mpint(), pss: false }
  } else if (type === 'ssh-ed25519' || type === 'ssh-ed448') {
    const raw = reader.bytesField()
    const id = type === 'ssh-ed25519' ? '1.3.101.112' : '1.3.101.113'
    if (raw.length !== OKP[id].size) throw new Error(`${OKP[id].name} public key must be ${OKP[id].size} bytes`)
    material = { type: 'OKP', oid: id, raw }
  } else if (type.startsWith('ecdsa-sha2-')) {
    const curveName = reader.text()
    const curveOid = SSH_CURVE_OIDS[curveName]
    if (!curveOid || type !== `ecdsa-sha2-${curveName}`) throw new Error(`Unsupported OpenSSH curve ${curveName}`)
    const point = reader.bytesField()
    if (point[0] !== 0x04 || point.length !== 1 + 2 * CURVES[curveOid].size) throw new Error('EC public point has the wrong length or form')
    material = { type: 'EC', curveOid, point }
  } else if (type === 'ssh-dss') {
    const [p, q, g, y] = [reader.mpint(), reader.mpint(), reader.mpint(), reader.mpint()]
    material = { type: 'DSA', p, q, g, y }
  } else if (type === 'sk-ssh-ed25519@openssh.com' || type === 'sk-ecdsa-sha2-nistp256@openssh.com') {
    if (type.startsWith('sk-ecdsa')) {
      reader.text()
      reader.bytesField()
    } else if (reader.bytesField().length !== 32) throw new Error('Ed25519 public key must be 32 bytes')
    reader.text() // FIDO application, e.g. "ssh:"
    material = { type: 'SK', blob, base: type.startsWith('sk-ecdsa') ? 'ECDSA P-256' : 'Ed25519' }
  } else if (type.includes('-cert-v01@openssh.com')) {
    throw new Error('OpenSSH certificates are not supported — paste the plain public key')
  } else {
    throw new Error(`Unsupported OpenSSH key type ${type}`)
  }
  if (!reader.done) throw new Error('OpenSSH public key has trailing bytes')
  return { type, key: describeKey(material) }
}

// ---- fingerprints ----

export interface Fingerprints {
  /** base64(SHA-256(SubjectPublicKeyInfo)) — HPKP / certificate pinning */
  spkiPin?: string
  /** ssh-keygen -l: SHA256:<base64, unpadded> */
  sshSha256?: string
  /** ssh-keygen -l -E md5 */
  sshMd5?: string
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

export async function fingerprints(key: PublicKey): Promise<Fingerprints> {
  const out: Fingerprints = {}
  if (key.spki) out.spkiPin = toBase64(await sha256(key.spki))
  if (key.ssh) {
    out.sshSha256 = `SHA256:${toBase64(await sha256(key.ssh)).replace(/=+$/, '')}`
    out.sshMd5 = `MD5:${hex(md5(key.ssh), ':').toLowerCase()}`
  }
  return out
}

/** Whether two keys are the same public key, whatever format each came in. */
export function sameKey(a: PublicKey | null | undefined, b: PublicKey | null | undefined): boolean {
  return Boolean(a?.identity && b?.identity && a.identity === b.identity)
}
