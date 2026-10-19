import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { fixture, makePdf, makeRichPdf, nodePdfJs, pageInfo, pageTexts } from '../test/helpers'
import { ascii, concatBytes, deflate, latin1 } from '../test/node'
import { describeError, ENCRYPTED_MESSAGE, loadPdf, PdfInputError } from '../lib/load'
import { mergePdfs, removePages, reorderPages, rotatePdf, splitPdf } from './organize'
import { addPageNumbers, addWatermark, compressPdf, toRoman, type Corner } from './edit'
import { protectPdf, unlockPdf } from './security'
import { imageKind, imagesToPdf, jpegOrientation, orientationMatrix } from './images'
import { extractText, joinTextItems, renderScale } from './read'

const named = (name: string, bytes: Uint8Array) => ({ name, bytes })
const emptyPdf = async () => (await PDFDocument.create()).save({ addDefaultPage: false })

/** Every pdf-lib tool, run with default options on one input. */
const singleInputTools: [string, (b: Uint8Array) => Promise<unknown>][] = [
  ['split', (b) => splitPdf(b, { kind: 'every', pages: 1 })],
  ['rotate', (b) => rotatePdf(b, 90)],
  ['remove-pages', (b) => removePages(b, '1')],
  ['reorder', (b) => reorderPages(b, '1')],
  ['compress', (b) => compressPdf(b)],
  ['page-numbers', (b) => addPageNumbers(b, { position: 'bottom-center', style: 'numeric', prefix: '', startFrom: 1 })],
  ['watermark', (b) => addWatermark(b, { text: 'DRAFT', opacity: 0.3, position: 'center' })],
  ['protect', (b) => protectPdf(b, 'pw')],
  ['merge', (b) => mergePdfs([named('a.pdf', b), named('b.pdf', b)])],
]

describe('every pdf-lib tool refuses bad input with a clear message', () => {
  it.each(singleInputTools)('%s: non-PDF input', async (_, run) => {
    await expect(run(new TextEncoder().encode('just some text, not a PDF'))).rejects.toThrow(/is not a PDF/)
  })

  it.each(singleInputTools)('%s: encrypted input (instead of a silently broken file)', async (_, run) => {
    for (const file of ['aes-128.pdf', 'rc4-128-owner-only.pdf']) {
      await expect(run(fixture(file))).rejects.toThrow(/password-protected or encrypted.*Unlock PDF/)
    }
  })

  it.each(singleInputTools)('%s: truncated input', async (_, run) => {
    const whole = await makePdf(3)
    await expect(run(whole.subarray(0, 300))).rejects.toBeInstanceOf(PdfInputError)
  })

  it('names the file in multi-file errors, unicode names included', async () => {
    await expect(mergePdfs([named('ok.pdf', await makePdf(1)), named('résumé – 履歴書.pdf', new Uint8Array([1, 2, 3]))])).rejects.toThrow(
      'résumé – 履歴書.pdf is not a PDF.',
    )
  })

  it('fails fast on a page tree that contains itself', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const pages = doc.catalog.lookup(PDFName.of('Pages'))
    ;(pages as unknown as { lookup: (n: PDFName) => { push: (r: unknown) => void } }).lookup(PDFName.of('Kids')).push(doc.catalog.get(PDFName.of('Pages')))
    const bytes = await doc.save({ useObjectStreams: false })
    const started = Date.now()
    await rotatePdf(bytes, 90).catch(() => undefined)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('maps font-encoding and size failures to readable messages', () => {
    expect(describeError(new Error('WinAnsi cannot encode "页" (0x9875)'))).toMatch(/Latin-1/)
    expect(describeError(new RangeError('Maximum call stack size exceeded'))).toMatch(/too large or too deeply nested/)
  })
})

describe('reading files re-saved by macOS Preview / PDFKit', () => {
  // PDFKit leaves the original object stream behind, after the live objects;
  // pdf-lib used to unpack it over them, blanking and swapping pages.
  it('keeps every page’s own content', async () => {
    const input = fixture('pdfkit-resaved.pdf')
    expect(await pageTexts(input)).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
    expect(await pageTexts(await rotatePdf(input, 90))).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
    const [file] = await splitPdf(input, { kind: 'first', pages: 3 })
    expect(await pageTexts(file.bytes)).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
  })

  it('still unpacks object streams in files that use them', async () => {
    const withStreams = await makePdf(4) // pdf-lib writes object streams + an xref stream
    expect(latin1(withStreams)).toContain('/ObjStm')
    expect((await loadPdf(withStreams)).getPageCount()).toBe(4)
  })
})

describe('Merge PDF', () => {
  it('appends every page in file order, keeping sizes and rotations', async () => {
    const a = await makePdf(3)
    const b = await makePdf([{ size: [595, 842], rotate: 90, text: 'B1' }, { size: [842, 595], text: 'B2' }])
    const { bytes: out } = await mergePdfs([named('a.pdf', a), named('b.pdf', b)])
    expect(await pageTexts(out)).toEqual(['Page 1', 'Page 2', 'Page 3', 'B1', 'B2'])
    expect((await pageInfo(out)).slice(3)).toEqual([
      { width: 595, height: 842, rotate: 90 },
      { width: 842, height: 595, rotate: 0 },
    ])
  })

  it('needs two files, and at least one page between them', async () => {
    await expect(mergePdfs([named('a.pdf', await makePdf(1))])).rejects.toThrow(/at least two/)
    await expect(mergePdfs([named('a.pdf', await emptyPdf()), named('b.pdf', await emptyPdf())])).rejects.toThrow(/has any pages/)
    expect(await pageTexts((await mergePdfs([named('a.pdf', await emptyPdf()), named('b.pdf', await makePdf(1))])).bytes)).toEqual(['Page 1'])
  })

  it('reports progress per file', async () => {
    const seen: number[] = []
    await mergePdfs([named('a', await makePdf(1)), named('b', await makePdf(1)), named('c', await makePdf(1))], (n) => seen.push(n))
    expect(seen).toEqual([1, 2, 3])
  })
})

describe('Split PDF', () => {
  const texts = async (files: { bytes: Uint8Array }[]) => Promise.all(files.map((f) => pageTexts(f.bytes)))

  it('every N pages', async () => {
    const files = await splitPdf(await makePdf(5), { kind: 'every', pages: 2 })
    expect(files.map((f) => f.name)).toEqual(['split-1.pdf', 'split-2.pdf', 'split-3.pdf'])
    expect(await texts(files)).toEqual([['Page 1', 'Page 2'], ['Page 3', 'Page 4'], ['Page 5']])
  })

  it('first X pages, and the rest', async () => {
    expect(await texts(await splitPdf(await makePdf(5), { kind: 'first', pages: 2 }))).toEqual([['Page 1', 'Page 2'], ['Page 3', 'Page 4', 'Page 5']])
    expect(await texts(await splitPdf(await makePdf(2), { kind: 'first', pages: 10 }))).toEqual([['Page 1', 'Page 2']])
  })

  it('ranges, including open-ended and descending ones', async () => {
    const files = await splitPdf(await makePdf(9), { kind: 'ranges', ranges: '1-3, 5 ,7-' })
    expect(await texts(files)).toEqual([['Page 1', 'Page 2', 'Page 3'], ['Page 5'], ['Page 7', 'Page 8', 'Page 9']])
    expect(await texts(await splitPdf(await makePdf(4), { kind: 'ranges', ranges: '-2,4-3' }))).toEqual([['Page 1', 'Page 2'], ['Page 4', 'Page 3']])
  })

  it('refuses out-of-range, malformed and enormous ranges without allocating them', async () => {
    const five = await makePdf(5)
    await expect(splitPdf(five, { kind: 'ranges', ranges: '1-3,8' })).rejects.toThrow('Page 8 is out of range — this PDF has 5 pages.')
    await expect(splitPdf(five, { kind: 'ranges', ranges: '0' })).rejects.toThrow(/Page 0 is out of range/)
    await expect(splitPdf(five, { kind: 'ranges', ranges: 'two' })).rejects.toThrow(/not a page number or range/)
    await expect(splitPdf(five, { kind: 'ranges', ranges: ' , ' })).rejects.toThrow(/at least one page/)
    const started = Date.now()
    await expect(splitPdf(five, { kind: 'ranges', ranges: '1-300000000' })).rejects.toThrow(/out of range/)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('handles one-page and zero-page inputs', async () => {
    expect(await texts(await splitPdf(await makePdf(1), { kind: 'every', pages: 1 }))).toEqual([['Page 1']])
    await expect(splitPdf(await emptyPdf(), { kind: 'every', pages: 1 })).rejects.toThrow('This PDF has no pages.')
  })

  it('copes with a large page count', async () => {
    const files = await splitPdf(await makePdf(600), { kind: 'every', pages: 100 })
    expect(files).toHaveLength(6)
    expect((await PDFDocument.load(files[5].bytes)).getPageCount()).toBe(100)
  }, 30_000)
})

describe('Rotate PDF', () => {
  it('adds the angle to each page’s own rotation, clockwise', async () => {
    const input = await makePdf([{ rotate: 0 }, { rotate: 90 }, { rotate: 270 }, { size: [500, 200] }])
    expect((await pageInfo(await rotatePdf(input, 90))).map((p) => p.rotate)).toEqual([90, 180, 0, 90])
    expect((await pageInfo(await rotatePdf(input, 270))).map((p) => p.rotate)).toEqual([270, 0, 180, 270])
    const out = await rotatePdf(input, 180)
    expect((await pageInfo(out))[3]).toEqual({ width: 500, height: 200, rotate: 180 })
    expect(await pageTexts(out)).toEqual(['Page 1', 'Page 2', 'Page 3', 'Page 4'])
  })
})

describe('Remove Pages', () => {
  it('accepts single pages and ranges', async () => {
    expect(await pageTexts(await removePages(await makePdf(4), '2-3'))).toEqual(['Page 1', 'Page 4'])
    expect(await pageTexts(await removePages(await makePdf(9), '1-3,5,7-'))).toEqual(['Page 4', 'Page 6'])
    expect(await pageTexts(await removePages(await makePdf(3), '2,2'))).toEqual(['Page 1', 'Page 3'])
  })

  it('refuses to remove every page or pages that do not exist', async () => {
    await expect(removePages(await makePdf(2), '1-2')).rejects.toThrow(/remove every page/)
    await expect(removePages(await makePdf(2), '3')).rejects.toThrow(/Page 3 is out of range — this PDF has 2 pages/)
  })

  it('keeps page sizes and rotations', async () => {
    const out = await removePages(await makePdf([{ size: [100, 200] }, { size: [600, 300], rotate: 270 }]), '1')
    expect(await pageInfo(out)).toEqual([{ width: 600, height: 300, rotate: 270 }])
  })
})

describe('Reorder Pages', () => {
  it('puts pages in the given order, ranges allowed', async () => {
    expect(await pageTexts(await reorderPages(await makePdf(3), '3,1,2'))).toEqual(['Page 3', 'Page 1', 'Page 2'])
    expect(await pageTexts(await reorderPages(await makePdf(4), '4-1'))).toEqual(['Page 4', 'Page 3', 'Page 2', 'Page 1'])
    expect(await pageTexts(await reorderPages(await makePdf(5), '2,1,3-'))).toEqual(['Page 2', 'Page 1', 'Page 3', 'Page 4', 'Page 5'])
  })

  it('refuses an order that would drop or duplicate pages', async () => {
    await expect(reorderPages(await makePdf(6), '2,1')).rejects.toThrow('The order leaves out pages 3–6 — list every page once (ranges like 3-6 work).')
    await expect(reorderPages(await makePdf(3), '1,2,3,2')).rejects.toThrow(/Page 2 appears more than once/)
    await expect(reorderPages(await makePdf(3), '3,1,4')).rejects.toThrow(/Page 4 is out of range/)
  })
})

describe('Compress PDF', () => {
  it('leaves page boxes alone (it used to reset them, shifting and uncropping content)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([400, 400])
    page.setMediaBox(100, 100, 300, 300)
    page.setCropBox(150, 150, 100, 100)
    const out = (await PDFDocument.load(await compressPdf(await doc.save()))).getPage(0)
    expect(out.getMediaBox()).toEqual({ x: 100, y: 100, width: 300, height: 300 })
    expect(out.getCropBox()).toEqual({ x: 150, y: 150, width: 100, height: 100 })
  })

  it('shrinks a file written without object streams, keeping text and metadata', async () => {
    const doc = await PDFDocument.load(await makePdf(50, { title: 'Keep me' }))
    const loose = await doc.save({ useObjectStreams: false })
    const out = await compressPdf(loose)
    expect(out.length).toBeLessThan(loose.length)
    expect((await pageTexts(out))[49]).toBe('Page 50')
    expect((await PDFDocument.load(out)).getTitle()).toBe('Keep me')
  })
})

/** Where pdf.js shows each text item: viewer coordinates (y down) and whether it reads left-to-right. */
async function placedText(bytes: Uint8Array, pageIndex = 0) {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  const page = await doc.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const out = content.items.flatMap((item) => {
    if (!('str' in item) || !item.str.trim()) return []
    const [a, b, , , e, f] = item.transform
    const [x, y] = viewport.convertToViewportPoint(e, f)
    const [x2, y2] = viewport.convertToViewportPoint(e + (a / Math.hypot(a, b)) * item.width, f + (b / Math.hypot(a, b)) * item.width)
    return [{ str: item.str, x, y, endX: x2, size: Math.hypot(a, b), upright: Math.abs(y2 - y) < 0.01 && x2 > x, viewW: viewport.width, viewH: viewport.height }]
  })
  await task.destroy()
  return out
}

describe('Page Numbers', () => {
  const opts = (over: Partial<Parameters<typeof addPageNumbers>[1]> = {}) => ({ position: 'bottom-center' as Corner, style: 'numeric' as const, prefix: '', startFrom: 1, ...over })

  it('roman numerals keep counting past x', async () => {
    expect([1, 4, 9, 11, 14, 40, 90, 400, 1994, 3999].map(toRoman)).toEqual(['i', 'iv', 'ix', 'xi', 'xiv', 'xl', 'xc', 'cd', 'mcmxciv', 'mmmcmxcix'])
    const texts = await pageTexts(await addPageNumbers(await makePdf(12), opts({ style: 'roman' })))
    expect(texts.map((t) => t.replace(/^Page \d+/, ''))).toEqual(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'])
  })

  it('starts from the chosen number, with a custom prefix', async () => {
    const texts = await pageTexts(await addPageNumbers(await makePdf(2), opts({ style: 'custom', prefix: 'Seite ', startFrom: 5 })))
    expect(texts.map((t) => t.replace(/^Page \d+/, ''))).toEqual(['Seite 5', 'Seite 6'])
  })

  it.each([0, 90, 180, 270])('sits upright at the bottom centre of a page rotated %i°', async (rotate) => {
    const out = await addPageNumbers(await makePdf([{ size: [300, 500], rotate }]), opts())
    const label = (await placedText(out)).find((t) => t.str === '1')!
    expect(label.upright).toBe(true)
    expect((label.x + label.endX) / 2).toBeCloseTo(label.viewW / 2, 0)
    expect(label.y).toBeCloseTo(label.viewH - 40, 0)
  })

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('%s keeps a 40pt margin, right-aligned on the right', async (position) => {
    const out = await addPageNumbers(await makePdf([{ size: [300, 500], rotate: 90 }]), opts({ position, style: 'custom', prefix: 'Page ', startFrom: 100 }))
    const label = (await placedText(out)).find((t) => t.str === 'Page 100')!
    expect(label.upright).toBe(true)
    if (position.endsWith('left')) expect(label.x).toBeCloseTo(40, 0)
    else expect(label.endX).toBeCloseTo(label.viewW - 40, 0)
    expect(label.y).toBeCloseTo(position.startsWith('top') ? 40 : label.viewH - 40, 0)
  })

  it('places numbers inside the visible crop box', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    page.setCropBox(100, 100, 300, 400)
    const label = (await placedText(await addPageNumbers(await doc.save(), opts())))[0]
    expect(label.viewW).toBe(300)
    expect((label.x + label.endX) / 2).toBeCloseTo(150, 0)
    expect(label.y).toBeCloseTo(360, 0)
  })

  it('reports characters the standard font cannot draw', async () => {
    const run = addPageNumbers(await makePdf(1), opts({ style: 'custom', prefix: '页 ' }))
    await expect(run.catch((e) => describeError(e))).resolves.toMatch(/Latin-1/)
  })
})

describe('Watermark', () => {
  it('draws the text on every page at the chosen opacity', async () => {
    const out = await addWatermark(await makePdf(3), { text: 'DRAFT', opacity: 0.3, position: 'center' })
    expect((await pageTexts(out)).every((t) => t.includes('DRAFT'))).toBe(true)
    const doc = await PDFDocument.load(out)
    const gs = doc.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'))!.toString()
    expect(gs).toMatch(/\/ca 0\.3/)
  })

  it.each([90, 270])('stays upright and centred on a page rotated %i°', async (rotate) => {
    const out = await addWatermark(await makePdf([{ size: [300, 500], rotate }]), { text: 'DRAFT', opacity: 0.5, position: 'center' })
    const mark = (await placedText(out)).find((t) => t.str === 'DRAFT')!
    expect(mark.upright).toBe(true)
    expect((mark.x + mark.endX) / 2).toBeCloseTo(mark.viewW / 2, 0)
  })

  it('centres the text itself, not its baseline, on the page', async () => {
    const out = await addWatermark(await makePdf([{ size: [300, 500] }]), { text: 'DRAFT', opacity: 0.5, position: 'center' })
    const mark = (await placedText(out)).find((t) => t.str === 'DRAFT')!
    // Helvetica-Bold capitals stand 0.718 em above the baseline
    expect(mark.y - (mark.size * 0.718) / 2).toBeCloseTo(mark.viewH / 2, 0)
  })

  it.each(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('shrinks long text to fit the page (%s)', async (position) => {
    const text = 'CONFIDENTIAL — DO NOT DISTRIBUTE OUTSIDE THE COMPANY'
    const out = await addWatermark(await makePdf([{ size: [300, 400] }]), { text, opacity: 0.5, position })
    const mark = (await placedText(out)).find((t) => t.str === text)!
    // inside the 40pt margins (pdf.js measures with its own copy of the metrics: 2pt slack)
    expect(mark.x).toBeGreaterThanOrEqual(38)
    expect(mark.endX).toBeLessThanOrEqual(mark.viewW - 38)
    // short text keeps the usual size
    const short = (await placedText(await addWatermark(await makePdf([{ size: [300, 400] }]), { text: 'X', opacity: 0.5, position }))).find((t) => t.str === 'X')!
    expect(short.size).toBeCloseTo(30, 0)
  })

  it('tiles across the visible page', async () => {
    const out = await addWatermark(await makePdf([{ size: [600, 400], rotate: 90 }]), { text: 'X', opacity: 0.3, position: 'tile' })
    const marks = (await placedText(out)).filter((t) => t.str === 'X')
    expect(marks.length).toBeGreaterThan(10)
    expect(marks.every((m) => m.upright && m.x >= 0 && m.x < m.viewW && m.y > 0 && m.y <= m.viewH)).toBe(true)
  })

  it('refuses empty text and reports unsupported characters', async () => {
    await expect(addWatermark(await makePdf(1), { text: '  ', opacity: 0.3, position: 'center' })).rejects.toThrow(/Enter the watermark text/)
    const run = addWatermark(await makePdf(1), { text: '草稿', opacity: 0.3, position: 'center' })
    await expect(run.catch((e) => describeError(e))).resolves.toMatch(/Latin-1/)
  })
})

describe('Protect PDF / Unlock PDF (see lib/crypt for the cipher suites)', () => {
  it('protects with a password that unlock then removes', async () => {
    const out = await protectPdf(await makeRichPdf(), 'hunter2')
    await expect(loadPdf(out)).rejects.toThrow(ENCRYPTED_MESSAGE)
    const back = await PDFDocument.load((await unlockPdf(out, 'hunter2')).bytes)
    expect(back.getTitle()).toBe('Rich fixture')
    expect(back.getForm().getTextField('name').getText()).toBe('Ada')
  })

  it('needs a password, a PDF, and an encrypted PDF', async () => {
    await expect(protectPdf(await makePdf(1), '')).rejects.toThrow(/Enter a password/)
    await expect(unlockPdf(new Uint8Array([1, 2, 3]), 'x')).rejects.toThrow(/not a PDF/)
    await expect(unlockPdf(await makePdf(1), 'x')).rejects.toThrow(/not password-protected/)
    await expect(unlockPdf(fixture('aes-128.pdf'), 'x')).rejects.toThrow('Wrong password for this PDF.')
  })
})

function png(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  const chunk = (type: string, data: Uint8Array) => {
    const body = concatBytes(ascii(type), data)
    return concatBytes(u32(data.length), body, u32(crc(body)))
  }
  const ihdr = concatBytes(u32(w), u32(h), new Uint8Array([8, 2, 0, 0, 0]))
  const raw = new Uint8Array((w * 3 + 1) * h)
  return concatBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array(0)))
}

function jpg(w: number, h: number, orientation?: number): Uint8Array {
  const plain = new Uint8Array(jpeg.encode({ data: new Uint8Array(w * h * 4).fill(128), width: w, height: h }, 80).data)
  if (!orientation) return plain
  // APP1 "Exif\0\0" + big-endian TIFF with one IFD0 entry: Orientation (0x0112), SHORT, 1
  const tiff = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0])
  const body = concatBytes(ascii('Exif\0\0'), tiff)
  const app1 = concatBytes(new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body)
  return concatBytes(plain.subarray(0, 2), app1, plain.subarray(2))
}

async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const contents = doc.getPage(0).node.Contents()!
  const stream = (contents instanceof PDFRawStream ? contents : doc.context.lookup((contents as unknown as { get: (i: number) => never }).get(0))) as PDFRawStream
  return latin1(decodePDFRawStream(stream).decode())
}

describe('Image to PDF', () => {
  it('makes one page per image, sized to it', async () => {
    const out = await imagesToPdf([named('a.png', png(40, 30)), named('b.jpg', jpg(20, 50))])
    expect(await pageInfo(out)).toEqual([{ width: 40, height: 30, rotate: 0 }, { width: 20, height: 50, rotate: 0 }])
    const doc = await PDFDocument.load(out)
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'))!.toString()
    expect(xobjects).toMatch(/Image/)
  })

  it('identifies images by their bytes, not their file type', () => {
    expect([imageKind(png(1, 1)), imageKind(jpg(1, 1)), imageKind(new TextEncoder().encode('RIFF....WEBP'))]).toEqual(['png', 'jpeg', 'other'])
  })

  it('converts other formats (WebP) through the browser instead of failing on them', async () => {
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8L')
    await expect(imagesToPdf([named('photo.webp', webp)])).rejects.toThrow('photo.webp is not a PNG or JPEG image.')
    const out = await imagesToPdf([named('photo.webp', webp)], async () => png(7, 9))
    expect(await pageInfo(out)).toEqual([{ width: 7, height: 9, rotate: 0 }])
  })

  it('reports a damaged image by name', async () => {
    const broken = png(10, 10).subarray(0, 40)
    await expect(imagesToPdf([named('scan 📷.png', broken)])).rejects.toThrow(/scan 📷\.png could not be read/)
  })

  it('reads the EXIF orientation of a JPEG', () => {
    expect(jpegOrientation(jpg(4, 4))).toBe(1)
    for (const o of [1, 3, 6, 8, 2, 5]) expect(jpegOrientation(jpg(4, 4, o))).toBe(o)
  })

  it('turns phone photos upright (EXIF 6 = rotate 90° clockwise)', async () => {
    const out = await imagesToPdf([named('portrait.jpg', jpg(60, 20, 6))])
    expect(await pageInfo(out)).toEqual([{ width: 20, height: 60, rotate: 0 }])
    expect(await pageContent(out)).toMatch(/0 -60 20 0 0 60 cm/)
  })

  it('maps every EXIF orientation onto the page the right way round', () => {
    // where the stored image's top-left corner must land (page coordinates, y up)
    const w = 60, h = 20
    const topLeft = (o: number) => {
      const [a, b, c, d, e, f] = orientationMatrix(o, w, h)
      return [a * 0 + c * 1 + e, b * 0 + d * 1 + f] // image space (0,1) is the stored top-left
    }
    const W = (o: number) => (o >= 5 ? h : w)
    const H = (o: number) => (o >= 5 ? w : h)
    expect(topLeft(1)).toEqual([0, H(1)]) // stays top-left
    expect(topLeft(2)).toEqual([W(2), H(2)]) // mirrored: top-right
    expect(topLeft(3)).toEqual([W(3), 0]) // 180°: bottom-right
    expect(topLeft(4)).toEqual([0, 0]) // flipped: bottom-left
    expect(topLeft(5)).toEqual([0, H(5)]) // transposed: top-left
    expect(topLeft(6)).toEqual([W(6), H(6)]) // 90° clockwise: top-right
    expect(topLeft(7)).toEqual([W(7), 0]) // transverse: bottom-right
    expect(topLeft(8)).toEqual([0, 0]) // 90° anticlockwise: bottom-left
  })
})

describe('PDF to Text', () => {
  it('keeps line breaks and does not split words that pdf.js returns in pieces', async () => {
    expect(joinTextItems([{ str: 'Hel' }, { str: 'lo', hasEOL: false }, { str: ' ' }, { str: 'world', hasEOL: true }, { str: 'next' }])).toBe('Hello world\nnext')
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([300, 300])
    page.drawText('First line\nSecond line', { x: 20, y: 250, size: 12, font, lineHeight: 16 })
    page.drawText('Hel', { x: 20, y: 150, size: 12, font })
    page.drawText('lo', { x: 20 + font.widthOfTextAtSize('Hel', 12), y: 150, size: 12, font })
    const [text] = await extractText(await nodePdfJs(), await doc.save())
    expect(text).toBe('First line\nSecond line\nHello')
  })

  it('returns an empty string for a page without text', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    expect(await extractText(await nodePdfJs(), await doc.save())).toEqual([''])
  })

  it('reads owner-only files, and explains password-protected and non-PDF input', async () => {
    const pdfjs = await nodePdfJs()
    expect(await extractText(pdfjs, fixture('rc4-128-owner-only.pdf'))).toEqual(['Hello page 1', 'Hello page 2', 'Hello page 3'])
    await expect(extractText(pdfjs, fixture('aes-128.pdf'))).rejects.toThrow(ENCRYPTED_MESSAGE)
    await expect(extractText(pdfjs, new TextEncoder().encode('hello'))).rejects.toThrow(/not a PDF/)
    await expect(extractText(pdfjs, (await makePdf(2)).subarray(0, 200))).rejects.toBeInstanceOf(PdfInputError)
  })
})

describe('PDF to Image render scale', () => {
  it('renders at 2× and stays inside browser canvas limits for huge pages', () => {
    expect(renderScale(612, 792)).toBe(2)
    for (const [w, h] of [[14400, 14400], [2384, 3370], [200, 14400]]) {
      const s = renderScale(w, h)
      expect(w * s).toBeLessThanOrEqual(8192)
      expect(h * s).toBeLessThanOrEqual(8192)
      expect(w * s * h * s).toBeLessThanOrEqual(16_000_000)
    }
  })
})

describe('Rotate PDF with an out-of-range /Rotate', () => {
  it('normalises 450° rather than writing 540°', async () => {
    const doc = await PDFDocument.load(await makePdf(1))
    doc.getPage(0).node.set(PDFName.of('Rotate'), doc.context.obj(450))
    expect((await pageInfo(await rotatePdf(await doc.save(), 90))).map((p) => p.rotate)).toEqual([180])
  })
})
