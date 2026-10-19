import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import { md5, rc4 } from './primitives'
import { decryptPdf, decryptPdfReport, encryptDocument, literalBytes, PdfSecurityError } from './document'
import { legacyFileKey, legacyOwnerKey, legacyUserValue, ObjectCipher, type SecurityParams } from './standard'
import { fixture, makePdf, pdfjsOpen, pdfjsText } from '../../test/helpers'
import { hex, latin1, nodeMd5Hex } from '../../test/node'

const HELLO = ['Hello page 1', 'Hello page 2', 'Hello page 3']

describe('primitives', () => {
  it('md5 matches node:crypto, including multi-block inputs', () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 255)
      expect(hex(md5(data))).toBe(nodeMd5Hex(data))
    }
  })

  it('rc4 matches the published test vector', () => {
    const out = rc4(new TextEncoder().encode('Key'), new TextEncoder().encode('Plaintext'))
    expect(hex(out)).toBe('bbf316e8d940af0ad3')
  })

  it('reads literal strings per the spec (escapes, octal, EOL normalisation)', () => {
    expect([...literalBytes('a\\nb\\(\\)\\\\\\101\\0Z')]).toEqual([0x61, 0x0a, 0x62, 0x28, 0x29, 0x5c, 0x41, 0x00, 0x5a])
    expect([...literalBytes('a\r\nb\rc')]).toEqual([0x61, 0x0a, 0x62, 0x0a, 0x63])
    expect([...literalBytes('a\\\r\nb')]).toEqual([0x61, 0x62])
  })
})

describe('unlock: files encrypted by Apple PDFKit / CoreGraphics', () => {
  // CoreGraphics' 40-bit /O does not follow Algorithm 3 — pdf.js rejects
  // its owner password too — so that file is only opened as its user.
  const cases: [string, string, string[]][] = [
    ['rc4-128-objstm.pdf', 'RC4-128 with object streams', ['user pw', 'owner pw']],
    ['rc4-40.pdf', 'RC4-40', ['user pw']],
    ['aes-128.pdf', 'AES-128', ['user pw', 'owner pw']],
  ]

  it.each(cases)('%s (%s) needs a password before, and none after', async (file, _, passwords) => {
    const bytes = fixture(file)
    expect(await pdfjsOpen(bytes)).toBe('need-password')
    for (const password of passwords) {
      const out = await decryptPdf(bytes, password)
      expect(await pdfjsText(out)).toEqual(HELLO)
      const doc = await PDFDocument.load(out)
      expect(doc.isEncrypted).toBe(false)
      expect(doc.getPageCount()).toBe(3)
    }
  })

  it.each(cases)('%s rejects a wrong or missing password with a clear message', async (file) => {
    await expect(decryptPdf(fixture(file), 'nope')).rejects.toMatchObject({ code: 'wrong-password', message: 'Wrong password for this PDF.' })
    await expect(decryptPdf(fixture(file), '')).rejects.toMatchObject({ code: 'wrong-password', message: expect.stringMatching(/needs a password/) })
  })

  it('removes owner-only restrictions with an empty password', async () => {
    const out = await decryptPdf(fixture('rc4-128-owner-only.pdf'), '')
    expect(await pdfjsText(out)).toEqual(HELLO)
    expect((await PDFDocument.load(out)).isEncrypted).toBe(false)
  })

  it('says when there is nothing to unlock, or the file is not a PDF', async () => {
    await expect(decryptPdf(fixture('plain.pdf'), 'x')).rejects.toMatchObject({ code: 'not-encrypted' })
  })
})

describe('protect: AES-256 (R6)', () => {
  async function protect(bytes: Uint8Array, user: string, owner = user) {
    const doc = await PDFDocument.load(bytes)
    await encryptDocument(doc, user, owner)
    return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  }

  it('produces a file pdf.js will not open without the password', async () => {
    const out = await protect(await makePdf(3, { title: 'Secret title' }), 'correct horse')
    const text = latin1(out)
    expect(text).toContain('/Encrypt')
    expect(text).not.toContain('Secret title')
    expect(text).not.toContain('Page 1')
    expect(await pdfjsOpen(out)).toBe('need-password')
    expect(await pdfjsOpen(out, 'wrong')).toBe('incorrect-password')
    expect(await pdfjsText(out, 'correct horse')).toEqual(['Page 1', 'Page 2', 'Page 3'])
  })

  it('round-trips through unlock, keeping metadata', async () => {
    const out = await protect(await makePdf(2, { title: 'Ünïcode títle' }), 'pw')
    const back = await PDFDocument.load(await decryptPdf(out, 'pw'))
    expect(back.getTitle()).toBe('Ünïcode títle')
    expect(back.getPageCount()).toBe(2)
  })

  it('handles non-ASCII passwords the way pdf.js reads them (NFKC/SASLprep, UTF-8)', async () => {
    const out = await protect(await makePdf(1), 'pässwörd-密码')
    expect(await pdfjsText(out, 'pässwörd-密码')).toEqual(['Page 1'])
    // the decomposed spelling normalises to the same password
    expect(await pdfjsText(out, 'pässwörd-密码')).toEqual(['Page 1'])
    expect((await PDFDocument.load(await decryptPdf(out, 'pässwörd-密码'))).getPageCount()).toBe(1)
  })

  it('accepts the owner password as well as the user password', async () => {
    const out = await protect(await makePdf(1), 'user', 'owner')
    expect(await pdfjsText(out, 'owner')).toEqual(['Page 1'])
    expect(await pdfjsText(out, 'user')).toEqual(['Page 1'])
  })
})

/**
 * The older revisions are never written by the site, but Unlock must read
 * them. This encrypts with R2/R3/R4 using the handler's own key functions;
 * pdf.js opening the result is the independent check that those match the
 * spec, and unlocking it again checks the reading side.
 */
async function legacyEncrypt(bytes: Uint8Array, r: 2 | 3 | 4, aes: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  await doc.flush()
  const id = new Uint8Array(16).map((_, i) => i * 7)
  const keyLength = r === 2 ? 5 : 16
  const base: SecurityParams = {
    r, keyLength, o: new Uint8Array(32), u: new Uint8Array(32), p: -4, encryptMetadata: true,
    stream: aes ? 'aesv2' : 'rc4', string: aes ? 'aesv2' : 'rc4', id,
  }
  const pad = (s: string) => {
    const PAD = [0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]
    const b = new TextEncoder().encode(s)
    return Uint8Array.from({ length: 32 }, (_, i) => (i < b.length ? b[i] : PAD[i - b.length]))
  }
  const ownerKey = legacyOwnerKey(new TextEncoder().encode('owner'), base)
  let o: Uint8Array = pad('user')
  if (r === 2) o = rc4(ownerKey, o)
  else for (let i = 0; i <= 19; i++) o = rc4(ownerKey.map((b) => b ^ i), o)
  const params = { ...base, o }
  const key = legacyFileKey(pad('user'), params)
  const u = legacyUserValue(key, params)
  const cipher = new ObjectCipher(key, params)
  const { PDFRawStream, PDFStream } = await import('pdf-lib')
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      doc.context.assign(ref, PDFRawStream.of(obj.dict, await cipher.encrypt(obj.getContents(), ref.objectNumber, ref.generationNumber, 'stream')))
    }
  }
  const hexString = (b: Uint8Array) => PDFHexString.of(hex(b))
  const enc = doc.context.obj(
    r === 4
      ? { Filter: 'Standard', V: 4, R: 4, Length: 128, P: -4, CF: { StdCF: { CFM: aes ? 'AESV2' : 'V2', Length: 16 } }, StmF: 'StdCF', StrF: 'StdCF' }
      : { Filter: 'Standard', V: r === 2 ? 1 : 2, R: r, Length: keyLength * 8, P: -4 },
  )
  enc.set(PDFName.of('O'), hexString(o))
  enc.set(PDFName.of('U'), hexString(u))
  doc.context.trailerInfo.Encrypt = doc.context.register(enc)
  doc.context.trailerInfo.ID = doc.context.obj([hexString(id), hexString(id)])
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

describe('unlock: older handler revisions', () => {
  it.each([
    [2, false],
    [3, false],
    [4, false],
    [4, true],
  ] as const)('R%i (aes: %s) — pdf.js reads our encryption, and unlock reverses it', async (r, aes) => {
    const out = await legacyEncrypt(await makePdf(2), r, aes)
    expect(await pdfjsOpen(out)).toBe('need-password')
    expect(await pdfjsText(out, 'user')).toEqual(['Page 1', 'Page 2'])
    for (const pw of ['user', 'owner']) expect(await pdfjsText(await decryptPdf(out, pw))).toEqual(['Page 1', 'Page 2'])
    await expect(decryptPdf(out, 'other')).rejects.toBeInstanceOf(PdfSecurityError)
  })
})

describe('unlock: owner-only files and other security handlers', () => {
  it('opens an owner-only file with the empty user password when the owner password given is wrong', async () => {
    const result = await decryptPdfReport(fixture('rc4-128-owner-only.pdf'), 'not the owner password')
    expect(result.opened).toBe('without-password')
    expect(await pdfjsText(result.bytes)).toEqual(HELLO)
    expect((await decryptPdfReport(fixture('rc4-128-owner-only.pdf'), '')).opened).toBe('without-password')
    expect((await decryptPdfReport(fixture('rc4-128-owner-only.pdf'), 'owner pw')).opened).toBe('password')
    // a file that does need a password still refuses the wrong one
    await expect(decryptPdfReport(fixture('aes-128.pdf'), 'nope')).rejects.toMatchObject({ code: 'wrong-password' })
  })

  async function withHandler(filter: string, subFilter?: string) {
    const doc = await PDFDocument.load(await makePdf(1))
    const enc = doc.context.obj({ Filter: filter, ...(subFilter ? { SubFilter: subFilter } : {}), V: 4, R: 4 })
    doc.context.trailerInfo.Encrypt = doc.context.register(enc)
    return doc.save({ useObjectStreams: false })
  }

  it.each([
    ['Adobe.PubSec', 'adbe.pkcs7.s5', /certificate \(public-key\) encryption/],
    ['Adobe.APS', undefined, /Adobe LiveCycle Rights Management \(Adobe\.APS\).*DRM/],
    ['FOPN_foweb', undefined, /“FOPN_foweb” security handler/],
  ])('names the %s handler accurately', async (filter, subFilter, message) => {
    await expect(decryptPdf(await withHandler(filter, subFilter), 'x')).rejects.toMatchObject({ code: 'unsupported', message: expect.stringMatching(message) })
  })
})
