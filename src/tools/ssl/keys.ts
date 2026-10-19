import {
  bitStringBytes, children, content, encode, encodeOid, encodeUint, expectTag, fromBase64, oid,
  readNode, readWhole, smallUint, uintBytes, concatBytes, equalBytes, type AsnNode,
} from './der'
import {
  CURVES, DSA_OID, EC_OID, OKP, RSA_OID, RSA_PSS_OID, SshReader, describeKey, parsePkcs1Public, parseSpki,
  parseSshBlob, type KeyMaterial, type PublicKey,
} from './spki'

/**
 * Private and public keys: PKCS#8 (plain and encrypted), PKCS#1, SEC1,
 * SubjectPublicKeyInfo, OpenSSH private keys, OpenSSH public lines and
 * RFC 4716 blocks. Only public facts leave this module: the public key,
 * sizes, and how a private key is protected. Private numbers are parsed
 * only far enough to check their encoding (and, where a file omits the
 * public key, handed once to WebCrypto to derive it); nothing is decrypted.
 */

export interface KeyReport {
  kind: 'private' | 'public'
  /** 'PKCS#8', 'PKCS#1 (RSA PRIVATE KEY)', 'OpenSSH private key', … */
  format: string
  /** the public key, when the file carries or implies one */
  publicKey: PublicKey | null
  /** algorithm text when there is no public key to describe (encrypted PKCS#8) */
  algorithmHint?: string
  /** how an encrypted private key is protected — it is never decrypted */
  encryption?: string
  comment?: string
  notes: string[]
  warnings: string[]
}

export interface ParsedKey {
  report: KeyReport
  /** computes a public key the file leaves out; run once, then dropped */
  derive?: () => Promise<PublicKey | null>
}

const PROTECTED_LABELS = new Set(['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'DSA PRIVATE KEY', 'OPENSSH PRIVATE KEY'])
export const KEY_LABELS = new Set([...PROTECTED_LABELS, 'PUBLIC KEY', 'RSA PUBLIC KEY'])
export const isPrivateLabel = (label: string) => PROTECTED_LABELS.has(label)

const report = (kind: KeyReport['kind'], format: string, publicKey: PublicKey | null, extra: Partial<KeyReport> = {}): KeyReport =>
  ({ kind, format, publicKey, notes: [], warnings: [], ...extra })

function weakRsa(key: PublicKey | null, out: KeyReport): KeyReport {
  if (key?.algorithm === 'RSA' && key.bits !== undefined && key.bits < 2048) out.warnings.push(`${key.bits}-bit RSA is below the 2048-bit minimum CAs and browsers accept`)
  if (key?.algorithm === 'DSA') out.warnings.push('DSA keys are no longer accepted by browsers or by current OpenSSH')
  return out
}

// ---- RSA, EC, Ed25519 private structures ----

/** RSAPrivateKey (PKCS#1): checks every field's encoding, keeps only n and e. */
function rsaPrivate(der: Uint8Array, pss: boolean): { material: KeyMaterial; multiPrime: boolean } {
  const fields = children(expectTag(readWhole(der, 'RSA private key'), 0x30, 'RSA private key'))
  const version = smallUint(fields[0], 'RSA private key version')
  if (version > 1 || fields.length !== (version === 1 ? 10 : 9)) throw new Error('RSA private key has the wrong number of fields')
  const n = uintBytes(fields[1], 'RSA modulus')
  const e = uintBytes(fields[2], 'RSA exponent')
  for (let i = 3; i < 9; i += 1) uintBytes(fields[i], 'RSA private key field')
  return { material: { type: 'RSA', n, e, pss }, multiPrime: version === 1 }
}

function ecPoint(bytes: Uint8Array, curveOid: string): Uint8Array {
  const size = CURVES[curveOid]?.size
  const ok = bytes[0] === 0x04 ? !size || bytes.length === 1 + 2 * size : (bytes[0] === 0x02 || bytes[0] === 0x03) && (!size || bytes.length === 1 + size)
  if (!ok) throw new Error('EC public point has the wrong length or form')
  return bytes
}

/** ECPrivateKey (SEC1 / RFC 5915): the curve and, when present, the public point. */
function ecPrivate(der: Uint8Array, outerCurve?: string): { curveOid: string; point?: Uint8Array } {
  const fields = children(expectTag(readWhole(der, 'EC private key'), 0x30, 'EC private key'))
  if (smallUint(fields[0], 'EC private key version') !== 1) throw new Error('EC private key must be version 1')
  const scalar = content(expectTag(fields[1], 0x04, 'EC private scalar'))
  let curveOid = outerCurve
  let point: Uint8Array | undefined
  let at = 2
  if (fields[at]?.tag === 0xa0) {
    const [named, extra] = children(fields[at++])
    if (extra) throw new Error('Malformed EC parameters')
    const inner = oid(expectTag(named, 0x06, 'EC named curve (explicit curve parameters are not supported)'))
    if (curveOid && curveOid !== inner) throw new Error('EC private key names two different curves')
    curveOid = inner
  }
  if (fields[at]?.tag === 0xa1) {
    const [bits, extra] = children(fields[at++])
    if (extra) throw new Error('Malformed EC public key field')
    point = bitStringBytes(bits, 'EC public key')
  }
  if (at !== fields.length) throw new Error('EC private key has unexpected fields')
  if (!curveOid) throw new Error('EC private key does not name its curve')
  const size = CURVES[curveOid]?.size
  if (size && scalar.length !== size) throw new Error(`EC private scalar must be ${size} bytes for ${CURVES[curveOid].label}`)
  return { curveOid, point: point && ecPoint(point, curveOid) }
}

function b64url(value: string | undefined): Uint8Array {
  if (!value) throw new Error('missing JWK field')
  return fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'), 'JWK')
}

/**
 * Ask WebCrypto for the public half of a PKCS#8 key the file stored without
 * it. The exported JWK also holds the private value; only x/y are read.
 */
async function derivePublic(pkcs8: Uint8Array, algorithm: EcKeyImportParams | { name: string }, usages: KeyUsage[]): Promise<{ x: Uint8Array; y?: Uint8Array } | null> {
  try {
    const key = await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, algorithm, true, usages)
    const jwk = await crypto.subtle.exportKey('jwk', key)
    return { x: b64url(jwk.x), y: jwk.y ? b64url(jwk.y) : undefined }
  } catch {
    return null
  }
}

function ecFromPrivate(der: Uint8Array, pkcs8: Uint8Array, outerCurve: string | undefined, format: string): ParsedKey {
  const { curveOid, point } = ecPrivate(der, outerCurve)
  const out = report('private', format, point ? describeKey({ type: 'EC', curveOid, point }) : null)
  if (point) return { report: out }
  const curve = CURVES[curveOid]
  out.algorithmHint = curve ? `${curve.label} elliptic curve` : `EC curve ${curveOid}`
  if (!curve?.webCrypto) {
    out.notes.push('The file does not include the public key, and this curve cannot be derived here')
    return { report: out }
  }
  return {
    report: out,
    derive: async () => {
      const xy = await derivePublic(pkcs8, { name: 'ECDSA', namedCurve: curve.webCrypto! }, ['sign'])
      return xy?.y ? describeKey({ type: 'EC', curveOid, point: concatBytes([Uint8Array.of(4), xy.x, xy.y]) }) : null
    },
  }
}

/** PKCS#8 PrivateKeyInfo / OneAsymmetricKey (RFC 5208, RFC 5958). */
function parsePkcs8(der: Uint8Array): ParsedKey {
  const fields = children(expectTag(readWhole(der, 'Private key'), 0x30, 'PKCS#8 private key'))
  const version = smallUint(fields[0], 'PKCS#8 version')
  if (version > 1) throw new Error(`Unsupported PKCS#8 version ${version}`)
  const algorithm = children(expectTag(fields[1], 0x30, 'Private key algorithm'))
  const algorithmOid = oid(expectTag(algorithm[0], 0x06, 'Private key algorithm'))
  const privateKey = content(expectTag(fields[2], 0x04, 'Private key'))
  let at = 3
  if (fields[at]?.tag === 0xa0) at += 1
  let embeddedPublic: Uint8Array | undefined
  if (fields[at]?.tag === 0x81) {
    if (version !== 1) throw new Error('A PKCS#8 public key field needs version 2 (RFC 5958)')
    const bits = content(fields[at++])
    if (!bits.length || bits[0] !== 0) throw new Error('PKCS#8 public key: BIT STRING with unused bits')
    embeddedPublic = bits.slice(1)
  }
  if (at !== fields.length) throw new Error('PKCS#8 private key has unexpected fields')

  if (algorithmOid === RSA_OID || algorithmOid === RSA_PSS_OID) {
    const { material, multiPrime } = rsaPrivate(privateKey, algorithmOid === RSA_PSS_OID)
    const key = describeKey(material)
    const out = weakRsa(key, report('private', 'PKCS#8', key))
    if (multiPrime) out.notes.push('Multi-prime RSA key')
    return { report: out }
  }
  if (algorithmOid === EC_OID) {
    const curve = algorithm[1]?.tag === 0x06 ? oid(algorithm[1]) : undefined
    if (!curve) throw new Error('EC private key does not name its curve (explicit parameters are not supported)')
    return ecFromPrivate(privateKey, der, curve, 'PKCS#8')
  }
  const okp = OKP[algorithmOid]
  if (okp) {
    if (algorithm.length !== 1) throw new Error(`${okp.name} keys take no algorithm parameters (RFC 8410)`)
    const seed = content(expectTag(readWhole(privateKey, `${okp.name} private key`), 0x04, `${okp.name} private key`))
    if (seed.length !== okp.size) throw new Error(`${okp.name} private key must be ${okp.size} bytes`)
    if (embeddedPublic) {
      if (embeddedPublic.length !== okp.size) throw new Error(`${okp.name} public key must be ${okp.size} bytes`)
      return { report: report('private', 'PKCS#8 v2', describeKey({ type: 'OKP', oid: algorithmOid, raw: embeddedPublic })) }
    }
    const out = report('private', 'PKCS#8', null, { algorithmHint: okp.name })
    const webCrypto = okp.name === 'Ed25519' || okp.name === 'X25519'
    if (!webCrypto) {
      out.notes.push(`The file does not include the public key, and ${okp.name} public keys cannot be derived here`)
      return { report: out }
    }
    return {
      report: out,
      derive: async () => {
        const derived = await derivePublic(der, { name: okp.name }, okp.name === 'Ed25519' ? ['sign'] : ['deriveBits'])
        return derived ? describeKey({ type: 'OKP', oid: algorithmOid, raw: derived.x }) : null
      },
    }
  }
  if (algorithmOid === DSA_OID) {
    uintBytes(readWhole(privateKey, 'DSA private key'), 'DSA private key')
    const [p] = algorithm[1] ? children(algorithm[1]) : []
    const bits = p ? uintBytes(p, 'DSA p').length * 8 : undefined
    const out = report('private', 'PKCS#8', null, { algorithmHint: bits ? `${bits}-bit DSA` : 'DSA' })
    out.notes.push('PKCS#8 DSA files do not carry the public key, and it is not derived here')
    out.warnings.push('DSA keys are no longer accepted by browsers or by current OpenSSH')
    return { report: out }
  }
  return { report: report('private', 'PKCS#8', null, { algorithmHint: `Unknown algorithm ${algorithmOid}` }) }
}

/** DSAPrivateKey as OpenSSL writes it (`DSA PRIVATE KEY`): 0, p, q, g, y, x. */
function parseDsaPrivate(der: Uint8Array): ParsedKey {
  const fields = children(expectTag(readWhole(der, 'DSA private key'), 0x30, 'DSA private key'))
  if (fields.length !== 6 || smallUint(fields[0], 'DSA version') !== 0) throw new Error('DSA private key has the wrong structure')
  const [p, q, g, y] = [1, 2, 3, 4].map((i) => uintBytes(fields[i], 'DSA field'))
  uintBytes(fields[5], 'DSA private key')
  return { report: weakRsa(null, report('private', 'OpenSSL DSA (DSA PRIVATE KEY)', describeKey({ type: 'DSA', p, q, g, y }))) }
}

// ---- encrypted forms: described, never decrypted ----

const CIPHERS: Record<string, string> = {
  '2.16.840.1.101.3.4.1.2': 'AES-128-CBC', '2.16.840.1.101.3.4.1.22': 'AES-192-CBC', '2.16.840.1.101.3.4.1.42': 'AES-256-CBC',
  '2.16.840.1.101.3.4.1.6': 'AES-128-GCM', '2.16.840.1.101.3.4.1.46': 'AES-256-GCM',
  '1.2.840.113549.3.7': 'DES-EDE3-CBC', '1.3.14.3.2.7': 'DES-CBC', '1.2.840.113549.3.2': 'RC2-CBC',
  '1.2.410.200004.1.4': 'SEED-CBC', '1.2.392.200011.61.1.1.1.2': 'Camellia-128-CBC', '1.2.392.200011.61.1.1.1.4': 'Camellia-256-CBC',
}
const WEAK_CIPHERS = new Set(['DES-CBC', 'RC2-CBC', 'DES-EDE3-CBC'])
const PRFS: Record<string, string> = {
  '1.2.840.113549.2.7': 'HMAC-SHA-1', '1.2.840.113549.2.8': 'HMAC-SHA-224', '1.2.840.113549.2.9': 'HMAC-SHA-256',
  '1.2.840.113549.2.10': 'HMAC-SHA-384', '1.2.840.113549.2.11': 'HMAC-SHA-512',
}
const PBES1: Record<string, string> = {
  '1.2.840.113549.1.5.3': 'PBES1 MD5 + DES-CBC', '1.2.840.113549.1.5.6': 'PBES1 MD5 + RC2-CBC',
  '1.2.840.113549.1.5.10': 'PBES1 SHA-1 + DES-CBC', '1.2.840.113549.1.5.11': 'PBES1 SHA-1 + RC2-CBC',
  '1.2.840.113549.1.12.1.1': 'PKCS#12 SHA-1 + RC4-128', '1.2.840.113549.1.12.1.2': 'PKCS#12 SHA-1 + RC4-40',
  '1.2.840.113549.1.12.1.3': 'PKCS#12 SHA-1 + 3DES', '1.2.840.113549.1.12.1.4': 'PKCS#12 SHA-1 + 2-key 3DES',
  '1.2.840.113549.1.12.1.5': 'PKCS#12 SHA-1 + RC2-128', '1.2.840.113549.1.12.1.6': 'PKCS#12 SHA-1 + RC2-40',
}

const thousands = (n: number) => n.toLocaleString('en-US')

/** EncryptedPrivateKeyInfo (`ENCRYPTED PRIVATE KEY`): the scheme is shown; the key stays encrypted. */
function parseEncryptedPkcs8(der: Uint8Array): ParsedKey {
  const fields = children(expectTag(readWhole(der, 'Encrypted private key'), 0x30, 'Encrypted private key'))
  if (fields.length !== 2) throw new Error('Encrypted private key must hold an algorithm and the encrypted data')
  const algorithm = children(expectTag(fields[0], 0x30, 'Encryption algorithm'))
  if (!content(expectTag(fields[1], 0x04, 'Encrypted data')).length) throw new Error('Encrypted private key is empty')
  const schemeOid = oid(expectTag(algorithm[0], 0x06, 'Encryption algorithm'))
  const out = report('private', 'PKCS#8, encrypted', null, { algorithmHint: 'Inside the encrypted data — not shown' })
  if (PBES1[schemeOid]) {
    out.encryption = PBES1[schemeOid]
    out.warnings.push('This legacy password-based scheme uses a weak cipher; re-encrypt with PBES2 (openssl pkcs8 -topk8 -v2 aes-256-cbc)')
    return { report: out }
  }
  if (schemeOid !== '1.2.840.113549.1.5.13') {
    out.encryption = `Unknown scheme ${schemeOid}`
    return { report: out }
  }
  const [kdf, cipher] = children(expectTag(algorithm[1], 0x30, 'PBES2 parameters'))
  const kdfFields = children(expectTag(kdf, 0x30, 'PBES2 key derivation'))
  const kdfOid = oid(expectTag(kdfFields[0], 0x06, 'PBES2 key derivation'))
  const kdfParams = kdfFields[1] ? children(expectTag(kdfFields[1], 0x30, 'Key derivation parameters')) : []
  let kdfText = `KDF ${kdfOid}`
  if (kdfOid === '1.2.840.113549.1.5.12') {
    const iterations = smallUint(kdfParams[1], 'PBKDF2 iteration count')
    const prfNode = kdfParams.slice(2).find((node) => node.tag === 0x30)
    const prf = prfNode ? PRFS[oid(children(prfNode)[0])] ?? oid(children(prfNode)[0]) : 'HMAC-SHA-1'
    kdfText = `PBKDF2-${prf}, ${thousands(iterations)} iterations`
  } else if (kdfOid === '1.3.6.1.4.1.11591.4.11') {
    const [, cost, blockSize, parallel] = kdfParams
    kdfText = `scrypt N=${thousands(smallUint(cost, 'scrypt N'))}, r=${smallUint(blockSize, 'scrypt r')}, p=${smallUint(parallel, 'scrypt p')}`
  }
  const cipherOid = oid(expectTag(children(expectTag(cipher, 0x30, 'PBES2 cipher'))[0], 0x06, 'PBES2 cipher'))
  const cipherName = CIPHERS[cipherOid] ?? cipherOid
  out.encryption = `PBES2 · ${kdfText} · ${cipherName}`
  if (WEAK_CIPHERS.has(cipherName)) out.warnings.push(`${cipherName} is a legacy cipher; AES is the usual choice`)
  return { report: out }
}

/** `Proc-Type: 4,ENCRYPTED` — OpenSSL's legacy PEM encryption of a PKCS#1/SEC1 key. */
function legacyEncrypted(label: string, headers: Record<string, string>): ParsedKey {
  const dek = headers['dek-info']
  if (!dek) throw new Error('Encrypted PEM key has no DEK-Info header')
  const cipher = dek.split(',')[0].trim()
  const kind = label.split(' ')[0]
  const out = report('private', `${kind === 'EC' ? 'SEC1' : kind === 'RSA' ? 'PKCS#1' : 'OpenSSL'} (${label}), encrypted`, null, {
    algorithmHint: kind === 'EC' ? 'EC — curve is inside the encrypted data' : kind === 'RSA' ? 'RSA — size is inside the encrypted data' : kind,
    encryption: `OpenSSL legacy PEM encryption · ${cipher}`,
  })
  out.warnings.push('Legacy PEM encryption turns the passphrase into a key with a single MD5 round (EVP_BytesToKey), which is cheap to guess; openssl pkcs8 -topk8 -v2 aes-256-cbc re-encrypts it with PBKDF2')
  return { report: out }
}

// ---- OpenSSH ----

const OPENSSH_MAGIC = new TextEncoder().encode('openssh-key-v1\0')

/** OpenSSH's own private key format (PROTOCOL.key): the public half is readable even when encrypted. */
function parseOpenSshPrivate(bytes: Uint8Array): ParsedKey {
  if (bytes.length < OPENSSH_MAGIC.length || !equalBytes(bytes.slice(0, OPENSSH_MAGIC.length), OPENSSH_MAGIC)) {
    throw new Error('Not an openssh-key-v1 private key')
  }
  const reader = new SshReader(bytes.slice(OPENSSH_MAGIC.length), 'OpenSSH private key')
  const cipher = reader.text()
  const kdf = reader.text()
  const kdfOptions = reader.bytesField()
  const count = reader.uint32()
  if (count !== 1) throw new Error(`OpenSSH private key holds ${count} keys; only single-key files are read`)
  const publicBlob = reader.bytesField()
  const privateSection = reader.bytesField()
  if (!reader.done) throw new Error('OpenSSH private key has trailing bytes')
  const { type, key } = parseSshBlob(publicBlob)
  const out = weakRsa(key, report('private', 'OpenSSH private key', key))

  if (cipher !== 'none' || kdf !== 'none') {
    if (cipher === 'none' || kdf === 'none') throw new Error('OpenSSH private key names a cipher without a KDF (or the reverse)')
    if (kdf === 'bcrypt') {
      const options = new SshReader(kdfOptions, 'OpenSSH KDF options')
      options.bytesField()
      const rounds = options.uint32()
      if (!options.done) throw new Error('OpenSSH KDF options have trailing bytes')
      out.encryption = `bcrypt KDF, ${rounds} rounds · ${cipher}`
    } else {
      out.encryption = `${kdf} KDF · ${cipher}`
    }
    out.notes.push('The comment is stored inside the encrypted part')
    return { report: out }
  }
  if (kdfOptions.length) throw new Error('Unencrypted OpenSSH key has KDF options')

  // unencrypted: check the private half belongs to the public one, read the comment
  const inner = new SshReader(privateSection, 'OpenSSH private section')
  if (inner.uint32() !== inner.uint32()) throw new Error('OpenSSH private key check values differ — the file is corrupt')
  if (inner.text() !== type) throw new Error('OpenSSH private and public key types differ')
  const publicReader = new SshReader(publicBlob, 'OpenSSH public key')
  publicReader.text()
  const same = (a: Uint8Array, b: Uint8Array) => {
    if (!equalBytes(a, b)) throw new Error('OpenSSH private key does not match its own public key')
  }
  if (type === 'ssh-ed25519') {
    const pub = inner.bytesField()
    same(pub, publicReader.bytesField())
    const secret = inner.bytesField()
    if (secret.length !== 64 || !equalBytes(secret.slice(32), pub)) throw new Error('OpenSSH Ed25519 private key is malformed')
  } else if (type === 'ssh-rsa') {
    const n = inner.mpint()
    const e = inner.mpint()
    const publicE = publicReader.mpint()
    same(n, publicReader.mpint())
    same(e, publicE)
    for (let i = 0; i < 4; i += 1) inner.mpint()
  } else if (type.startsWith('ecdsa-sha2-')) {
    same(new TextEncoder().encode(inner.text()), new TextEncoder().encode(publicReader.text()))
    same(inner.bytesField(), publicReader.bytesField())
    inner.mpint()
  } else if (type === 'ssh-dss') {
    for (let i = 0; i < 4; i += 1) same(inner.mpint(), publicReader.mpint())
    inner.mpint()
  } else {
    out.notes.push('The private half of this key type is not checked')
    return { report: out }
  }
  const comment = new TextDecoder().decode(inner.bytesField())
  const padding = inner.rest()
  if (padding.some((byte, i) => byte !== i + 1) || padding.length >= 8) throw new Error('OpenSSH private key padding is malformed')
  if (comment) out.comment = comment
  return { report: out }
}

const SSH_TYPE = /^(?:ssh-(?:rsa|ed25519|ed448|dss)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com|[a-z0-9-]+-cert-v01@openssh\.com)$/

/** Whether a line is an OpenSSH public key (`authorized_keys` options in front are allowed). */
export function isSshPublicLine(line: string): boolean {
  return line.trim().split(/\s+/).some((token, i, all) => SSH_TYPE.test(token) && /^AAAA[A-Za-z0-9+/]+={0,2}$/.test(all[i + 1] ?? ''))
}

export function parseSshPublicLine(line: string): ParsedKey {
  const tokens = line.trim().split(/\s+/)
  const at = tokens.findIndex((token, i) => SSH_TYPE.test(token) && /^AAAA/.test(tokens[i + 1] ?? ''))
  if (at < 0) throw new Error('Not an OpenSSH public key line')
  const blob = fromBase64(tokens[at + 1], 'OpenSSH public key')
  const { type, key } = parseSshBlob(blob)
  if (type !== tokens[at]) throw new Error(`The line says ${tokens[at]} but the key inside is ${type}`)
  const out = weakRsa(key, report('public', 'OpenSSH public key', key))
  const comment = tokens.slice(at + 2).join(' ')
  if (comment) out.comment = comment
  if (at > 0) out.notes.push('authorized_keys options before the key are ignored')
  return { report: out }
}

/** `---- BEGIN SSH2 PUBLIC KEY ----` (RFC 4716) — body between the marker lines. */
export function parseRfc4716(body: string): ParsedKey {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const headers: Record<string, string> = {}
  let i = 0
  while (i < lines.length && /^[\x21-\x39\x3b-\x7e]{1,64}:/.test(lines[i])) {
    const colon = lines[i].indexOf(':')
    const name = lines[i].slice(0, colon).toLowerCase()
    let value = lines[i].slice(colon + 1).trim()
    while (value.endsWith('\\') && i + 1 < lines.length) value = value.slice(0, -1) + lines[++i]
    headers[name] = value
    i += 1
  }
  const { key } = parseSshBlob(fromBase64(lines.slice(i).join(''), 'SSH2 public key'))
  const out = weakRsa(key, report('public', 'RFC 4716 SSH2 public key', key))
  const comment = headers.comment?.replace(/^"(.*)"$/, '$1')
  if (comment) out.comment = comment
  return { report: out }
}

// ---- dispatch by PEM label ----

export function parseKeyBlock(label: string, der: Uint8Array, headers: Record<string, string> = {}): ParsedKey {
  const encrypted = /ENCRYPTED/i.test(headers['proc-type'] ?? '')
  if (encrypted && (label === 'RSA PRIVATE KEY' || label === 'EC PRIVATE KEY' || label === 'DSA PRIVATE KEY')) return legacyEncrypted(label, headers)
  switch (label) {
    case 'PRIVATE KEY': return parsePkcs8(der)
    case 'ENCRYPTED PRIVATE KEY': return parseEncryptedPkcs8(der)
    case 'RSA PRIVATE KEY': {
      const { material, multiPrime } = rsaPrivate(der, false)
      const key = describeKey(material)
      const out = weakRsa(key, report('private', 'PKCS#1 (RSA PRIVATE KEY)', key))
      if (multiPrime) out.notes.push('Multi-prime RSA key')
      return { report: out }
    }
    case 'EC PRIVATE KEY': return ecFromPrivate(der, wrapSec1(der), undefined, 'SEC1 (EC PRIVATE KEY)')
    case 'DSA PRIVATE KEY': return parseDsaPrivate(der)
    case 'PUBLIC KEY': {
      const key = parseSpki(der)
      return { report: weakRsa(key, report('public', 'SubjectPublicKeyInfo (PUBLIC KEY)', key)) }
    }
    case 'RSA PUBLIC KEY': {
      const key = parsePkcs1Public(der)
      return { report: weakRsa(key, report('public', 'PKCS#1 (RSA PUBLIC KEY)', key)) }
    }
    case 'OPENSSH PRIVATE KEY': return parseOpenSshPrivate(der)
  }
  throw new Error(`${label} blocks are not supported`)
}

/** SEC1 → PKCS#8, so WebCrypto can derive a public key the file left out. */
function wrapSec1(sec1: Uint8Array): Uint8Array {
  try {
    const fields = children(readNode(sec1))
    const params = fields.find((node: AsnNode) => node.tag === 0xa0)
    const curve = params ? content(params) : null
    if (!curve) return sec1
    return encode(0x30, encodeUint(Uint8Array.of(0)), encode(0x30, encodeOid(EC_OID), curve), encode(0x04, sec1))
  } catch {
    return sec1
  }
}

/** Runs the deferred derivation, if any, and reports when it could not be done. */
export async function finishKey(parsed: ParsedKey): Promise<KeyReport> {
  const out = { ...parsed.report, notes: [...parsed.report.notes] }
  if (!out.publicKey && parsed.derive) {
    out.publicKey = await parsed.derive()
    if (out.publicKey) out.notes.push('Public key derived in this browser — the file does not store it')
    else out.notes.push('The file does not include the public key, and this browser could not derive it')
  }
  return out
}
