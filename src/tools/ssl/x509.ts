export interface DistinguishedName {
  display: string
  attributes: { name: string; value: string }[]
}

export interface PssParams {
  /** WebCrypto hash name, or null when the OID is not one WebCrypto knows */
  hash: string | null
  mgfHash: string | null
  saltLength: number
  trailer: number
}

export interface CertificateInfo {
  der: Uint8Array
  tbs: Uint8Array
  signature: Uint8Array
  signatureOid: string
  signatureAlgorithm: string
  /** hash behind the signature (SHA-1, SHA-256, …) when known */
  signatureHash?: string
  pss?: PssParams
  /** the outer and TBS signature AlgorithmIdentifiers differ (RFC 5280 §4.1.1.2) */
  algorithmMismatch: boolean
  serialNumber: string
  subject: DistinguishedName
  issuer: DistinguishedName
  subjectDer: Uint8Array
  issuerDer: Uint8Array
  notBefore: Date
  notAfter: Date
  sans: string[]
  ipAddresses: string[]
  publicKeyAlgorithm: string
  publicKeyDetail: string
  spki: Uint8Array
  curve?: string
  isCA: boolean
  /** absent when the certificate has no basicConstraints extension */
  basicConstraints?: { ca: boolean; pathLen?: number }
  hasKeyUsage: boolean
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
  '1.2.840.10045.4.1': 'ECDSA with SHA-1',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519',
}

const RSA_PKCS1_HASHES: Record<string, string> = {
  '1.2.840.113549.1.1.5': 'SHA-1', '1.2.840.113549.1.1.11': 'SHA-256',
  '1.2.840.113549.1.1.12': 'SHA-384', '1.2.840.113549.1.1.13': 'SHA-512',
}
const ECDSA_HASHES: Record<string, string> = {
  '1.2.840.10045.4.1': 'SHA-1', '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384', '1.2.840.10045.4.3.4': 'SHA-512',
}
const DIGEST_OIDS: Record<string, string> = {
  '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512',
}
const RSA_PSS_OID = '1.2.840.113549.1.1.10'

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
const KEY_CERT_SIGN = KEY_USAGES[5]

function readNode(bytes: Uint8Array, start = 0): AsnNode {
  if (start + 2 > bytes.length) throw new Error('Truncated ASN.1 value')
  const tag = bytes[start]
  let cursor = start + 1
  let length = bytes[cursor++]
  if (length & 0x80) {
    const count = length & 0x7f
    if (!count || count > 4 || cursor + count > bytes.length) throw new Error('Invalid ASN.1 length')
    // DER: the shortest length form only — no leading zero bytes, no long form below 128
    if (bytes[cursor] === 0) throw new Error('Invalid DER: non-minimal length')
    length = 0
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[cursor++]
    if (length < 0x80) throw new Error('Invalid DER: non-minimal length')
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

function integer(node: AsnNode): number {
  let value = 0
  for (const byte of content(node)) value = value * 256 + byte
  return value
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

const STRING_TAGS = new Set([0x0c, 0x13, 0x14, 0x16, 0x1c, 0x1e])

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

/**
 * RFC 5280 §7.1 name matching: byte-equal, or the same RDNs in the same
 * order with string values compared case-insensitively after collapsing
 * whitespace (an approximation of LDAP StringPrep), whatever string type
 * each side used.
 */
function namesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (equalBytes(a, b)) return true
  try {
    const rdns = (der: Uint8Array) => children(readNode(der)).map((set) =>
      children(set).map((attribute) => {
        const [type, value] = children(attribute)
        const key = STRING_TAGS.has(value.tag)
          ? 's:' + text(value).trim().replace(/\s+/g, ' ').toLowerCase()
          : 'b:' + Array.from(whole(value)).join(',')
        return `${oid(type)}=${key}`
      }).sort())
    const left = rdns(a)
    const right = rdns(b)
    return left.length === right.length && left.every((set, i) => set.join('+') === right[i].join('+'))
  } catch {
    return false
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
  const [month, day, hour, minute, second] = [match[2], match[3], match[4], match[5], match[6] ?? '0'].map(Number)
  // setUTCFullYear, not Date.UTC, so GeneralizedTime years 0–99 stay literal
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid certificate date: ${value}`)
  }
  return date
}

function hex(bytes: Uint8Array, separator = ''): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(separator).toUpperCase()
}

/** IPv4 dotted quad, or IPv6 in RFC 5952 form (lowercase, longest zero run as ::). */
function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.')
  if (bytes.length === 16) {
    const groups: number[] = []
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1])
    let best = -1
    let bestLength = 1
    for (let i = 0; i < 8; i += 1) {
      let j = i
      while (j < 8 && groups[j] === 0) j += 1
      if (j - i > bestLength) {
        best = i
        bestLength = j - i
      }
    }
    const part = (list: number[]) => list.map((group) => group.toString(16)).join(':')
    return best < 0 ? part(groups) : `${part(groups.slice(0, best))}::${part(groups.slice(best + bestLength))}`
  }
  return hex(bytes)
}

/** Bytes of an IPv4 or IPv6 literal (any valid spelling), or null. */
export function ipBytes(value: string): Uint8Array | null {
  const v4 = (s: string): number[] | null => {
    const parts = s.split('.')
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null
    return parts.map(Number)
  }
  if (!value.includes(':')) {
    const bytes = v4(value)
    return bytes ? Uint8Array.from(bytes) : null
  }
  let s = value.toLowerCase()
  const last = s.lastIndexOf(':')
  if (s.slice(last + 1).includes('.')) {
    const tail = v4(s.slice(last + 1))
    if (!tail) return null
    s = `${s.slice(0, last + 1)}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = [...head, ...rest]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  if (halves.length === 1 ? groups.length !== 8 : groups.length > 7) return null
  const all = [...head, ...new Array(8 - groups.length).fill('0'), ...rest]
  const out = new Uint8Array(16)
  all.forEach((group, i) => {
    const n = parseInt(group, 16)
    out[i * 2] = n >> 8
    out[i * 2 + 1] = n & 0xff
  })
  return out
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

const EXTENSION_NAMES: Record<string, string> = {
  '2.5.29.17': 'Subject Alternative Name', '2.5.29.19': 'basicConstraints', '2.5.29.15': 'keyUsage',
  '2.5.29.37': 'extendedKeyUsage', '2.5.29.14': 'subjectKeyIdentifier', '2.5.29.35': 'authorityKeyIdentifier',
}

function parseExtensions(node: AsnNode, info: CertificateInfo): void {
  const wrapper = children(node)[0]
  if (!wrapper) return
  const seen = new Set<string>()
  for (const extension of children(wrapper)) {
    const fields = children(extension)
    const id = oid(fields[0])
    // RFC 5280 §4.2: an extension appears at most once — merging two SANs
    // would let either one answer the hostname question
    if (seen.has(id)) throw new Error(`Certificate contains the ${EXTENSION_NAMES[id] ?? id} extension more than once`)
    seen.add(id)
    const valueNode = fields[fields.length - 1]
    if (!valueNode || valueNode.tag !== 0x04) continue
    const innerBytes = content(valueNode)
    if (!innerBytes.length) continue
    const inner = readNode(innerBytes)
    if (id === '2.5.29.17') {
      for (const name of children(inner)) {
        if (name.tag === 0x82) info.sans.push(new TextDecoder().decode(content(name)))
        if (name.tag === 0x87) info.ipAddresses.push(formatIp(content(name)))
      }
    } else if (id === '2.5.29.19') {
      const values = children(inner)
      const ca = values.some((value) => value.tag === 0x01 && content(value)[0] !== 0)
      const pathLen = values.find((value) => value.tag === 0x02)
      info.basicConstraints = { ca, pathLen: pathLen ? integer(pathLen) : undefined }
      info.isCA = ca
    } else if (id === '2.5.29.15') {
      info.hasKeyUsage = true
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

/** RSASSA-PSS-params (RFC 4055), with its SHA-1 / MGF1-SHA-1 / 20 / 1 defaults. */
function parsePssParams(algorithm: AsnNode): PssParams {
  const params: PssParams = { hash: 'SHA-1', mgfHash: 'SHA-1', saltLength: 20, trailer: 1 }
  const fields = children(algorithm)
  if (!fields[1] || fields[1].tag !== 0x30) return params
  for (const field of children(fields[1])) {
    const [inner] = children(field)
    if (field.tag === 0xa0) params.hash = DIGEST_OIDS[oid(children(inner)[0])] ?? null
    if (field.tag === 0xa1) {
      const [mgfOid, mgfHash] = children(inner)
      params.mgfHash = oid(mgfOid) === '1.2.840.113549.1.1.8' && mgfHash ? DIGEST_OIDS[oid(children(mgfHash)[0])] ?? null : null
    }
    if (field.tag === 0xa2) params.saltLength = integer(inner)
    if (field.tag === 0xa3) params.trailer = integer(inner)
  }
  return params
}

function publicKeyDetails(spki: AsnNode): { algorithm: string; detail: string; curve?: string } {
  const fields = children(spki)
  const algorithm = children(fields[0])
  const algorithmOid = oid(algorithm[0])
  if (algorithmOid === '1.2.840.113549.1.1.1' || algorithmOid === RSA_PSS_OID) {
    const bitString = content(fields[1]).slice(1)
    const rsa = children(readNode(bitString))
    let modulus = content(rsa[0])
    if (modulus[0] === 0) modulus = modulus.slice(1)
    return { algorithm: 'RSA', detail: `${modulus.length * 8}-bit RSA${algorithmOid === RSA_PSS_OID ? ' (PSS only)' : ''}` }
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
  const tbsSignatureAlgorithm = tbsFields[index++]
  const issuer = tbsFields[index++]
  const validity = children(tbsFields[index++])
  const subject = tbsFields[index++]
  const spki = tbsFields[index++]
  if (!serial || !tbsSignatureAlgorithm || validity.length !== 2 || !spki) throw new Error('Certificate is missing required fields')
  const signatureOid = oid(children(signatureAlgorithmNode)[0])
  const pss = signatureOid === RSA_PSS_OID ? parsePssParams(signatureAlgorithmNode) : undefined
  const key = publicKeyDetails(spki)
  const info: CertificateInfo = {
    der: der.slice(),
    tbs: whole(tbsNode),
    signature: content(signatureNode).slice(1),
    signatureOid,
    signatureAlgorithm: pss?.hash ? `RSA-PSS with ${pss.hash}` : SIGNATURE_OIDS[signatureOid] ?? signatureOid,
    signatureHash: pss ? pss.hash ?? undefined : RSA_PKCS1_HASHES[signatureOid] ?? ECDSA_HASHES[signatureOid],
    pss,
    algorithmMismatch: !equalBytes(whole(signatureAlgorithmNode), whole(tbsSignatureAlgorithm)),
    serialNumber: hex(content(serial)).replace(/^00/, '') || '00',
    subject: parseName(subject),
    issuer: parseName(issuer),
    subjectDer: whole(subject),
    issuerDer: whole(issuer),
    notBefore: parseDate(validity[0]),
    notAfter: parseDate(validity[1]),
    sans: [],
    ipAddresses: [],
    publicKeyAlgorithm: key.algorithm,
    publicKeyDetail: key.detail,
    spki: whole(spki),
    curve: key.curve,
    isCA: false,
    hasKeyUsage: false,
    keyUsage: [],
    extendedKeyUsage: [],
  }
  const extensions = tbsFields.slice(index).find((field) => field.tag === 0xa3)
  if (extensions) parseExtensions(extensions, info)
  return info
}

function base64ToBytes(encoded: string): Uint8Array {
  try {
    return Uint8Array.from(atob(encoded.replace(/\s/g, '')), (character) => character.charCodeAt(0))
  } catch {
    throw new Error('A certificate contains invalid Base64 data')
  }
}

const PEM_BLOCK = /-----BEGIN (TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END \1?CERTIFICATE-----/g

export function hasPemCertificate(source: string): boolean {
  return /-----BEGIN (?:TRUSTED )?CERTIFICATE-----/.test(source)
}

export function decodeCertificates(input: string): Uint8Array[] {
  const blocks = Array.from(input.matchAll(PEM_BLOCK))
  if (!blocks.length) throw new Error('Paste at least one PEM certificate, including its BEGIN and END lines')
  return blocks.map((match) => {
    const bytes = base64ToBytes(match[2])
    // OpenSSL's TRUSTED CERTIFICATE is the certificate followed by trust
    // settings; only the leading certificate is inspected
    return match[1] ? bytes.slice(0, readNode(bytes).end) : bytes
  })
}

/** The certificates in a file: PEM (one or many blocks) or a single DER certificate. */
export function certificatesFromBytes(bytes: Uint8Array): Uint8Array[] {
  const source = new TextDecoder().decode(bytes)
  return hasPemCertificate(source) ? decodeCertificates(source) : [bytes]
}

export function toPem(der: Uint8Array): string {
  let bin = ''
  for (const byte of der) bin += String.fromCharCode(byte)
  return `-----BEGIN CERTIFICATE-----\n${btoa(bin).replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END CERTIFICATE-----`
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

/**
 * RFC 6125 matching against SAN entries only. IPs compare as bytes; a
 * wildcard covers exactly one whole left-most label, and only over a suffix
 * of two or more labels (no Public Suffix List is bundled, so `*.co.uk` is
 * not caught — `*.com` is).
 */
export function matchesHostname(hostInput: string, names: string[], ips: string[] = []): boolean {
  const host = normalizeHost(hostInput)
  if (!host) return false
  const hostIp = ipBytes(host)
  if (hostIp) return ips.some((ip) => {
    const bytes = ipBytes(ip)
    return Boolean(bytes && equalBytes(bytes, hostIp))
  })
  if (host.includes(':')) return false
  const hostLabels = host.split('.')
  if (hostLabels.some((label) => !label)) return false
  return names.some((rawName) => {
    const name = rawName.toLowerCase().replace(/\.$/, '')
    const labels = name.split('.')
    if (labels.some((label) => !label)) return false
    if (labels[0] !== '*') return name === host
    if (labels.length < 3 || labels.slice(1).some((label) => label.includes('*'))) return false
    return hostLabels.length === labels.length && hostLabels.slice(1).join('.') === labels.slice(1).join('.')
  })
}

/** Whether a host is covered by the certificate's SANs (browsers ignore the CN). */
export function hostnameCoverage(certificate: CertificateInfo, hostInput: string): { ok: boolean; host: string; detail: string } | null {
  const host = normalizeHost(hostInput)
  if (!host) return null
  const ok = matchesHostname(host, certificate.sans, certificate.ipAddresses)
  const listed = [...certificate.sans, ...certificate.ipAddresses]
  let detail = listed.length ? listed.join(', ') : 'No DNS or IP names in Subject Alternative Name'
  const cn = certificate.subject.attributes.find((attribute) => attribute.name === 'CN')?.value
  if (!ok && !certificate.sans.length && cn) detail += ` — the Common Name (${cn}) is not used: browsers ignore it`
  return { ok, host, detail }
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

function ecdsaDerToRaw(signature: Uint8Array, size: number): Uint8Array | null {
  try {
    const sequence = children(readNode(signature))
    if (sequence.length !== 2 || sequence.some((node) => node.tag !== 0x02)) return null
    const fixed = (node: AsnNode) => {
      let value = content(node)
      while (value.length > size && value[0] === 0) value = value.slice(1)
      if (value.length > size) return null
      const out = new Uint8Array(size)
      out.set(value, size - value.length)
      return out
    }
    const r = fixed(sequence[0])
    const s = fixed(sequence[1])
    if (!r || !s) return null
    const out = new Uint8Array(size * 2)
    out.set(r, 0)
    out.set(s, size)
    return out
  } catch {
    return null
  }
}

/** ok: true = verified, false = not signed by this issuer, null = could not be checked here. */
export interface SignatureCheck { ok: boolean | null; reason: string }

function signatureFamily(oidValue: string): 'RSA' | 'EC' | 'Ed25519' | null {
  if (RSA_PKCS1_HASHES[oidValue] || oidValue === RSA_PSS_OID) return 'RSA'
  if (ECDSA_HASHES[oidValue]) return 'EC'
  if (oidValue === '1.3.101.112') return 'Ed25519'
  return null
}

async function importOrNull(spki: Uint8Array, params: RsaHashedImportParams | EcKeyImportParams | { name: string }): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey('spki', spki as BufferSource, params, false, ['verify'])
  } catch {
    return null
  }
}

export async function verifyIssuedBy(child: CertificateInfo, issuer: CertificateInfo): Promise<SignatureCheck> {
  const family = signatureFamily(child.signatureOid)
  if (!family) return { ok: null, reason: `${child.signatureAlgorithm} signatures are not checked here` }
  if (family !== issuer.publicKeyAlgorithm) {
    return { ok: false, reason: `Signed with ${family}, but the next certificate has an ${issuer.publicKeyAlgorithm} key — not issued by it` }
  }
  const tbs = child.tbs as BufferSource
  try {
    if (child.pss) {
      const { hash, mgfHash, saltLength, trailer } = child.pss
      if (!hash || hash !== mgfHash || trailer !== 1) return { ok: null, reason: 'These RSA-PSS parameters cannot be checked with WebCrypto' }
      const key = await importOrNull(issuer.spki, { name: 'RSA-PSS', hash })
      if (!key) return { ok: null, reason: 'This browser could not import the issuer key for RSA-PSS' }
      const ok = await crypto.subtle.verify({ name: 'RSA-PSS', saltLength }, key, child.signature as BufferSource, tbs)
      return { ok, reason: ok ? 'Signature valid' : 'Signature does not verify with the next certificate\'s key' }
    }
    if (family === 'RSA') {
      const key = await importOrNull(issuer.spki, { name: 'RSASSA-PKCS1-v1_5', hash: RSA_PKCS1_HASHES[child.signatureOid] })
      if (!key) return { ok: null, reason: 'This browser could not import the issuer\'s RSA key' }
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, child.signature as BufferSource, tbs)
      return { ok, reason: ok ? 'Signature valid' : 'Signature does not verify with the next certificate\'s key' }
    }
    if (family === 'EC') {
      if (!issuer.curve) return { ok: null, reason: `${issuer.publicKeyDetail} is not supported by WebCrypto` }
      const key = await importOrNull(issuer.spki, { name: 'ECDSA', namedCurve: issuer.curve })
      if (!key) return { ok: null, reason: 'This browser could not import the issuer\'s EC key' }
      const raw = ecdsaDerToRaw(child.signature, issuer.curve === 'P-256' ? 32 : issuer.curve === 'P-384' ? 48 : 66)
      if (!raw) return { ok: false, reason: 'Malformed ECDSA signature' }
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: ECDSA_HASHES[child.signatureOid] }, key, raw as BufferSource, tbs)
      return { ok, reason: ok ? 'Signature valid' : 'Signature does not verify with the next certificate\'s key' }
    }
    const key = await importOrNull(issuer.spki, { name: 'Ed25519' })
    if (!key) return { ok: null, reason: 'This browser cannot check Ed25519 signatures' }
    const ok = await crypto.subtle.verify('Ed25519', key, child.signature as BufferSource, tbs)
    return { ok, reason: ok ? 'Signature valid' : 'Signature does not verify with the next certificate\'s key' }
  } catch (cause) {
    return { ok: null, reason: `Could not check: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
}

export interface CertificateReport {
  role: 'leaf' | 'intermediate' | 'root' | 'top'
  /** this certificate's signature, checked against the next one (or itself, for a self-issued top) */
  signature: SignatureCheck | null
  /** failures — each one makes the verdict not green */
  problems: string[]
  notes: string[]
}

export interface ChainReport {
  links: CertificateReport[]
  /** ok: every check passed; bad: something failed; unchecked: no failure, but a signature could not be checked; none: single certificate */
  status: 'ok' | 'bad' | 'unchecked' | 'none'
}

const shortDate = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Local checks of the chain exactly as supplied, leaf first: each link's
 * signature and name, and that every issuer may issue (CA:TRUE, keyCertSign,
 * pathLen, validity now). No trust store, no revocation, no fetching.
 */
export async function checkChain(certificates: CertificateInfo[], now: number): Promise<ChainReport> {
  const count = certificates.length
  const links = await Promise.all(certificates.map(async (certificate, index): Promise<CertificateReport> => {
    const problems: string[] = []
    const notes: string[] = []
    const last = index === count - 1
    let signature: SignatureCheck | null = null
    let role: CertificateReport['role'] = index === 0 ? 'leaf' : 'intermediate'
    if (!last) {
      signature = await verifyIssuedBy(certificate, certificates[index + 1])
      if (!namesEqual(certificate.issuerDer, certificates[index + 1].subjectDer)) {
        problems.push(`Issuer name does not match the subject of certificate ${index + 2}`)
      }
    } else if (count > 1) {
      if (namesEqual(certificate.issuerDer, certificate.subjectDer)) {
        const self = await verifyIssuedBy(certificate, certificate)
        if (self.ok === true) role = 'root'
        else if (self.ok === false) {
          role = 'top'
          problems.push('Named as its own issuer, but its self-signature does not verify')
        } else {
          role = 'top'
          notes.push(`Self-signature not checked: ${self.reason}`)
        }
      } else {
        role = 'top'
        notes.push('Its issuer was not supplied')
      }
    }
    if (signature?.ok === false) problems.push(signature.reason)
    if (certificate.algorithmMismatch) problems.push('Outer and inner signature algorithm identifiers differ')
    if (certificate.signatureHash === 'SHA-1' && role !== 'root') problems.push('Signed with SHA-1, which browsers no longer accept')

    if (index > 0) {
      const child = index
      if (!certificate.basicConstraints?.ca) problems.push(`Not a CA (basicConstraints CA:TRUE missing) — may not issue certificate ${child}`)
      if (certificate.hasKeyUsage && !certificate.keyUsage.includes(KEY_CERT_SIGN)) problems.push('keyUsage lacks keyCertSign (certificate signing)')
      const pathLen = certificate.basicConstraints?.pathLen
      if (pathLen !== undefined) {
        const below = certificates.slice(1, index).filter((cert) => !namesEqual(cert.issuerDer, cert.subjectDer)).length
        if (below > pathLen) problems.push(`Path length ${pathLen} allows ${pathLen} intermediate CA${pathLen === 1 ? '' : 's'} below it; the chain has ${below}`)
      }
      if (certificate.notAfter.getTime() < now) problems.push(`Expired ${shortDate(certificate.notAfter)}`)
      else if (certificate.notBefore.getTime() > now) problems.push(`Not valid until ${shortDate(certificate.notBefore)}`)
    }
    return { role, signature, problems, notes }
  }))
  const failed = links.some((link) => link.problems.length)
  const unchecked = links.some((link) => link.signature?.ok === null)
  return { links, status: failed ? 'bad' : unchecked ? 'unchecked' : count > 1 ? 'ok' : 'none' }
}
