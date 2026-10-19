import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { fixture, pageTexts, rawObjects } from '../test/helpers'
import { ascii, concatBytes, latin1 } from '../test/node'
import { loadPdf } from '../lib/load'
import { inspectMetadata, removeMetadata, type MetadataFinding, type MetadataKind } from './metadata'

const both = { attachments: true, javascript: true }
const neither = { attachments: false, javascript: false }
const count = (list: MetadataFinding[], kind: MetadataKind) => list.find((f) => f.kind === kind)?.count ?? 0
const XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:creator>XMP-MARKER</dc:creator></x:xmpmeta><?xpacket end="w"?>'

/** A small JPEG with an EXIF APP1 segment spliced in after SOI. */
function jpegWithExif(): Uint8Array {
  const plain = new Uint8Array(jpeg.encode({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).fill(200) }, 90).data)
  const body = ascii('Exif\0\0MM\0*\0\0\0\x08\0\0')
  const segment = concatBytes(new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body)
  return concatBytes(plain.subarray(0, 2), segment, plain.subarray(2))
}

/** One of everything this tool removes, each carrying a marker string to search the output for. */
async function loadedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const ctx = doc.context
  for (let i = 0; i < 2; i++) doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 12, font })
  const [page1, page2] = doc.getPages()
  doc.setTitle('TITLE-MARKER')
  doc.setAuthor('AUTHOR-MARKER')
  doc.setProducer('PRODUCER-MARKER')

  doc.catalog.set(PDFName.of('Metadata'), ctx.register(ctx.stream(XMP, { Type: 'Metadata', Subtype: 'XML' })))
  ctx.register(ctx.stream(XMP.replace('XMP-MARKER', 'ORPHAN-XMP'), { Type: 'Metadata', Subtype: 'XML' })) // left over, unreferenced

  const image = await doc.embedJpg(jpegWithExif())
  page1.drawImage(image, { x: 100, y: 100, width: 40, height: 40 })
  await doc.flush()
  const imageStream = ctx.lookup(image.ref)
  ;(imageStream as unknown as { dict: PDFDict }).dict.set(PDFName.of('Metadata'), ctx.register(ctx.stream(XMP.replace('XMP-MARKER', 'IMAGE-XMP'), { Type: 'Metadata', Subtype: 'XML' })))

  const privateData = ctx.register(ctx.stream('PRIVATE-MARKER illustrator private data'))
  page1.node.set(PDFName.of('PieceInfo'), ctx.obj({ Illustrator: { LastModified: PDFString.of('D:20200101'), Private: privateData } }))
  page1.node.set(PDFName.of('LastModified'), PDFString.of('D:20200102'))
  page2.node.set(PDFName.of('Thumb'), ctx.register(ctx.stream('THUMB-MARKER', { Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8 })))

  await doc.attach(ascii('ATTACHMENT-MARKER'), 'notes.txt', { mimeType: 'text/plain' })
  doc.addJavaScript('hello', 'app.alert("SCRIPT-MARKER")')
  doc.catalog.set(PDFName.of('OpenAction'), ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("OPEN-MARKER")') }))
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: { S: 'JavaScript', JS: PDFString.of('LINK-MARKER') } }))
  const note = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 60, 80, 80], T: PDFString.of('A commenter'), Contents: PDFString.of('a note') }))
  page2.node.set(PDFName.of('Annots'), ctx.obj([link, note]))
  return doc.save()
}

async function allText(bytes: Uint8Array): Promise<string> {
  return (await rawObjects(bytes)).map((o) => o.text).join('\n')
}

describe('Remove Metadata', () => {
  it('finds each kind, removes it, and the re-parsed output proves it', async () => {
    const input = await loadedPdf()
    const report = await removeMetadata(input, both)

    expect(count(report.found, 'info')).toBe(1)
    expect(report.found.find((f) => f.kind === 'info')!.details).toEqual(expect.arrayContaining(['Title: TITLE-MARKER', 'Author: AUTHOR-MARKER']))
    expect(count(report.found, 'xmp')).toBe(3)
    expect(report.found.find((f) => f.kind === 'xmp')!.details).toEqual(
      expect.arrayContaining(['on the document', 'on an image', 'unreferenced (left over from an earlier edit)']),
    )
    expect(count(report.found, 'piece-info')).toBe(1) // the page's PieceInfo; its own LastModified is not counted twice
    expect(count(report.found, 'thumbnail')).toBe(1)
    expect(count(report.found, 'attachment')).toBe(1)
    expect(report.found.find((f) => f.kind === 'attachment')!.details).toEqual(['notes.txt'])
    expect(count(report.found, 'javascript')).toBe(3)
    expect(count(report.found, 'image-metadata')).toBe(1)

    for (const kind of report.targeted) expect(count(report.remain, kind), kind).toBe(0)
    expect(report.contentKept).toBe(true)
    expect(report.pages).toBe(2)
    expect(count(report.remain, 'image-metadata')).toBe(1) // listed, and honestly still there
    expect(report.notes.join(' ')).toMatch(/1 comment or markup annotation keep their author name/)
    expect(report.notes.join(' ')).toMatch(/JPEG photos keep their own EXIF/)

    // independently of the tool's own inspector: none of the markers survive anywhere in the file
    const text = await allText(report.bytes)
    for (const marker of ['TITLE-MARKER', 'AUTHOR-MARKER', 'PRODUCER-MARKER', 'XMP-MARKER', 'ORPHAN-XMP', 'IMAGE-XMP', 'PRIVATE-MARKER', 'THUMB-MARKER', 'ATTACHMENT-MARKER', 'SCRIPT-MARKER', 'OPEN-MARKER', 'LINK-MARKER', 'D:2020']) {
      expect(text, marker).not.toContain(marker)
    }
    expect(latin1(report.bytes)).not.toMatch(/\/Info\b/)
    expect(latin1(report.bytes)).not.toContain('pdf-lib')
    expect(await pageTexts(report.bytes)).toEqual(await pageTexts(input))
  })

  it('keeps attachments and JavaScript unless asked, and says they remain', async () => {
    const report = await removeMetadata(await loadedPdf(), neither)
    expect(report.targeted).not.toContain('attachment')
    expect(report.targeted).not.toContain('javascript')
    expect(count(report.remain, 'attachment')).toBe(1)
    expect(count(report.remain, 'javascript')).toBe(3)
    for (const kind of report.targeted) expect(count(report.remain, kind), kind).toBe(0)
    const text = await allText(report.bytes)
    expect(text).toContain('ATTACHMENT-MARKER')
    expect(text).not.toContain('TITLE-MARKER')
    const doc = await PDFDocument.load(report.bytes)
    const annots = doc.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray)
    expect(annots.size()).toBe(2) // the link keeps its place; only its script goes when asked
  })

  it('removes file-attachment annotations with the attachments', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 200])
    const ctx = doc.context
    const file = ctx.register(ctx.stream('ANNOT-FILE', { Type: 'EmbeddedFile' }))
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [0, 0, 10, 10], FS: { Type: 'Filespec', F: PDFString.of('a.bin'), EF: { F: file } } }))
    page.node.set(PDFName.of('Annots'), ctx.obj([annot]))
    const report = await removeMetadata(await doc.save(), both)
    expect(count(report.found, 'attachment')).toBe(1)
    expect(count(report.remain, 'attachment')).toBe(0)
    expect(await allText(report.bytes)).not.toContain('ANNOT-FILE')
  })

  it('works on files written by macOS PDFKit', async () => {
    const input = fixture('pdfkit-resaved.pdf')
    const report = await removeMetadata(input, both)
    expect(count(report.found, 'info')).toBe(1)
    for (const kind of report.targeted) expect(count(report.remain, kind), kind).toBe(0)
    expect(report.contentKept).toBe(true)
    expect(await pageTexts(report.bytes)).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
    const check = await loadPdf(report.bytes, 'x', { updateMetadata: false })
    expect(check.context.trailerInfo.Info).toBeUndefined()
  })

  it('works on the plain fixture and leaves a file with nothing to remove clean', async () => {
    const first = await removeMetadata(fixture('plain.pdf'), both)
    expect(first.contentKept).toBe(true)
    const again = await removeMetadata(first.bytes, both)
    expect(again.found).toEqual([])
    expect(again.remain).toEqual([])
  })

  it('refuses encrypted input like the other tools', async () => {
    for (const file of ['aes-128.pdf', 'rc4-40.pdf', 'rc4-128-owner-only.pdf']) {
      await expect(removeMetadata(fixture(file), both), file).rejects.toThrow(/password-protected or encrypted.*Unlock PDF/)
    }
  })

  it('reports nothing for a pdf-lib document saved without metadata', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.addPage()
    expect(inspectMetadata(await loadPdf(await doc.save(), 'x', { updateMetadata: false }))).toEqual([])
  })
})
