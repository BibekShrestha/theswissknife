/**
 * Synthetic AcroForm fixtures for Fill & Sign, built with pdf-lib: every
 * field type, the flags the tool reads, and the XFA variants.
 */
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib'

export interface FormFixtureOptions {
  /** Add an /XFA entry next to the fields (a hybrid form). */
  xfa?: boolean
  /** /NeedAppearances true in the AcroForm. */
  needAppearances?: boolean
  /** Turn page 2 by this much. */
  rotatePage2?: number
}

/**
 * Three pages. Page 1: name, notes (multiline), zip (comb, 5), code (max 8),
 * locked (read-only), email (required), agree (checkbox), color (radio:
 * red/green/blue), country (dropdown), langs (multi-select list box).
 * Page 2: city. Page 3: no fields, just its text.
 */
export async function makeFormPdf(options: FormFixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = [0, 1, 2].map((i) => {
    const page = doc.addPage([400, 600])
    page.drawText(`Form page ${i + 1}`, { x: 20, y: 570, size: 12, font })
    return page
  })
  const [p1, p2] = pages
  const form = doc.getForm()

  const name = form.createTextField('name')
  name.addToPage(p1, { x: 20, y: 520, width: 200, height: 20 })
  const notes = form.createTextField('notes')
  notes.enableMultiline()
  notes.addToPage(p1, { x: 20, y: 440, width: 200, height: 60 })
  const zip = form.createTextField('zip')
  zip.setMaxLength(5)
  zip.enableCombing()
  zip.addToPage(p1, { x: 20, y: 400, width: 100, height: 20 })
  const code = form.createTextField('code')
  code.setMaxLength(8)
  code.addToPage(p1, { x: 140, y: 400, width: 100, height: 20 })
  const locked = form.createTextField('locked')
  locked.setText('Fixed')
  locked.enableReadOnly()
  locked.addToPage(p1, { x: 260, y: 400, width: 100, height: 20 })
  const email = form.createTextField('email')
  email.enableRequired()
  email.acroField.dict.set(PDFName.of('TU'), PDFString.of('Email address'))
  email.addToPage(p1, { x: 20, y: 360, width: 200, height: 20 })

  const agree = form.createCheckBox('agree')
  agree.addToPage(p1, { x: 20, y: 320, width: 16, height: 16 })

  const color = form.createRadioGroup('color')
  ;['red', 'green', 'blue'].forEach((option, i) => color.addOptionToPage(option, p1, { x: 20 + i * 40, y: 280, width: 16, height: 16 }))

  const country = form.createDropdown('country')
  country.addOptions(['Nepal', 'Norway', 'Peru'])
  country.addToPage(p1, { x: 20, y: 240, width: 150, height: 20 })

  const langs = form.createOptionList('langs')
  langs.addOptions(['C', 'Go', 'Rust', 'TypeScript'])
  langs.enableMultiselect()
  langs.addToPage(p1, { x: 20, y: 150, width: 150, height: 70 })

  const city = form.createTextField('city')
  city.addToPage(p2, { x: 20, y: 520, width: 200, height: 20 })

  if (options.rotatePage2) p2.setRotation(degrees(options.rotatePage2))
  const acro = form.acroForm.dict
  if (options.needAppearances) acro.set(PDFName.of('NeedAppearances'), doc.context.obj(true))
  // drawing appearances goes through doc.getForm(), which drops /XFA: save first, add it after
  form.updateFieldAppearances()
  // pdf-lib writes the size it drew at into /DA; give the fields "auto" (0), as forms made in Acrobat have
  for (const field of form.getFields()) if (field.acroField.dict.has(PDFName.of('DA'))) field.acroField.dict.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'))
  if (options.xfa) acro.set(PDFName.of('XFA'), doc.context.register(doc.context.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>')))
  return doc.save({ updateFieldAppearances: false })
}

/** An XFA-only form: an AcroForm with XFA data and no fields; `dynamic` also sets the catalog's NeedsRendering. */
export async function makeXfaOnlyPdf(dynamic = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([400, 600]).drawText('Please wait... this document needs an XFA viewer.', { x: 20, y: 570, size: 10, font })
  const xfa = doc.context.register(doc.context.stream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'))
  const acro = doc.context.obj({ Fields: [], XFA: xfa })
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acro))
  if (dynamic) doc.catalog.set(PDFName.of('NeedsRendering'), doc.context.obj(true))
  return doc.save()
}

/** A dropdown whose options are [export, label] pairs. */
export async function makePairedChoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 300])
  const form = doc.getForm()
  const size = form.createDropdown('size')
  size.addToPage(page, { x: 20, y: 200, width: 150, height: 20 })
  size.acroField.dict.set(
    PDFName.of('Opt'),
    doc.context.obj([
      [PDFString.of('S'), PDFString.of('Small')],
      [PDFString.of('L'), PDFString.of('Large')],
    ]),
  )
  return doc.save()
}

/** One 1×1 PNG pixel, opaque red. */
export const RED_PIXEL_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
