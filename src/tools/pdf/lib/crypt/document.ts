/**
 * Encryption and decryption of whole documents on top of pdf-lib, which can
 * read the structure of an encrypted file but cannot decrypt or encrypt it.
 *
 * Decryption has to happen *during* parsing: pdf-lib unpacks object streams
 * as it meets them, and an encrypted object stream is noise until it is
 * decrypted. So the file is parsed twice (../parse.ts) — once to find
 * /Encrypt and /ID in the trailer, once with a hook that decrypts each
 * object before pdf-lib looks inside it.
 */
import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFWriter,
} from 'pdf-lib'
import { objectStreamsToUnpack, parsePdf } from '../parse'
import { authenticate, createR6, ObjectCipher, type Method, type SecurityParams } from './standard'
import { randomBytes } from './primitives'

export class PdfSecurityError extends Error {
  constructor(public readonly code: 'not-encrypted' | 'wrong-password' | 'unsupported', message: string) {
    super(message)
  }
}

const name = (n: string) => PDFName.of(n)

/** Bytes of a literal string as the spec reads them (§7.3.4.2) — pdf-lib's asBytes mishandles EOLs. */
export function literalBytes(value: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i) & 0xff
    if (c === 0x0d) {
      // an unescaped EOL is read as a single line feed
      out.push(0x0a)
      if (value.charCodeAt(i + 1) === 0x0a) i++
      continue
    }
    if (c !== 0x5c) {
      out.push(c)
      continue
    }
    const next = value.charCodeAt(++i) & 0xff
    if (i >= value.length) break
    const simple: Record<number, number> = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c }
    if (next in simple) out.push(simple[next])
    else if (next === 0x0d) {
      if (value.charCodeAt(i + 1) === 0x0a) i++
    } else if (next === 0x0a) {
      // escaped EOL: a line continuation, contributes nothing
    } else if (next >= 0x30 && next <= 0x37) {
      let oct = next - 0x30
      for (let k = 0; k < 2; k++) {
        const d = value.charCodeAt(i + 1)
        if (d >= 0x30 && d <= 0x37) {
          oct = oct * 8 + (d - 0x30)
          i++
        } else break
      }
      out.push(oct & 0xff)
    } else out.push(next)
  }
  return new Uint8Array(out)
}

export function stringBytes(obj: PDFString | PDFHexString): Uint8Array {
  if (obj instanceof PDFString) return literalBytes(obj.asString())
  const hex = obj.asString().replace(/[^0-9a-fA-F]/g, '')
  const even = hex.length % 2 ? hex + '0' : hex
  const out = new Uint8Array(even.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(even.substr(i * 2, 2), 16)
  return out
}

function hexOf(bytes: Uint8Array): PDFHexString {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return PDFHexString.of(s)
}

type Transform = (bytes: Uint8Array) => Promise<Uint8Array>

/** Rewrites every string inside obj (in place for dicts and arrays). */
async function mapStrings(obj: PDFObject, fn: Transform): Promise<PDFObject> {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return hexOf(await fn(stringBytes(obj)))
  if (obj instanceof PDFDict) {
    for (const [key, value] of obj.entries()) {
      const next = await mapStrings(value, fn)
      if (next !== value) obj.set(key, next)
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const value = obj.get(i)
      const next = await mapStrings(value, fn)
      if (next !== value) obj.set(i, next)
    }
  } else if (obj instanceof PDFStream) {
    await mapStrings(obj.dict, fn)
  }
  return obj
}

function num(dict: PDFDict, key: string): number | undefined {
  const v = dict.lookup(name(key))
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

function bytesOf(dict: PDFDict, key: string): Uint8Array | undefined {
  const v = dict.lookup(name(key))
  return v instanceof PDFString || v instanceof PDFHexString ? stringBytes(v) : undefined
}

/** Why a file under a security handler other than /Standard cannot be unlocked here, naming the handler. */
function otherHandlerMessage(filter: PDFObject | undefined, subFilter: PDFObject | undefined): string {
  const handler = filter instanceof PDFName ? filter.decodeText() : undefined
  const sub = subFilter instanceof PDFName ? subFilter.decodeText() : ''
  if (handler === 'Adobe.PubSec' || /^adbe\.pkcs7\./.test(sub)) {
    return 'This PDF uses certificate (public-key) encryption, which only its recipients can open — it cannot be unlocked with a password.'
  }
  if (handler === 'Adobe.APS') {
    return 'This PDF is protected by Adobe LiveCycle Rights Management (Adobe.APS), a DRM system whose keys come from its policy server — it cannot be unlocked with a password.'
  }
  if (!handler) return 'This PDF’s encryption names no security handler, so it cannot be unlocked.'
  return `This PDF uses the “${handler}” security handler, a third-party or DRM scheme this tool does not support — it cannot be unlocked with a password.`
}

function readParams(enc: PDFDict, context: PDFContext): SecurityParams {
  const filter = enc.lookup(name('Filter'))
  if (filter !== name('Standard')) throw new PdfSecurityError('unsupported', otherHandlerMessage(filter, enc.lookup(name('SubFilter'))))
  const v = num(enc, 'V') ?? 0
  const r = num(enc, 'R') ?? 0
  const o = bytesOf(enc, 'O')
  const u = bytesOf(enc, 'U')
  const p = num(enc, 'P')
  if (![1, 2, 4, 5].includes(v) || r < 2 || r > 6 || !o || !u || p === undefined) {
    throw new PdfSecurityError('unsupported', `This PDF uses an encryption variant this tool does not support (V${v}, R${r}).`)
  }

  const cf = enc.lookup(name('CF'))
  const method = (filterName: PDFObject | undefined): Method => {
    if (v < 4) return 'rc4'
    if (!(filterName instanceof PDFName) || filterName === name('Identity')) return 'identity'
    const entry = cf instanceof PDFDict ? cf.lookup(filterName) : undefined
    const cfm = entry instanceof PDFDict ? entry.lookup(name('CFM')) : undefined
    if (cfm === name('V2')) return 'rc4'
    if (cfm === name('AESV2')) return 'aesv2'
    if (cfm === name('AESV3')) return 'aesv3'
    return 'identity'
  }

  let keyLength = 32
  if (v < 5) {
    const bits = num(enc, 'Length') ?? (v === 4 ? 128 : 40)
    // some writers give the length in bytes rather than bits
    keyLength = Math.min(16, Math.max(5, bits <= 16 ? bits : Math.floor(bits / 8)))
  }
  const em = enc.lookup(name('EncryptMetadata'))
  const id = context.trailerInfo.ID
  const idArray = id instanceof PDFArray ? id : id instanceof PDFRef ? context.lookup(id) : undefined
  const id0 = idArray instanceof PDFArray ? idArray.lookup(0) : undefined

  return {
    r,
    keyLength,
    o,
    u,
    oe: bytesOf(enc, 'OE'),
    ue: bytesOf(enc, 'UE'),
    p,
    encryptMetadata: !(em instanceof PDFBool) || em.asBoolean(),
    stream: method(enc.lookup(name('StmF'))),
    string: method(enc.lookup(name('StrF'))),
    id: id0 instanceof PDFString || id0 instanceof PDFHexString ? stringBytes(id0) : new Uint8Array(0),
  }
}

/** True when the trailer names an /Encrypt dictionary. */
export function isEncrypted(context: PDFContext): boolean {
  return context.trailerInfo.Encrypt !== undefined
}

/** The file decrypted, with /Encrypt removed (see decryptPdfReport). */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return (await decryptPdfReport(bytes, password)).bytes
}

export interface DecryptResult {
  bytes: Uint8Array
  /**
   * 'without-password': the file opens with the empty user password — it
   * only restricted permissions — whatever password was given (a wrong
   * owner password is no reason to refuse such a file).
   */
  opened: 'password' | 'without-password'
}

/** Returns the file decrypted, with /Encrypt removed, and how it was opened. */
export async function decryptPdfReport(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const first = await parsePdf(bytes, { unpackObjectStreams: false })
  const encRef = first.trailerInfo.Encrypt
  const enc = encRef instanceof PDFRef ? first.lookup(encRef) : encRef
  if (!enc) throw new PdfSecurityError('not-encrypted', 'This PDF is not password-protected — there is nothing to unlock.')
  if (!(enc instanceof PDFDict)) throw new PdfSecurityError('unsupported', 'This PDF’s encryption dictionary is damaged.')
  const params = readParams(enc, first)
  let fileKey = password ? await authenticate(params, password) : null
  let opened: DecryptResult['opened'] = 'password'
  if (!fileKey) {
    fileKey = await authenticate(params, '')
    opened = 'without-password'
  }
  if (!fileKey) {
    throw new PdfSecurityError('wrong-password', password ? 'Wrong password for this PDF.' : 'This PDF needs a password to open — enter it above.')
  }
  const cipher = new ObjectCipher(fileKey, params)

  const context = await parsePdf(bytes, { unpackObjectStreams: await objectStreamsToUnpack(bytes), hook: async (ref, object) => {
    if (ref === encRef) return object
    const { objectNumber: n, generationNumber: g } = ref
    if (object instanceof PDFRawStream) {
      const type = object.dict.lookup(name('Type'))
      const skip = (type === name('Metadata') && !params.encryptMetadata) || usesIdentityCryptFilter(object.dict)
      const contents = skip ? object.contents : await cipher.decrypt(object.contents, n, g, 'stream')
      object = PDFRawStream.of(object.dict, contents)
    }
    return mapStrings(object, (b) => cipher.decrypt(b, n, g, 'string'))
  } })
  if (encRef instanceof PDFRef) context.delete(encRef)
  context.trailerInfo.Encrypt = undefined
  return { bytes: await PDFWriter.forContext(context, 50).serializeToBuffer(), opened }
}

/** A stream that opts out of encryption with /Filter [/Crypt] /DecodeParms << /Name /Identity >> (or no name). */
function usesIdentityCryptFilter(dict: PDFDict): boolean {
  const filter = dict.lookup(name('Filter'))
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter]
  const at = filters.findIndex((f) => f === name('Crypt'))
  if (at < 0) return false
  const parms = dict.lookup(name('DecodeParms'))
  const parm = parms instanceof PDFArray ? parms.lookup(at) : parms
  const cryptName = parm instanceof PDFDict ? parm.lookup(name('Name')) : undefined
  return cryptName === undefined || cryptName === name('Identity')
}

/** All permissions granted: bits 1–2 clear, every other bit set. */
const ALL_PERMISSIONS = -4

/**
 * Encrypts doc in place with AES-256 (R6). Save it afterwards with
 * useObjectStreams: false — strings are encrypted per object, so they must
 * not be moved into object streams the writer creates later.
 */
export async function encryptDocument(doc: PDFDocument, userPassword: string, ownerPassword: string): Promise<void> {
  await doc.flush()
  const context = doc.context
  const r6 = await createR6(userPassword, ownerPassword, ALL_PERMISSIONS)
  const cipher = new ObjectCipher(r6.fileKey, { stream: 'aesv3', string: 'aesv3' })

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const { objectNumber: n, generationNumber: g } = ref
    let next: PDFObject = object
    if (object instanceof PDFStream) {
      const type = object.dict.lookup(name('Type'))
      if (type === name('XRef')) continue
      next = PDFRawStream.of(object.dict, await cipher.encrypt(object.getContents(), n, g, 'stream'))
    }
    next = await mapStrings(next, (b) => cipher.encrypt(b, n, g, 'string'))
    if (next !== object) context.assign(ref, next)
  }

  const encrypt = context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    P: ALL_PERMISSIONS,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
  })
  encrypt.set(name('O'), hexOf(r6.o))
  encrypt.set(name('U'), hexOf(r6.u))
  encrypt.set(name('OE'), hexOf(r6.oe))
  encrypt.set(name('UE'), hexOf(r6.ue))
  encrypt.set(name('Perms'), hexOf(r6.perms))
  context.trailerInfo.Encrypt = context.register(encrypt)
  // /ID is required whenever /Encrypt is present
  if (!context.trailerInfo.ID) {
    const id = hexOf(randomBytes(16))
    context.trailerInfo.ID = context.obj([id, id])
  }
}
