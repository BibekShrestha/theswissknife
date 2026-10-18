/**
 * Test-only X.509 builder: hand-assembled DER, signed with WebCrypto, so the
 * chain tests can produce exactly the certificate a case needs (expired CA,
 * CA:FALSE intermediate, RSA-PSS, SHA-1, duplicate SAN, impossible dates…).
 * Imported by tests only — never by the tool.
 */

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function lengthBytes(n: number): number[] {
  if (n < 0x80) return [n]
  if (n < 0x100) return [0x81, n]
  if (n < 0x10000) return [0x82, n >> 8, n & 0xff]
  return [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]
}

export const tlv = (tag: number, ...parts: Uint8Array[]) => {
  const body = concat(parts)
  return concat([Uint8Array.of(tag, ...lengthBytes(body.length)), body])
}
export const seq = (...parts: Uint8Array[]) => tlv(0x30, ...parts)
export const set = (...parts: Uint8Array[]) => tlv(0x31, ...parts)
export const ctx = (n: number, ...parts: Uint8Array[]) => tlv(0xa0 + n, ...parts)
export const octets = (bytes: Uint8Array) => tlv(0x04, bytes)
export const bits = (bytes: Uint8Array) => tlv(0x03, Uint8Array.of(0), bytes)
export const bool = (v: boolean) => tlv(0x01, Uint8Array.of(v ? 0xff : 0))
export const nul = () => Uint8Array.of(0x05, 0)
export const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s))
export const printable = (s: string) => tlv(0x13, new TextEncoder().encode(s))
export const ascii = (s: string) => new TextEncoder().encode(s)

export function int(v: number | Uint8Array): Uint8Array {
  let bytes: number[]
  if (typeof v === 'number') {
    bytes = []
    do {
      bytes.unshift(v & 0xff)
      v = Math.floor(v / 256)
    } while (v > 0)
  } else {
    bytes = Array.from(v)
    while (bytes.length > 1 && bytes[0] === 0) bytes.shift()
  }
  if (bytes[0] & 0x80) bytes.unshift(0)
  return tlv(0x02, Uint8Array.from(bytes))
}

export function oid(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map(Number)
  const out = [40 * arcs[0] + arcs[1]]
  for (const arc of arcs.slice(2)) {
    const chunk = [arc & 0x7f]
    for (let v = Math.floor(arc / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80)
    out.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(out))
}

const two = (n: number) => String(n).padStart(2, '0')
export function utcTime(d: Date): Uint8Array {
  return tlv(0x17, ascii(`${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`))
}

export function name(cn: string, extra: Uint8Array[] = []): Uint8Array {
  return seq(...extra, set(seq(oid('2.5.4.3'), utf8(cn))))
}

export type KeyKind = 'rsa' | 'ec' | 'ec384' | 'ed25519'
export interface TestKey { kind: KeyKind; spki: Uint8Array; pkcs8: Uint8Array }

export async function makeKey(kind: KeyKind): Promise<TestKey> {
  const params =
    kind === 'rsa'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1) }
      : kind === 'ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', namedCurve: kind === 'ec' ? 'P-256' : 'P-384' }
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair
  return {
    kind,
    spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
    pkcs8: new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  }
}

export type SigAlg = 'rsa-sha256' | 'rsa-sha1' | 'rsa-pss-sha256' | 'ecdsa-sha256' | 'ed25519'

export function algorithmId(alg: SigAlg): Uint8Array {
  switch (alg) {
    case 'rsa-sha256': return seq(oid('1.2.840.113549.1.1.11'), nul())
    case 'rsa-sha1': return seq(oid('1.2.840.113549.1.1.5'), nul())
    case 'ecdsa-sha256': return seq(oid('1.2.840.10045.4.3.2'))
    case 'ed25519': return seq(oid('1.3.101.112'))
    case 'rsa-pss-sha256': {
      const sha256 = seq(oid('2.16.840.1.101.3.4.2.1'), nul())
      return seq(oid('1.2.840.113549.1.1.10'), seq(ctx(0, sha256), ctx(1, seq(oid('1.2.840.113549.1.1.8'), sha256)), ctx(2, int(32))))
    }
  }
}

function rawToDerEcdsa(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2
  return seq(int(raw.slice(0, half)), int(raw.slice(half)))
}

export async function sign(key: TestKey, alg: SigAlg, data: Uint8Array): Promise<Uint8Array> {
  const pkcs8 = key.pkcs8 as BufferSource
  const body = data as BufferSource
  if (alg === 'rsa-sha256' || alg === 'rsa-sha1') {
    const k = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSASSA-PKCS1-v1_5', hash: alg === 'rsa-sha1' ? 'SHA-1' : 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, body))
  }
  if (alg === 'rsa-pss-sha256') {
    const k = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, k, body))
  }
  if (alg === 'ecdsa-sha256') {
    const k = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDSA', namedCurve: key.kind === 'ec' ? 'P-256' : 'P-384' }, false, ['sign'])
    return rawToDerEcdsa(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, body)))
  }
  const k = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('Ed25519', k, body))
}

export const defaultAlg = (key: TestKey): SigAlg => (key.kind === 'rsa' ? 'rsa-sha256' : key.kind === 'ed25519' ? 'ed25519' : 'ecdsa-sha256')

export const KU = { digitalSignature: 0, keyEncipherment: 2, keyCertSign: 5, cRLSign: 6 } as const

export interface CertSpec {
  subject: string | Uint8Array
  issuer?: string | Uint8Array
  key: TestKey
  signer?: TestKey
  alg?: SigAlg
  /** algorithm placed inside the TBS, when it should differ from the outer one */
  tbsAlg?: SigAlg
  notBefore?: Date
  notAfter?: Date
  validity?: Uint8Array
  /** basicConstraints: omitted when undefined */
  ca?: boolean
  pathLen?: number
  keyUsage?: number[]
  dns?: string[]
  ips?: Uint8Array[]
  extensions?: Uint8Array[]
  /** raw AlgorithmIdentifier DER for the TBS (for algorithms WebCrypto cannot sign) */
  rawAlg?: Uint8Array
}

export const extension = (id: string, value: Uint8Array, critical = false) =>
  seq(oid(id), ...(critical ? [bool(true)] : []), octets(value))

export function sanExtension(dns: string[] = [], ips: Uint8Array[] = []): Uint8Array {
  return extension('2.5.29.17', seq(...dns.map((d) => tlv(0x82, ascii(d))), ...ips.map((ip) => tlv(0x87, ip))))
}

function keyUsageBits(list: number[]): Uint8Array {
  const bytes = new Uint8Array(2)
  for (const bit of list) bytes[bit >> 3] |= 0x80 >> (bit & 7)
  const used = bytes[1] ? 2 : 1
  return tlv(0x03, Uint8Array.of(0), bytes.slice(0, used))
}

const asName = (n: string | Uint8Array) => (typeof n === 'string' ? name(n) : n)

export function tbsFor(spec: CertSpec, serial = 1): Uint8Array {
  const alg = spec.alg ?? defaultAlg(spec.signer ?? spec.key)
  const exts: Uint8Array[] = []
  if (spec.ca !== undefined) {
    exts.push(extension('2.5.29.19', seq(...(spec.ca ? [bool(true)] : []), ...(spec.pathLen !== undefined ? [int(spec.pathLen)] : [])), true))
  }
  if (spec.keyUsage) exts.push(extension('2.5.29.15', keyUsageBits(spec.keyUsage), true))
  if (spec.dns || spec.ips) exts.push(sanExtension(spec.dns, spec.ips))
  exts.push(...(spec.extensions ?? []))
  const validity = spec.validity ?? seq(utcTime(spec.notBefore ?? new Date(Date.now() - 86_400_000)), utcTime(spec.notAfter ?? new Date(Date.now() + 365 * 86_400_000)))
  return seq(
    ctx(0, int(2)),
    int(serial),
    spec.rawAlg ?? algorithmId(spec.tbsAlg ?? alg),
    asName(spec.issuer ?? spec.subject),
    validity,
    asName(spec.subject),
    spec.key.spki,
    ...(exts.length ? [ctx(3, seq(...exts))] : []),
  )
}

let serials = 1
export async function makeCert(spec: CertSpec): Promise<Uint8Array> {
  const alg = spec.alg ?? defaultAlg(spec.signer ?? spec.key)
  const tbs = tbsFor(spec, serials++)
  const signature = await sign(spec.signer ?? spec.key, alg, tbs)
  return seq(tbs, algorithmId(alg), bits(signature))
}

/** A certificate "signed" with an algorithm this tool cannot check (DSA), random signature bytes. */
export function unsignableCert(spec: CertSpec): Uint8Array {
  const dsa = seq(oid('1.2.840.10040.4.3'))
  return seq(tbsFor({ ...spec, rawAlg: dsa }, serials++), dsa, bits(crypto.getRandomValues(new Uint8Array(46))))
}

export function pem(der: Uint8Array, label = 'CERTIFICATE'): string {
  let bin = ''
  for (const b of der) bin += String.fromCharCode(b)
  return `-----BEGIN ${label}-----\n${btoa(bin).replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----\n`
}

/** A small, valid three-certificate chain plus its keys, for building variants. */
export async function standardChain() {
  const rootKey = await makeKey('rsa')
  const interKey = await makeKey('ec')
  const leafKey = await makeKey('ec')
  const root = await makeCert({ subject: 'Test Root', key: rootKey, ca: true, keyUsage: [KU.keyCertSign, KU.cRLSign] })
  const inter = await makeCert({ subject: 'Test Intermediate', issuer: 'Test Root', key: interKey, signer: rootKey, ca: true, pathLen: 0, keyUsage: [KU.keyCertSign, KU.cRLSign] })
  const leaf = await makeCert({ subject: 'www.example.com', issuer: 'Test Intermediate', key: leafKey, signer: interKey, ca: false, keyUsage: [KU.digitalSignature], dns: ['www.example.com'] })
  return { rootKey, interKey, leafKey, root, inter, leaf }
}
