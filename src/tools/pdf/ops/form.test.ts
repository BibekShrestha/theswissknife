import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib'
import { Encodings } from '@pdf-lib/standard-fonts'
import { fixture, nodePdfJs, pageTexts } from '../test/helpers'
import { makeFormPdf, makePairedChoicePdf, makeXfaOnlyPdf, RED_PIXEL_PNG } from '../test/forms'
import { latin1 } from '../test/node'
import { PdfInputError } from '../lib/errors'
import { describeChars, encodingProblem, unencodable, winAnsiCodePoint } from '../lib/winansi'
import { runJob } from '../jobs'
import { appearanceMatrix, fillAndSign, readForm, type FieldValue, type FillSignOptions, type Stamp } from './form'

const none: FillSignOptions = { values: {}, flatten: false, stamps: [], images: [] }
const fill = (bytes: Uint8Array, values: Record<string, FieldValue>, more: Partial<FillSignOptions> = {}) =>
  fillAndSign(bytes, { ...none, values, ...more })

const VALUES: Record<string, FieldValue> = {
  name: 'Ada Lovelace',
  notes: 'Line one\nLine two',
  zip: '12345',
  code: 'ABC-123',
  email: 'ada@example.org',
  agree: true,
  color: 'green',
  country: ['Peru'],
  langs: ['Go', 'Rust'],
  city: 'Zürich',
}

/** pdf.js's view of the form: each widget's field name → its value, as a viewer reads it back. */
async function pdfjsFields(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  try {
    const out: Record<string, unknown> = {}
    for (let i = 1; i <= doc.numPages; i++) {
      for (const a of (await (await doc.getPage(i)).getAnnotations()) as { subtype: string; fieldName: string; fieldValue: unknown }[]) {
        if (a.subtype === 'Widget' && !(a.fieldName in out)) out[a.fieldName] = a.fieldValue
      }
    }
    return out
  } finally {
    await task.destroy()
  }
}

/** pdf.js's form objects (what its scripting sees), or null when the file has no form. */
async function pdfjsFieldObjects(bytes: Uint8Array): Promise<unknown> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  try {
    return await (await task.promise).getFieldObjects()
  } finally {
    await task.destroy()
  }
}

/** Widget annotations per page, as pdf.js sees them. */
async function pdfjsWidgets(bytes: Uint8Array): Promise<number[]> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  try {
    const counts: number[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const annots = await (await doc.getPage(i)).getAnnotations()
      counts.push(annots.filter((a: { subtype?: string }) => a.subtype === 'Widget').length)
    }
    return counts
  } finally {
    await task.destroy()
  }
}

/** The operators pdf.js runs for each page (what it draws), to compare pages that must not change. */
async function operatorLists(bytes: Uint8Array): Promise<number[][]> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  try {
    const out: number[][] = []
    for (let i = 1; i <= doc.numPages; i++) out.push([...(await (await doc.getPage(i)).getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE })).fnArray])
    return out
  } finally {
    await task.destroy()
  }
}

/** Text items with their positions on the page as displayed (rotation applied, origin top-left). */
async function placedText(bytes: Uint8Array, pageNo: number): Promise<{ str: string; x: number; y: number }[]> {
  const pdfjs = await nodePdfJs()
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
  const doc = await task.promise
  try {
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    return content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && item.str.trim() !== '')
      .map((item) => {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
        return { str: item.str, x, y }
      })
  } finally {
    await task.destroy()
  }
}

const decode = (stream: PDFStream) => latin1(stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents())

/** The strings a content stream shows with Tj/TJ (hex or literal), decoded as Windows-1252 bytes would be by Helvetica. */
function shownText(content: string): string {
  const out: string[] = []
  for (const [, hex, literal] of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    if (hex !== undefined) out.push(String.fromCharCode(...(hex.match(/../g) ?? []).map((h) => parseInt(h, 16))))
    else out.push(literal.replace(/\\(.)/g, '$1'))
  }
  return out.join('\n')
}

async function appearanceText(bytes: Uint8Array, field: string): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const widget = doc.getForm().getField(field).acroField.getWidgets()[0]
  const normal = doc.context.lookup(widget.getNormalAppearance())
  if (!(normal instanceof PDFStream)) throw new Error(`${field} has no appearance stream`)
  return shownText(decode(normal))
}

describe('readForm', () => {
  it('lists every field with its kind, flags and widget positions', async () => {
    const report = await readForm(await makeFormPdf())
    expect(report.xfa).toBe('none')
    expect(report.pageCount).toBe(3)
    expect(report.signed).toBe(0)
    const by = Object.fromEntries(report.fields.map((f) => [f.name, f]))
    expect(Object.keys(by)).toEqual(['name', 'notes', 'zip', 'code', 'locked', 'email', 'agree', 'color', 'country', 'langs', 'city'])
    expect(by.name).toMatchObject({ kind: 'text', value: '', multiline: false, readOnly: false, required: false, comb: false })
    expect(by.notes).toMatchObject({ kind: 'text', multiline: true })
    expect(by.zip).toMatchObject({ kind: 'text', maxLength: 5, comb: true })
    expect(by.code).toMatchObject({ kind: 'text', maxLength: 8, comb: false })
    expect(by.locked).toMatchObject({ kind: 'text', value: 'Fixed', readOnly: true })
    expect(by.email).toMatchObject({ kind: 'text', required: true })
    expect(by.agree).toMatchObject({ kind: 'checkbox', checked: false })
    expect(by.color).toMatchObject({ kind: 'radio', options: ['red', 'green', 'blue'], selected: [] })
    expect(by.color.widgets.map((w) => w.option)).toEqual(['red', 'green', 'blue'])
    expect(by.country).toMatchObject({ kind: 'dropdown', options: ['Nepal', 'Norway', 'Peru'], selected: [], editable: false })
    expect(by.langs).toMatchObject({ kind: 'listbox', options: ['C', 'Go', 'Rust', 'TypeScript'], multiSelect: true })
    // pdf-lib grows each widget by half its border width
    expect(by.name.widgets).toEqual([{ page: 0, rect: [19.5, 519.5, 220.5, 540.5] }])
    expect(by.city.widgets).toEqual([{ page: 1, rect: [19.5, 519.5, 220.5, 540.5] }])
  })

  it('refuses encrypted input, owner-password-only files included (Unlock PDF removes the protection)', async () => {
    for (const file of ['aes-128.pdf', 'rc4-128-owner-only.pdf']) {
      await expect(readForm(fixture(file))).rejects.toThrow(/password-protected or encrypted.*Unlock PDF/)
      await expect(fillAndSign(fixture(file), none)).rejects.toThrow(/password-protected or encrypted.*Unlock PDF/)
    }
  })

  it('reports a PDF without a form as having no fields, and leaves it without one', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const bytes = await doc.save()
    expect((await readForm(bytes)).fields).toEqual([])
    const { bytes: out } = await fillAndSign(bytes, none)
    expect((await PDFDocument.load(out)).catalog.has(PDFName.of('AcroForm'))).toBe(false)
  })
})

describe('filling fields', () => {
  it('round-trips every value through pdf.js', async () => {
    const { bytes, notes } = await fill(await makeFormPdf(), VALUES)
    expect(notes).toEqual([])
    const read = await pdfjsFields(bytes)
    expect(read).toMatchObject({
      name: 'Ada Lovelace',
      notes: 'Line one\nLine two',
      zip: '12345',
      code: 'ABC-123',
      locked: 'Fixed',
      email: 'ada@example.org',
      color: 'green',
      agree: 'Yes',
      country: ['Peru'],
      langs: ['Go', 'Rust'],
      city: 'Zürich',
    })
    // and our own reader agrees
    const by = Object.fromEntries((await readForm(bytes)).fields.map((f) => [f.name, f]))
    expect(by.agree.checked).toBe(true)
    expect(by.color.selected).toEqual(['green'])
    expect(by.langs.selected).toEqual(['Go', 'Rust'])
  })

  it('draws an appearance stream for each changed field, so viewers need not redraw', async () => {
    const { bytes } = await fill(await makeFormPdf(), VALUES)
    expect(await appearanceText(bytes, 'name')).toBe('Ada Lovelace')
    expect(await appearanceText(bytes, 'city')).toBe('Zürich')
    expect((await appearanceText(bytes, 'notes')).split('\n')).toEqual(['Line one', 'Line two'])
    // a comb field draws one character per cell
    expect((await appearanceText(bytes, 'zip')).split('\n')).toEqual(['1', '2', '3', '4', '5'])
    expect(await appearanceText(bytes, 'country')).toBe('Peru')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getForm().acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
    // the checkbox's widget is switched to its on state, which has an appearance
    const agree = doc.getForm().getCheckBox('agree').acroField.getWidgets()[0]
    const state = agree.getAppearanceState()!
    expect(state.decodeText()).toBe('Yes')
    expect((doc.context.lookup(agree.getNormalAppearance()) as PDFDict).has(state)).toBe(true)
  })

  it('clears values and leaves untouched fields as they were', async () => {
    const filled = (await fill(await makeFormPdf(), VALUES)).bytes
    const { bytes } = await fill(filled, { name: '', agree: false, color: '', langs: [] })
    const read = await pdfjsFields(bytes)
    expect(read.name).toBe('')
    expect(read.agree).toBe('Off')
    expect(read.color).toBe('Off')
    expect(read.city).toBe('Zürich')
    expect(read.zip).toBe('12345')
  })

  it('removes NeedAppearances once every field is drawn, and says so', async () => {
    const { bytes, notes } = await fill(await makeFormPdf({ needAppearances: true }), { name: 'Ada' })
    expect((await PDFDocument.load(bytes)).getForm().acroForm.dict.has(PDFName.of('NeedAppearances'))).toBe(false)
    expect(notes.join(' ')).toMatch(/NeedAppearances.*removed/)
    expect(await appearanceText(bytes, 'city')).toBe('')
  })

  it('writes the export value of an [export, label] option and reads it back as the label', async () => {
    const input = await makePairedChoicePdf()
    expect((await readForm(input)).fields[0]).toMatchObject({ options: ['Small', 'Large'] })
    const { bytes } = await fill(input, { size: ['Large'] })
    expect((await pdfjsFields(bytes)).size).toEqual(['L'])
    expect(await appearanceText(bytes, 'size')).toBe('Large')
    expect((await readForm(bytes)).fields[0].selected).toEqual(['Large'])
  })

  it.each<[string, Record<string, FieldValue>, RegExp]>([
    ['non-Latin text', { name: '山田 太郎' }, /“山”, “田”.*can’t be written.*Windows-1252/],
    ['an emoji', { city: 'Paris 🗼' }, /“🗼” can’t be written/],
    ['too many characters', { code: '123456789' }, /“code”: at most 8 characters/],
    ['a read-only field', { locked: 'Changed' }, /“locked”: the field is read-only/],
    ['an unknown radio option', { color: 'purple' }, /“purple” is not one of its options/],
    ['free text in a fixed dropdown', { country: ['Atlantis'] }, /“Atlantis” is not one of its options/],
    ['two choices in a single-choice field', { country: ['Peru', 'Nepal'] }, /only one option/],
    ['a field that is not there', { nope: 'x' }, /no field called “nope”/],
    ['the wrong kind of value', { agree: 'yes' }, /expected checked or unchecked/],
  ])('refuses %s with a message naming the problem', async (_, values, message) => {
    const run = fill(await makeFormPdf(), values)
    await expect(run).rejects.toBeInstanceOf(PdfInputError)
    await expect(run).rejects.toThrow(message)
  })

  it('folds line breaks into spaces in a single-line field', async () => {
    const { bytes } = await fill(await makeFormPdf(), { name: 'Ada\nLovelace' })
    expect((await pdfjsFields(bytes)).name).toBe('Ada Lovelace')
  })
})

describe('flatten', () => {
  it('bakes the values into the pages and leaves no form behind', async () => {
    const input = await makeFormPdf()
    const { bytes } = await fill(input, VALUES, { flatten: true })
    expect(await pdfjsFieldObjects(bytes)).toBeNull()
    expect(await pdfjsWidgets(bytes)).toEqual([0, 0, 0])
    const doc = await PDFDocument.load(bytes)
    expect(doc.catalog.has(PDFName.of('AcroForm'))).toBe(false)
    expect(doc.getPageCount()).toBe(3)
    const texts = await pageTexts(bytes)
    for (const value of ['Ada Lovelace', 'Line one', 'Line two', 'ABC-123', 'Fixed', 'ada@example.org', 'Peru']) expect(texts[0]).toContain(value)
    expect(texts[0]).toMatch(/1\s*2\s*3\s*4\s*5/)
    expect(texts[1]).toContain('Zürich')
    // the page without fields draws exactly what it did
    expect(texts[2]).toBe((await pageTexts(input))[2])
    expect((await operatorLists(bytes))[2]).toEqual((await operatorLists(input))[2])
  })

  it('places each value where its field was', async () => {
    const { bytes } = await fill(await makeFormPdf(), { name: 'Ada', city: 'Bern' }, { flatten: true })
    const name = (await placedText(bytes, 1)).find((t) => t.str === 'Ada')!
    // the widget spans x 20–220 and y 520–540 in a 600-pt page: 60–80 from the top
    expect(name.x).toBeGreaterThanOrEqual(20)
    expect(name.x).toBeLessThan(30)
    expect(name.y).toBeGreaterThan(60)
    expect(name.y).toBeLessThan(80)
  })

  it('handles a checkbox with no Off appearance and drops hidden widgets', async () => {
    const input = await makeFormPdf()
    const doc = await PDFDocument.load(input)
    const form = doc.getForm()
    ;(doc.context.lookup(form.getCheckBox('agree').acroField.getWidgets()[0].getNormalAppearance()) as PDFDict).delete(PDFName.of('Off'))
    const city = form.getTextField('city')
    city.setText('Hidden value')
    city.acroField.getWidgets()[0].setFlags(2)
    const { bytes, notes } = await fill(await doc.save(), {}, { flatten: true })
    expect(notes).toEqual([])
    expect((await pageTexts(bytes))[1]).not.toContain('Hidden value')
    expect(await pdfjsFieldObjects(bytes)).toBeNull()
  })
})

describe('XFA', () => {
  it('fills the AcroForm side of a hybrid form and drops the XFA, saying so', async () => {
    const input = await makeFormPdf({ xfa: true })
    const report = await readForm(input)
    expect(report.xfa).toBe('hybrid')
    expect(report.fields).toHaveLength(11)
    const { bytes, notes } = await fill(input, { name: 'Ada' })
    expect(notes.join(' ')).toMatch(/XFA copy of its form\. It was removed/)
    expect((await PDFDocument.load(bytes)).getForm().acroForm.dict.has(PDFName.of('XFA'))).toBe(false)
    expect((await pdfjsFields(bytes)).name).toBe('Ada')
  })

  it.each([false, true])('detects an XFA-only form (dynamic: %s) and refuses to fill or stamp it', async (dynamic) => {
    const input = await makeXfaOnlyPdf(dynamic)
    expect(await readForm(input)).toMatchObject({ xfa: 'only', fields: [] })
    await expect(fillAndSign(input, none)).rejects.toThrow(/XFA form .* Adobe Acrobat or Reader/)
  })
})

describe('stamps', () => {
  const view = { width: 400, height: 600 }

  it('stamps a signature image into page content, leaving the other pages and the page count alone', async () => {
    const input = await makeFormPdf()
    const stamps: Stamp[] = [{ kind: 'image', image: 0, page: 1, x: 50, y: 100, width: 120, height: 40, view }]
    const { bytes } = await fillAndSign(input, { ...none, stamps, images: [RED_PIXEL_PNG] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(3)
    const xobjects = doc.getPage(1).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const images = xobjects.keys().map((k) => xobjects.lookup(k)).filter((x) => x instanceof PDFStream && x.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    expect(images).toHaveLength(1)
    // not an annotation: nothing new in /Annots
    expect(await pdfjsWidgets(bytes)).toEqual(await pdfjsWidgets(input))
    expect((await PDFDocument.load(bytes)).getPage(1).node.Annots()?.size()).toBe((await PDFDocument.load(input)).getPage(1).node.Annots()?.size())
    const [before, after] = [await operatorLists(input), await operatorLists(bytes)]
    expect(after[0]).toEqual(before[0])
    expect(after[2]).toEqual(before[2])
    expect(after[1]).not.toEqual(before[1])
    // the field on the stamped page still works
    expect(await pdfjsFields(bytes)).toMatchObject({ city: '' })
  })

  it('embeds one image once however often it is placed', async () => {
    const stamps: Stamp[] = [0, 1, 2].map((page) => ({ kind: 'image', image: 0, page, x: 10, y: 10, width: 50, height: 20, view }))
    const { bytes } = await fillAndSign(await makeFormPdf(), { ...none, stamps, images: [RED_PIXEL_PNG] })
    const doc = await PDFDocument.load(bytes)
    const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
    expect(images).toHaveLength(1)
  })

  it('writes a text box and a date where they were placed, on a rotated page too', async () => {
    for (const rotate of [0, 90, 180, 270]) {
      const input = await makeFormPdf({ rotatePage2: rotate })
      const pageView = rotate % 180 ? { width: 600, height: 400 } : view
      const stamps: Stamp[] = [
        { kind: 'text', text: 'Signed in Bern', fontSize: 12, page: 1, x: 50, y: 100, width: 90, height: 14, view: pageView },
        { kind: 'text', text: '2026-10-19', fontSize: 10, page: 1, x: 200, y: 300, width: 60, height: 12, view: pageView },
      ]
      const { bytes } = await fillAndSign(input, { ...none, stamps })
      const items = await placedText(bytes, 2)
      const signed = items.find((t) => t.str === 'Signed in Bern')
      const date = items.find((t) => t.str === '2026-10-19')
      expect(signed, `rotation ${rotate}`).toBeDefined()
      expect(signed!.x).toBeCloseTo(50, 0)
      expect(signed!.y).toBeCloseTo(100 + 12 * 0.9, 0)
      expect(date!.x).toBeCloseTo(200, 0)
      expect(date!.y).toBeCloseTo(300 + 10 * 0.9, 0)
    }
  })

  it('draws a checkmark as a filled path, and multi-line text boxes line by line', async () => {
    const input = await makeFormPdf()
    const stamps: Stamp[] = [
      { kind: 'check', page: 2, x: 30, y: 30, width: 20, height: 20, view },
      { kind: 'text', text: 'First line\nSecond line', fontSize: 10, page: 2, x: 30, y: 80, width: 80, height: 24, view },
    ]
    const { bytes } = await fillAndSign(input, { ...none, stamps })
    const pdfjs = await nodePdfJs()
    const after = (await operatorLists(bytes))[2]
    expect(after).toContain(pdfjs.OPS.constructPath)
    const lines = (await placedText(bytes, 3)).filter((t) => t.str.endsWith('line'))
    expect(lines.map((l) => l.str)).toEqual(['First line', 'Second line'])
    expect(lines[1].y - lines[0].y).toBeCloseTo(12, 0)
  })

  it('stamps and flattens in one pass, stamps on top', async () => {
    const stamps: Stamp[] = [{ kind: 'text', text: 'Approved', fontSize: 14, page: 0, x: 220, y: 60, width: 70, height: 17, view }]
    const { bytes } = await fill(await makeFormPdf(), { name: 'Ada' }, { flatten: true, stamps })
    const text = (await pageTexts(bytes))[0]
    expect(text).toContain('Ada')
    expect(text).toContain('Approved')
    expect(text.indexOf('Approved')).toBeGreaterThan(text.indexOf('Ada'))
  })

  it.each<[string, Stamp, RegExp]>([
    ['a page that is not there', { kind: 'check', page: 9, x: 0, y: 0, width: 10, height: 10, view }, /page this PDF doesn’t have/],
    ['a zero size', { kind: 'check', page: 0, x: 0, y: 0, width: 0, height: 10, view }, /impossible size/],
    ['non-Latin text', { kind: 'text', text: 'Подпись', fontSize: 12, page: 0, x: 0, y: 0, width: 10, height: 10, view }, /can’t be written/],
    ['a missing image', { kind: 'image', image: 3, page: 0, x: 0, y: 0, width: 10, height: 10, view }, /no image/],
  ])('refuses %s', async (_, stamp, message) => {
    await expect(fillAndSign(await makeFormPdf(), { ...none, stamps: [stamp] })).rejects.toThrow(message)
  })
})

describe('the worker jobs', () => {
  it('runs read-form and fill-sign through runJob', async () => {
    const input = await makeFormPdf()
    const report = await runJob('read-form', { bytes: input.slice() })
    expect(report.fields).toHaveLength(11)
    const { bytes } = await runJob('fill-sign', { bytes: input.slice(), options: { ...none, values: { name: 'Ada' } } })
    expect((await pdfjsFields(bytes)).name).toBe('Ada')
  })
})

describe('appearanceMatrix', () => {
  it('maps the BBox onto the widget rectangle', () => {
    expect(appearanceMatrix([0, 0, 100, 20], [1, 0, 0, 1, 0, 0], [50, 500, 150, 520])).toEqual([1, 0, 0, 1, 50, 500])
    // a BBox not at the origin, at twice the size
    expect(appearanceMatrix([10, 10, 210, 50], [1, 0, 0, 1, 0, 0], [0, 0, 100, 20])).toEqual([0.5, 0, 0, 0.5, -5, -5])
    // a /Matrix that turns the box a quarter (a widget with /MK /R 90): the turned box is 20 wide, 100 tall
    const m = appearanceMatrix([0, 0, 100, 20], [0, 1, -1, 0, 20, 0], [0, 0, 20, 100])!
    expect(m.map((n) => Math.round(n * 1000) / 1000)).toEqual([1, 0, 0, 1, 0, 0])
    expect(appearanceMatrix([0, 0, 0, 20], [1, 0, 0, 1, 0, 0], [0, 0, 10, 10])).toBeUndefined()
  })
})

describe('WinAnsi', () => {
  it('matches pdf-lib’s own encoding table for every BMP code point', () => {
    const mismatches: number[] = []
    for (let cp = 0; cp <= 0xffff; cp++) {
      if (winAnsiCodePoint(cp) !== Encodings.WinAnsi.canEncodeUnicodeCodePoint(cp) && cp >= 0x20) mismatches.push(cp)
    }
    expect(mismatches).toEqual([])
    // below 0x20 pdf-lib maps a few control codes the fonts have no glyph for; we refuse them
    expect(winAnsiCodePoint(0x09)).toBe(false)
  })

  it('names the characters it refuses', () => {
    expect(unencodable('Café — “ok” €5')).toEqual([])
    expect(unencodable('a\nb')).toEqual(['\n'])
    expect(unencodable('a\nb', true)).toEqual([])
    expect(unencodable('日本日本')).toEqual(['日', '本'])
    expect(describeChars(['\t'])).toBe('tab')
    expect(describeChars(['日', '本', '‏'])).toBe('“日”, “本” and U+200F')
    expect(describeChars(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('“a”, “b”, “c”, “d”, “e” and 2 more')
    expect(encodingProblem('Zürich')).toBe('')
    expect(encodingProblem('Ωmega')).toMatch(/^“Ω” can’t be written/)
  })
})
