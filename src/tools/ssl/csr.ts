import { bitStringBytes, children, expectTag, oid, readWhole, smallUint, text, whole } from './der'
import { publicKeyFromSpkiNode, type PublicKey } from './spki'
import {
  parseExtensionList, parseName, signatureAlgorithmInfo, verifySignature,
  type DistinguishedName, type ExtensionSummary, type SignatureCheck, type SignedData,
} from './x509'

/** A PKCS#10 certificate signing request (RFC 2986). */
export interface CsrInfo extends SignedData {
  der: Uint8Array
  signatureHash?: string
  subject: DistinguishedName
  publicKey: PublicKey
  /** from the extensionRequest attribute (PKCS#9), when present */
  extensions: ExtensionSummary | null
  /** other attributes, described; a challengePassword's value is never shown */
  attributes: string[]
}

const EXTENSION_REQUEST = '1.2.840.113549.1.9.14'
const MS_EXTENSION_REQUEST = '1.3.6.1.4.1.311.2.1.14'
const ATTRIBUTE_NAMES: Record<string, string> = {
  '1.2.840.113549.1.9.7': 'challengePassword',
  '1.2.840.113549.1.9.2': 'unstructuredName',
  '1.3.6.1.4.1.311.13.2.3': 'Microsoft OS version',
  '1.3.6.1.4.1.311.21.20': 'Microsoft client information',
  '1.3.6.1.4.1.311.13.2.2': 'Microsoft enrollment CSP',
}

export function parseCsr(der: Uint8Array): CsrInfo {
  const request = expectTag(readWhole(der, 'Certificate request'), 0x30, 'Certificate request')
  const fields = children(request)
  if (fields.length !== 3) throw new Error('Invalid PKCS#10 structure: expected request info, algorithm and signature')
  const [infoNode, algorithmNode, signatureNode] = fields
  const info = children(expectTag(infoNode, 0x30, 'Certification request info'))
  if (info.length !== 4) throw new Error('Certification request info must hold version, subject, key and attributes')
  const [versionNode, subjectNode, spkiNode, attributesNode] = info
  const version = smallUint(versionNode, 'CSR version')
  if (version !== 0) throw new Error(`Unsupported CSR version ${version + 1}`)
  expectTag(subjectNode, 0x30, 'CSR subject')
  // attributes are [0] IMPLICIT SET OF — constructed, context-specific tag 0
  expectTag(attributesNode, 0xa0, 'CSR attributes')

  let extensions: ExtensionSummary | null = null
  const attributes: string[] = []
  for (const attribute of children(attributesNode)) {
    const [typeNode, valuesNode, extra] = children(expectTag(attribute, 0x30, 'CSR attribute'))
    if (extra) throw new Error('Malformed CSR attribute')
    const type = oid(expectTag(typeNode, 0x06, 'CSR attribute type'))
    const values = children(expectTag(valuesNode, 0x31, 'CSR attribute values'))
    if (type === EXTENSION_REQUEST || type === MS_EXTENSION_REQUEST) {
      if (extensions) throw new Error('CSR requests extensions more than once')
      if (values.length !== 1) throw new Error('extensionRequest must hold exactly one Extensions value')
      extensions = parseExtensionList(expectTag(values[0], 0x30, 'Requested extensions'), 'Certificate request')
    } else if (type === '1.2.840.113549.1.9.7') {
      attributes.push('challengePassword (value not shown)')
    } else if (type === '1.2.840.113549.1.9.2' && values[0]) {
      attributes.push(`unstructuredName: ${text(values[0])}`)
    } else {
      attributes.push(ATTRIBUTE_NAMES[type] ?? type)
    }
  }

  const signature = signatureAlgorithmInfo(expectTag(algorithmNode, 0x30, 'Signature algorithm'))
  return {
    der: der.slice(),
    tbs: whole(infoNode),
    signature: bitStringBytes(signatureNode, 'CSR signature'),
    ...signature,
    subject: parseName(subjectNode),
    publicKey: publicKeyFromSpkiNode(spkiNode),
    extensions,
    attributes,
  }
}

/**
 * Proof of possession: a CSR is signed with the private key matching the
 * public key it carries, so a valid signature shows the requester held it.
 */
export function verifyCsr(csr: CsrInfo): Promise<SignatureCheck> {
  const key = csr.publicKey
  if (!key.spki) return Promise.resolve({ ok: null, reason: 'This key type cannot be checked' })
  return verifySignature(csr, { spki: key.spki, publicKeyAlgorithm: key.algorithm, publicKeyDetail: key.detail, curve: key.curve }, {
    key: 'the request\'s own public key',
    has: 'its public key is',
    tail: '',
  })
}
