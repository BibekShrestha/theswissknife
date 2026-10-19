import { readNode, fromBase64, toBase64 } from './der'
import { parseCsr } from './csr'
import { isPrivateLabel, isSshPublicLine, KEY_LABELS, parseKeyBlock, parseRfc4716, parseSshPublicLine, type ParsedKey } from './keys'
import { parseCertificate } from './x509'

/**
 * Splits pasted text into the things the tool inspects: PEM blocks
 * (certificates, CSRs, keys), RFC 4716 SSH2 public keys and OpenSSH public
 * key lines. Each block parses on its own, so one bad block is reported
 * without hiding the rest. Error messages never quote the input.
 */

export type Block =
  | { kind: 'certificate'; label: string; der: Uint8Array }
  | { kind: 'csr'; label: string; der: Uint8Array }
  | { kind: 'key'; label: string; parsed: ParsedKey; private: boolean }
  | { kind: 'ignored'; label: string; reason: string }
  | { kind: 'error'; label: string; error: string; private: boolean }

export interface Scan {
  blocks: Block[]
  /** [start, end) offsets of private key blocks in the text, for removing them */
  privateRanges: [number, number][]
}

const CERT_LABELS = new Set(['CERTIFICATE', 'TRUSTED CERTIFICATE', 'X509 CERTIFICATE'])
const CSR_LABELS = new Set(['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST'])
const IGNORED: Record<string, string> = {
  'EC PARAMETERS': 'Curve parameters only (openssl ecparam writes them before the key)',
  'DH PARAMETERS': 'Diffie-Hellman parameters are not inspected',
  'X509 CRL': 'Certificate revocation lists are not inspected',
  PKCS7: 'PKCS#7 bundles are not unpacked — export the certificates as PEM',
  CMS: 'CMS messages are not inspected',
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** RFC 1421 headers (`Proc-Type: …`) at the top of a PEM body, then the Base64. */
function splitPemBody(body: string): { headers: Record<string, string>; base64: string } {
  const headers: Record<string, string> = {}
  const lines = body.split(/\r?\n/)
  let i = 0
  while (i < lines.length && !lines[i].trim()) i += 1
  if (/^[A-Za-z][A-Za-z0-9-]*:/.test(lines[i] ?? '')) {
    while (i < lines.length && lines[i].trim()) {
      const colon = lines[i].indexOf(':')
      if (colon > 0) headers[lines[i].slice(0, colon).trim().toLowerCase()] = lines[i].slice(colon + 1).trim()
      i += 1
    }
  }
  return { headers, base64: lines.slice(i).join('') }
}

function pemBlock(label: string, body: string): Block {
  const isPrivate = isPrivateLabel(label)
  try {
    if (IGNORED[label]) return { kind: 'ignored', label, reason: IGNORED[label] }
    const { headers, base64 } = splitPemBody(body)
    const encrypted = /ENCRYPTED/i.test(headers['proc-type'] ?? '')
    // a legacy-encrypted body is ciphertext, not DER: it is never decoded
    const der = encrypted ? new Uint8Array(0) : fromBase64(base64, `The ${label} block`)
    if (!encrypted && !der.length) throw new Error('The block is empty')
    if (CERT_LABELS.has(label)) {
      // OpenSSL's TRUSTED CERTIFICATE is the certificate followed by trust settings
      return { kind: 'certificate', label, der: label === 'TRUSTED CERTIFICATE' ? der.slice(0, readNode(der).end) : der }
    }
    if (CSR_LABELS.has(label)) return { kind: 'csr', label, der }
    if (KEY_LABELS.has(label)) return { kind: 'key', label, parsed: parseKeyBlock(label, der, headers), private: isPrivate }
    return { kind: 'ignored', label, reason: `${label} blocks are not inspected` }
  } catch (cause) {
    return { kind: 'error', label, error: message(cause), private: isPrivate }
  }
}

const PEM_BEGIN = /-----BEGIN ([A-Z0-9]+(?: [A-Z0-9]+)*)-----/g
const SSH2_BEGIN = /---- BEGIN SSH2 PUBLIC KEY ----/g

export function scanText(text: string): Scan {
  const found: { start: number; end: number; block: Block }[] = []
  const covered: [number, number][] = []

  PEM_BEGIN.lastIndex = 0
  for (let match = PEM_BEGIN.exec(text); match; match = PEM_BEGIN.exec(text)) {
    const label = match[1]
    const bodyStart = match.index + match[0].length
    const endMarker = `-----END ${label}-----`
    const end = text.indexOf(endMarker, bodyStart)
    const nextBegin = text.indexOf('-----BEGIN ', bodyStart)
    if (end < 0 || (nextBegin >= 0 && nextBegin < end)) {
      const stop = nextBegin >= 0 ? nextBegin : text.length
      found.push({ start: match.index, end: stop, block: { kind: 'error', label, error: `The ${label} block has no END line — it may be truncated`, private: isPrivateLabel(label) } })
      covered.push([match.index, stop])
      PEM_BEGIN.lastIndex = stop
      continue
    }
    const blockEnd = end + endMarker.length
    found.push({ start: match.index, end: blockEnd, block: pemBlock(label, text.slice(bodyStart, end)) })
    covered.push([match.index, blockEnd])
    PEM_BEGIN.lastIndex = blockEnd
  }

  SSH2_BEGIN.lastIndex = 0
  for (let match = SSH2_BEGIN.exec(text); match; match = SSH2_BEGIN.exec(text)) {
    const bodyStart = match.index + match[0].length
    const endMarker = '---- END SSH2 PUBLIC KEY ----'
    const end = text.indexOf(endMarker, bodyStart)
    const label = 'SSH2 PUBLIC KEY'
    let block: Block
    let blockEnd: number
    if (end < 0) {
      block = { kind: 'error', label, error: 'The SSH2 public key has no END line — it may be truncated', private: false }
      blockEnd = text.length
    } else {
      blockEnd = end + endMarker.length
      try {
        block = { kind: 'key', label, parsed: parseRfc4716(text.slice(bodyStart, end)), private: false }
      } catch (cause) {
        block = { kind: 'error', label, error: message(cause), private: false }
      }
    }
    found.push({ start: match.index, end: blockEnd, block })
    covered.push([match.index, blockEnd])
    SSH2_BEGIN.lastIndex = blockEnd
  }

  // OpenSSH public key lines outside any block
  const inside = (at: number) => covered.some(([s, e]) => at >= s && at < e)
  let offset = 0
  for (const line of text.split('\n')) {
    if (!inside(offset) && isSshPublicLine(line)) {
      let block: Block
      try {
        block = { kind: 'key', label: 'OPENSSH PUBLIC KEY', parsed: parseSshPublicLine(line), private: false }
      } catch (cause) {
        block = { kind: 'error', label: 'OPENSSH PUBLIC KEY', error: message(cause), private: false }
      }
      found.push({ start: offset, end: offset + line.length, block })
    }
    offset += line.length + 1
  }

  found.sort((a, b) => a.start - b.start)
  return {
    blocks: found.map((entry) => entry.block),
    privateRanges: found.filter(({ block }) => (block.kind === 'key' || block.kind === 'error') && block.private).map(({ start, end }) => [start, end]),
  }
}

/** The text with the given ranges cut out (used to drop private keys from the input). */
export function removeRanges(text: string, ranges: [number, number][]): string {
  let out = ''
  let at = 0
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    out += text.slice(at, start)
    at = Math.max(at, end)
  }
  return (out + text.slice(at)).replace(/\n{3,}/g, '\n\n').trim()
}

export function toPemText(der: Uint8Array, label: string): string {
  return `-----BEGIN ${label}-----\n${toBase64(der).replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END ${label}-----`
}

/** What a binary DER file holds, by trying each structure in turn. */
export function sniffDer(der: Uint8Array): string | null {
  const attempts: [string, () => unknown][] = [
    ['CERTIFICATE', () => parseCertificate(der)],
    ['CERTIFICATE REQUEST', () => parseCsr(der)],
    ...['PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'PUBLIC KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'RSA PUBLIC KEY'].map(
      (label): [string, () => unknown] => [label, () => parseKeyBlock(label, der)],
    ),
  ]
  for (const [label, attempt] of attempts) {
    try {
      attempt()
      return label
    } catch {
      // try the next structure
    }
  }
  return null
}

/** A dropped or opened file as text for the input box: PEM/SSH text as is, DER as PEM. */
export function fileToText(bytes: Uint8Array): string {
  const source = new TextDecoder().decode(bytes)
  if (/-----BEGIN |---- BEGIN SSH2/.test(source) || source.split('\n').some(isSshPublicLine)) return source.trim()
  const label = sniffDer(bytes)
  if (!label) throw new Error('This file is not a certificate, CSR or key that the tool can read')
  return toPemText(bytes, label)
}
