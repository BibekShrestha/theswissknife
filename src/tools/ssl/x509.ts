export interface DistinguishedName {
  display: string
  attributes: { name: string; value: string }[]
}

export interface CertificateInfo {
  der: Uint8Array
  tbs: Uint8Array
  signature: Uint8Array
  signatureOid: string
  signatureAlgorithm: string
  serialNumber: string
  subject: DistinguishedName
  issuer: DistinguishedName
  notBefore: Date
  notAfter: Date
  sans: string[]
  ipAddresses: string[]
  publicKeyAlgorithm: string
  publicKeyDetail: string
  spki: Uint8Array
  curve?: string
  isCA: boolean
  keyUsage: string[]
  extendedKeyUsage: string[]
  subjectKeyId?: string
  authorityKeyId?: string
  sha256?: string
  sha1?: string
}

interface AsnNode {
  tag: number
  start: number
  contentStart: number
  end: number
  bytes: Uint8Array
}

const NAME_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
}

const SIGNATURE_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
  '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519',
}

const CURVES: Record<string, { label: string; webCrypto: string }> = {
  '1.2.840.10045.3.1.7': { label: 'P-256', webCrypto: 'P-256' },
  '1.3.132.0.34': { label: 'P-384', webCrypto: 'P-384' },
  '1.3.132.0.35': { label: 'P-521', webCrypto: 'P-521' },
}

const EKUS: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS web server authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS web client authentication',
  '1.3.6.1.5.5.7.3.3': 'Code signing',
  '1.3.6.1.5.5.7.3.4': 'Email protection',
  '1.3.6.1.5.5.7.3.8': 'Time stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP signing',
}

const KEY_USAGES = [
  'Digital signature', 'Content commitment', 'Key encipherment', 'Data encipherment',
  'Key agreement', 'Certificate signing', 'CRL signing', 'Encipher only', 'Decipher only',
]

function readNode(bytes: Uint8Array, start = 0): AsnNode {
  if (start + 2 > bytes.length) throw new Error('Truncated ASN.1 value')
  const tag = bytes[start]
  let cursor = start + 1
  let length = bytes[cursor++]
  if (length & 0x80) {
    const count = length & 0x7f
    if (!count || count > 4 || cursor + count > bytes.length) throw new Error('Invalid ASN.1 length')
    length = 0
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[cursor++]
  }
  const end = cursor + length
  if (end > bytes.length) throw new Error('Truncated ASN.1 content')
  return { tag, start, contentStart: cursor, end, bytes }
}

function children(node: AsnNode): AsnNode[] {
  const out: AsnNode[] = []
  let cursor = node.contentStart
  while (cursor < node.end) {
    const child = readNode(node.bytes, cursor)
    out.push(child)
    cursor = child.end
  }
  if (cursor !== node.end) throw new Error('Invalid ASN.1 container')
  return out
}

function content(node: AsnNode): Uint8Array {
  return node.bytes.slice(node.contentStart, node.end)
}

function whole(node: AsnNode): Uint8Array {
  return node.bytes.slice(node.start, node.end)
}

function oid(node: AsnNode): string {
  const data = content(node)
  if (!data.length) throw new Error('Empty object identifier')
  const parts = [Math.min(2, Math.floor(data[0] / 40)), data[0] < 80 ? data[0] % 40 : data[0] - 80]
  let value = 0
  for (let i = 1; i < data.length; i += 1) {
    value = value * 128 + (data[i] & 0x7f)
    if (!(data[i] & 0x80)) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}

function text(node: AsnNode): string {
  const data = content(node)
  if (node.tag === 0x1e) {
    let value = ''
    for (let i = 0; i + 1 < data.length; i += 2) value += String.fromCharCode(data[i] * 256 + data[i + 1])
    return value
  }
  if (node.tag === 0x1c) {
    let value = ''
    for (let i = 0; i + 3 < data.length; i += 4) value += String.fromCodePoint(data[i] * 0x1000000 + data[i + 1] * 0x10000 + data[i + 2] * 0x100 + data[i + 3])
    return value
  }
  return new TextDecoder().decode(data)
}

function parseName(node: AsnNode): DistinguishedName {
  const attributes: DistinguishedName['attributes'] = []
  for (const set of children(node)) {
    for (const sequence of children(set)) {
      const fields = children(sequence)
      if (fields.length >= 2) {
        const id = oid(fields[0])
        attributes.push({ name: NAME_OIDS[id] ?? id, value: text(fields[1]) })
      }
    }
  }
  return {
    attributes,
    display: attributes.map(({ name, value }) => `${name}=${value}`).join(', '),
  }
}

function parseDate(node: AsnNode): Date {
  const value = text(node)
  const generalized = node.tag === 0x18
  const match = value.match(generalized
    ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/
    : /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/)
  if (!match) throw new Error(`Unsupported certificate date: ${value}`)
  const shortYear = Number(match[1])
  const year = generalized ? shortYear : shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)))
}

function hex(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(separator).toUpperCase()
}

function parseIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length === 16) {
    const groups: string[] = []
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16))
    return groups.join(':')
  }
  return hex(bytes)
}

function parseBitFlags(node: AsnNode): string[] {
  const data = content(node)
  if (data.length < 2) return []
  const out: string[] = []
  for (let bit = 0; bit < KEY_USAGES.length; bit += 1) {
    const byte = data[1 + Math.floor(bit / 8)]
    if (byte !== undefined && (byte & (0x80 >> (bit % 8)))) out.push(KEY_USAGES[bit])
  }
  return out
}

function parseExtensions(node: AsnNode, info: CertificateInfo): void {
  const wrapper = children(node)[0]
  if (!wrapper) return
  for (const extension of children(wrapper)) {
    const fields = children(extension)
    const id = oid(fields[0])
    const valueNode = fields[fields.length - 1]
    if (!valueNode || valueNode.tag !== 0x04) continue
    const innerBytes = content(valueNode)
    if (!innerBytes.length) continue
    const inner = readNode(innerBytes)
    if (id === '2.5.29.17') {
      for (const name of children(inner)) {
        if (name.tag === 0x82) info.sans.push(new TextDecoder().decode(content(name)))
        if (name.tag === 0x87) info.ipAddresses.push(parseIp(content(name)))
      }
    } else if (id === '2.5.29.19') {
      const values = children(inner)
      info.isCA = values.some((value) => value.tag === 0x01 && content(value)[0] !== 0)
    } else if (id === '2.5.29.15') {
      info.keyUsage = parseBitFlags(inner)
    } else if (id === '2.5.29.37') {
      info.extendedKeyUsage = children(inner).map((value) => {
        const eku = oid(value)
        return EKUS[eku] ?? eku
      })
    } else if (id === '2.5.29.14') {
      info.subjectKeyId = hex(content(inner), ':')
    } else if (id === '2.5.29.35') {
      const keyId = children(inner).find((value) => value.tag === 0x80)
      if (keyId) info.authorityKeyId = hex(content(keyId), ':')
    }
  }
}

function publicKeyDetails(spki: AsnNode): { algorithm: string; detail: string; curve?: string } {
  const fields = children(spki)
  const algorithm = children(fields[0])
  const algorithmOid = oid(algorithm[0])
  if (algorithmOid === '1.2.840.113549.1.1.1') {
    const bitString = content(fields[1]).slice(1)
    const rsa = children(readNode(bitString))
    let modulus = content(rsa[0])
    if (modulus[0] === 0) modulus = modulus.slice(1)
    return { algorithm: 'RSA', detail: `${modulus.length * 8}-bit RSA` }
  }
  if (algorithmOid === '1.2.840.10045.2.1') {
    const curveOid = algorithm[1] ? oid(algorithm[1]) : ''
    const curve = CURVES[curveOid]
    return { algorithm: 'EC', detail: curve ? `${curve.label} elliptic curve` : `EC curve ${curveOid}`, curve: curve?.webCrypto }
  }
  if (algorithmOid === '1.3.101.112') return { algorithm: 'Ed25519', detail: 'Ed25519' }
  return { algorithm: algorithmOid, detail: algorithmOid }
}

export function parseCertificate(der: Uint8Array): CertificateInfo {
  const certificate = readNode(der)
  if (certificate.tag !== 0x30 || certificate.end !== der.length) throw new Error('Not a DER X.509 certificate')
  const certificateFields = children(certificate)
  if (certificateFields.length !== 3) throw new Error('Invalid X.509 certificate structure')
  const [tbsNode, signatureAlgorithmNode, signatureNode] = certificateFields
  const tbsFields = children(tbsNode)
  let index = tbsFields[0]?.tag === 0xa0 ? 1 : 0
  const serial = tbsFields[index++]
  index += 1 // signature algorithm inside TBSCertificate
  const issuer = tbsFields[index++]
  const validity = children(tbsFields[index++])
  const subject = tbsFields[index++]
  const spki = tbsFields[index++]
  if (!serial || validity.length !== 2 || !spki) throw new Error('Certificate is missing required fields')
  const signatureOid = oid(children(signatureAlgorithmNode)[0])
  const key = publicKeyDetails(spki)
  const info: CertificateInfo = {
    der: der.slice(),
    tbs: whole(tbsNode),
    signature: content(signatureNode).slice(1),
    signatureOid,
    signatureAlgorithm: SIGNATURE_OIDS[signatureOid] ?? signatureOid,
    serialNumber: hex(content(serial)).replace(/^00/, '') || '00',
    subject: parseName(subject),
    issuer: parseName(issuer),
    notBefore: parseDate(validity[0]),
    notAfter: parseDate(validity[1]),
    sans: [],
    ipAddresses: [],
    publicKeyAlgorithm: key.algorithm,
    publicKeyDetail: key.detail,
    spki: whole(spki),
    curve: key.curve,
    isCA: false,
    keyUsage: [],
    extendedKeyUsage: [],
  }
  const extensions = tbsFields.slice(index).find((field) => field.tag === 0xa3)
  if (extensions) parseExtensions(extensions, info)
  return info
}

export function decodeCertificates(input: string): Uint8Array[] {
  const blocks = Array.from(input.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g))
  if (!blocks.length) throw new Error('Paste at least one PEM certificate, including its BEGIN and END lines')
  return blocks.map((match) => {
    const encoded = match[1].replace(/\s/g, '')
    try {
      return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    } catch {
      throw new Error('A certificate contains invalid Base64 data')
    }
  })
}

export function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  // A bare IPv6 literal cannot be fed to URL without brackets, and treating
  // its final group as a port would silently change the address.
  if (!trimmed.includes('://') && (trimmed.match(/:/g)?.length ?? 0) > 1) {
    const bracketed = trimmed.match(/^\[([^\]]+)](?::\d+)?$/)
    return (bracketed?.[1] ?? trimmed).replace(/\.$/, '')
  }
  try {
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withScheme).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  } catch {
    return trimmed.replace(/:\d+$/, '').replace(/\.$/, '')
  }
}

export function matchesHostname(hostInput: string, names: string[], ips: string[] = []): boolean {
  const host = normalizeHost(hostInput)
  if (!host) return false
  const isIp = host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  if (isIp) return ips.some((ip) => ip.toLowerCase() === host)
  return names.some((rawName) => {
    const name = rawName.toLowerCase().replace(/\.$/, '')
    if (!name.startsWith('*.')) return name === host
    const suffix = name.slice(1)
    return host.endsWith(suffix) && host.split('.').length === name.split('.').length
  })
}

export function orderChain(certificates: CertificateInfo[]): CertificateInfo[] {
  if (certificates.length < 2) return certificates
  const issuerNames = new Set(certificates.map((cert) => cert.issuer.display))
  const leaf = certificates.find((cert) => !issuerNames.has(cert.subject.display) || (!cert.isCA && cert.subject.display !== cert.issuer.display))
  if (!leaf) return certificates
  const ordered = [leaf]
  const remaining = new Set(certificates.filter((cert) => cert !== leaf))
  while (remaining.size) {
    const current = ordered[ordered.length - 1]
    const next = Array.from(remaining).find((cert) => cert.subject.display === current.issuer.display)
    if (!next) break
    ordered.push(next)
    remaining.delete(next)
  }
  return [...ordered, ...remaining]
}

async function digest(name: AlgorithmIdentifier, bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest(name, bytes as BufferSource)
  return hex(new Uint8Array(result), ':')
}

export async function addFingerprints(certificate: CertificateInfo): Promise<CertificateInfo> {
  const [sha256, sha1] = await Promise.all([digest('SHA-256', certificate.der), digest('SHA-1', certificate.der)])
  return { ...certificate, sha256, sha1 }
}

function ecdsaDerToRaw(signature: Uint8Array, size: number): Uint8Array {
  const sequence = children(readNode(signature))
  if (sequence.length !== 2) return signature
  const fixed = (node: AsnNode) => {
    let value = content(node)
    while (value.length > size && value[0] === 0) value = value.slice(1)
    const out = new Uint8Array(size)
    out.set(value, Math.max(0, size - value.length))
    return out
  }
  const out = new Uint8Array(size * 2)
  out.set(fixed(sequence[0]), 0)
  out.set(fixed(sequence[1]), size)
  return out
}

export async function verifyIssuedBy(child: CertificateInfo, issuer: CertificateInfo): Promise<boolean | null> {
  try {
    if (child.signatureOid.startsWith('1.2.840.113549.1.1.') && child.signatureOid !== '1.2.840.113549.1.1.10') {
      const hashes: Record<string, string> = {
        '1.2.840.113549.1.1.5': 'SHA-1', '1.2.840.113549.1.1.11': 'SHA-256',
        '1.2.840.113549.1.1.12': 'SHA-384', '1.2.840.113549.1.1.13': 'SHA-512',
      }
      const hash = hashes[child.signatureOid]
      if (!hash) return null
      const key = await crypto.subtle.importKey('spki', issuer.spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
      return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, child.signature as BufferSource, child.tbs as BufferSource)
    }
    if (child.signatureOid.startsWith('1.2.840.10045.4.3.')) {
      const hashes: Record<string, string> = {
        '1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384', '1.2.840.10045.4.3.4': 'SHA-512',
      }
      if (!issuer.curve) return null
      const hash = hashes[child.signatureOid]
      if (!hash) return null
      const key = await crypto.subtle.importKey('spki', issuer.spki as BufferSource, { name: 'ECDSA', namedCurve: issuer.curve }, false, ['verify'])
      const size = issuer.curve === 'P-256' ? 32 : issuer.curve === 'P-384' ? 48 : 66
      const signature = ecdsaDerToRaw(child.signature, size)
      return crypto.subtle.verify({ name: 'ECDSA', hash }, key, signature as BufferSource, child.tbs as BufferSource)
    }
    if (child.signatureOid === '1.3.101.112') {
      const key = await crypto.subtle.importKey('spki', issuer.spki as BufferSource, { name: 'Ed25519' }, false, ['verify'])
      return crypto.subtle.verify('Ed25519', key, child.signature as BufferSource, child.tbs as BufferSource)
    }
    return null
  } catch {
    return null
  }
}
