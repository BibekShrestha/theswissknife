/**
 * Fill & Sign: AcroForm fields read and written with pdf-lib, a flatten that
 * follows the spec's appearance mapping, and signature/text/checkmark stamps
 * drawn into page content. Runs in the PDF worker (jobs.ts).
 *
 * Appearances: every field whose value changes, and every field that has no
 * appearance stream, gets one drawn here (pdf-lib's providers, Helvetica), so
 * Preview, Chrome and Acrobat all show the values without redrawing them.
 * NeedAppearances is therefore removed — except when some field could not
 * be drawn (a value already in the file that Helvetica cannot write), where
 * it is set so viewers that honour it draw that field themselves.
 */
import {
  PDFArray,
  PDFBool,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFDocument,
  type PDFField,
  type PDFFont,
  type PDFForm,
  type PDFImage,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import { XFA_ONLY_MESSAGE } from '../lib/errors'
import { loadPdf, PdfInputError } from '../lib/load'
import { viewFrame } from '../lib/place'
import { CHECK_BOX, CHECK_PATH, TEXT_ASCENT, TEXT_LINE_HEIGHT } from '../lib/stamp'
import { encodingProblem } from '../lib/winansi'
import { step } from '../lib/work'
import { imageKind } from './imagekind'

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox' | 'signature' | 'button' | 'unsupported'

export interface WidgetInfo {
  /** 0-based page index. */
  page: number
  /** [x1, y1, x2, y2] in the page's user space, normalised (x1 < x2, y1 < y2). */
  rect: [number, number, number, number]
  /** Radio buttons: the option this widget selects. */
  option?: string
  /** Hidden or NoView: viewers draw nothing, and neither does the flatten. */
  hidden?: boolean
}

export interface FieldInfo {
  name: string
  /** The field's /TU — the description its author wrote for people, often clearer than the name. */
  label?: string
  kind: FieldKind
  readOnly: boolean
  required: boolean
  /** Why the field cannot be filled here (signature, button, rich text, …). */
  unsupported?: string
  /** text */
  value?: string
  multiline?: boolean
  maxLength?: number
  comb?: boolean
  /** checkbox */
  checked?: boolean
  /** radio, dropdown, listbox: the labels shown to the person */
  options?: string[]
  /** radio, dropdown, listbox: selected labels (an editable dropdown may hold text not in options) */
  selected?: string[]
  /** dropdown: free text allowed */
  editable?: boolean
  /** listbox: several options at once */
  multiSelect?: boolean
  widgets: WidgetInfo[]
}

export type XfaState = 'none' | 'hybrid' | 'only'

export interface FormReport {
  xfa: XfaState
  fields: FieldInfo[]
  pageCount: number
  /** Signature fields that hold a digital signature — any rewrite invalidates them. */
  signed: number
  needAppearances: boolean
}

/** text: string; checkbox: boolean; radio: the option, '' for none; dropdown/listbox: selected labels. */
export type FieldValue = string | boolean | string[]

interface StampBase {
  /** 0-based page index. */
  page: number
  /** Top-left corner and size in points of the page as displayed (rotation applied, origin top-left). */
  x: number
  y: number
  width: number
  height: number
  /** The displayed page's size the box was measured against; mapped onto the page's crop box. */
  view: { width: number; height: number }
}

export type Stamp =
  | (StampBase & { kind: 'image'; /** index into FillSignOptions.images */ image: number })
  | (StampBase & { kind: 'text'; text: string; fontSize: number })
  | (StampBase & { kind: 'check' })

export interface FillSignOptions {
  values: Record<string, FieldValue>
  flatten: boolean
  stamps: Stamp[]
  /** PNG (or JPEG) bytes the image stamps point at; one entry per distinct image. */
  images: Uint8Array[]
}

export interface FillSignResult {
  bytes: Uint8Array
  notes: string[]
}

const AcroForm = PDFName.of('AcroForm')
const XFA = PDFName.of('XFA')
const Fields = PDFName.of('Fields')
const Kids = PDFName.of('Kids')
const NeedAppearances = PDFName.of('NeedAppearances')
const NeedsRendering = PDFName.of('NeedsRendering')

function acroFormDict(doc: PDFDocument): PDFDict | undefined {
  const acro = doc.catalog.lookup(AcroForm)
  return acro instanceof PDFDict ? acro : undefined
}

/**
 * XFA-only: the form lives in XFA data (no AcroForm fields, or the catalog
 * says the pages must be rendered from XFA). Hybrid: XFA plus a real
 * AcroForm, which is what everything but Acrobat shows.
 */
export function xfaState(doc: PDFDocument): XfaState {
  const acro = acroFormDict(doc)
  const hasXfa = acro?.has(XFA) ?? false
  const needsRendering = doc.catalog.lookup(NeedsRendering) === PDFBool.True
  if (!hasXfa && !needsRendering) return 'none'
  const fields = acro?.lookup(Fields)
  if (needsRendering || !(fields instanceof PDFArray) || fields.size() === 0) return 'only'
  return 'hybrid'
}

/** The form, without the XFA pdf-lib would otherwise drop with a console warning — or undefined when there is no form (getForm would create one). */
function formOf(doc: PDFDocument): PDFForm | undefined {
  const acro = acroFormDict(doc)
  if (!acro) return undefined
  acro.delete(XFA)
  doc.catalog.delete(NeedsRendering)
  return doc.getForm()
}

/** Every widget annotation's page, keyed by its dictionary (one pass over the pages' /Annots). */
function widgetPages(doc: PDFDocument): Map<PDFDict, number> {
  const map = new Map<PDFDict, number>()
  doc.getPages().forEach((page, i) => {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) return
    for (let k = 0; k < annots.size(); k++) {
      const annot = annots.lookup(k)
      if (annot instanceof PDFDict && !map.has(annot)) map.set(annot, i)
    }
  })
  return map
}

const HIDDEN = 1 << 1
const NO_VIEW = 1 << 5

function isHidden(widget: PDFWidgetAnnotation): boolean {
  return (widget.getFlags() & (HIDDEN | NO_VIEW)) !== 0
}

function rectOf(widget: PDFWidgetAnnotation): [number, number, number, number] {
  const { x, y, width, height } = widget.getRectangle()
  return [Math.min(x, x + width), Math.min(y, y + height), Math.max(x, x + width), Math.max(y, y + height)]
}

interface ChoiceOption {
  /** export value (what /V holds) */
  value: string
  /** what the person sees */
  label: string
}

function choiceOptions(field: PDFDropdown | PDFOptionList): ChoiceOption[] {
  return field.acroField.getOptions().map(({ value, display }) => ({ value: value.decodeText(), label: (display ?? value).decodeText() }))
}

/** /V's strings as labels: an export value maps to its option's label; text matching no option is kept as typed. */
function selectedLabels(field: PDFDropdown | PDFOptionList, options: ChoiceOption[]): string[] {
  return field.getSelected().map((v) => (options.find((o) => o.value === v) ?? options.find((o) => o.label === v))?.label ?? v)
}

function describeField(field: PDFField, pages: Map<PDFDict, number>): FieldInfo {
  const info: FieldInfo = {
    name: field.getName(),
    kind: 'unsupported',
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    widgets: [],
  }
  const tu = field.acroField.dict.lookup(PDFName.of('TU'))
  if (tu instanceof PDFString || tu instanceof PDFHexString) {
    const label = tu.decodeText().trim()
    if (label && label !== info.name) info.label = label
  }
  const widgets = field.acroField.getWidgets()
  let radioOptions: string[] = []
  let onValues: PDFName[] = []
  if (field instanceof PDFTextField) {
    info.kind = 'text'
    if (field.isRichFormatted()) info.unsupported = 'Rich text field — its formatted value can’t be edited here.'
    else if (field.isPassword()) info.unsupported = 'Password field — not filled here, since its value would be stored in the file as plain text.'
    else if (field.isFileSelector()) info.unsupported = 'File-select field — it holds a file path, not text.'
    let value = ''
    try {
      value = field.getText() ?? ''
    } catch {
      info.unsupported ??= 'Its value can’t be read.'
    }
    const maxLength = field.getMaxLength()
    Object.assign(info, { value, multiline: field.isMultiline(), maxLength, comb: field.isCombed() && maxLength !== undefined })
  } else if (field instanceof PDFCheckBox) {
    info.kind = 'checkbox'
    info.checked = field.isChecked()
  } else if (field instanceof PDFRadioGroup) {
    info.kind = 'radio'
    radioOptions = field.getOptions()
    onValues = field.acroField.getOnValues()
    const selected = field.getSelected()
    Object.assign(info, { options: radioOptions, selected: selected ? [selected] : [] })
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    const options = choiceOptions(field)
    info.kind = field instanceof PDFDropdown ? 'dropdown' : 'listbox'
    Object.assign(info, { options: options.map((o) => o.label), selected: selectedLabels(field, options) })
    if (field instanceof PDFDropdown) info.editable = field.isEditable()
    else info.multiSelect = field.isMultiselect()
  } else if (field instanceof PDFSignature) {
    info.kind = 'signature'
    info.unsupported = 'Digital signature field — this tool places visual signatures only and can’t sign with a certificate.'
  } else if (field instanceof PDFButton) {
    info.kind = 'button'
    info.unsupported = 'Push button — nothing to fill.'
  } else {
    info.unsupported = 'A field type this tool doesn’t recognise.'
  }
  for (const widget of widgets) {
    const page = pages.get(widget.dict)
    if (page === undefined) continue
    const w: WidgetInfo = { page, rect: rectOf(widget) }
    // pdf-lib lists a group's options in the order of its widgets' on-states (or /Opt, which follows them)
    const on = info.kind === 'radio' ? widget.getOnValue() : undefined
    const option = on ? radioOptions[onValues.indexOf(on)] : undefined
    if (option !== undefined) w.option = option
    if (isHidden(widget)) w.hidden = true
    info.widgets.push(w)
  }
  return info
}

function signedCount(form: PDFForm | undefined): number {
  if (!form) return 0
  return form.getFields().filter((f) => f instanceof PDFSignature && f.acroField.dict.lookup(PDFName.of('V')) instanceof PDFDict).length
}

/** The form's fields with their current values, flags and widget positions. Changes nothing (the document is thrown away). */
export async function readForm(bytes: Uint8Array): Promise<FormReport> {
  const doc = await loadPdf(bytes)
  const xfa = xfaState(doc)
  const needAppearances = acroFormDict(doc)?.lookup(NeedAppearances) === PDFBool.True
  const pageCount = doc.getPageCount()
  if (xfa === 'only') return { xfa, fields: [], pageCount, signed: 0, needAppearances }
  const form = formOf(doc)
  const pages = widgetPages(doc)
  const fields: FieldInfo[] = []
  for (const field of form?.getFields() ?? []) {
    step()
    fields.push(describeField(field, pages))
  }
  return { xfa, fields, pageCount, signed: signedCount(form), needAppearances }
}

/** Throws a PdfInputError naming the field, for values the field cannot take. */
function applyValue(field: PDFField, value: FieldValue): void {
  const name = field.getName()
  const refuse = (why: string): never => {
    throw new PdfInputError(`“${name}”: ${why}`)
  }
  if (field.isReadOnly()) refuse('the field is read-only, so its value was not changed.')
  if (field instanceof PDFTextField) {
    if (typeof value !== 'string') refuse('expected text.')
    if (field.isRichFormatted() || field.isPassword() || field.isFileSelector()) refuse('this kind of text field can’t be filled here.')
    const multiline = field.isMultiline()
    const text = multiline ? (value as string).replace(/\r\n?/g, '\n') : (value as string).replace(/[\r\n]+/g, ' ')
    const problem = encodingProblem(text, multiline)
    if (problem) refuse(problem)
    const max = field.getMaxLength()
    if (max !== undefined && text.length > max) refuse(`at most ${max} characters.`)
    field.setText(text === '' ? undefined : text)
  } else if (field instanceof PDFCheckBox) {
    if (typeof value !== 'boolean') refuse('expected checked or unchecked.')
    if (value) field.check()
    else field.uncheck()
  } else if (field instanceof PDFRadioGroup) {
    if (typeof value !== 'string') refuse('expected one option.')
    if (value === '') field.clear()
    else if (field.getOptions().includes(value as string)) field.select(value as string)
    else refuse(`“${value}” is not one of its options.`)
  } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    if (!Array.isArray(value)) refuse('expected a list of options.')
    const labels = choiceOptions(field).map((o) => o.label)
    const chosen = (value as string[]).filter((v) => v !== '')
    const multi = field instanceof PDFOptionList && field.isMultiselect()
    if (chosen.length > 1 && !multi) refuse('only one option can be chosen.')
    const editable = field instanceof PDFDropdown && field.isEditable()
    for (const v of chosen) {
      if (!labels.includes(v) && !editable) refuse(`“${v}” is not one of its options.`)
      const problem = encodingProblem(v)
      if (problem) refuse(problem)
    }
    if (chosen.length === 0) field.clear()
    else field.select(chosen)
  } else {
    refuse('this kind of field can’t be filled here.')
  }
}

/**
 * pdf-lib writes a choice field's /V as the option's label; the spec wants
 * the export value when the two differ ([export, label] pairs in /Opt).
 * Run after appearances are drawn, which read /V as the label.
 */
function exportChoiceValues(field: PDFDropdown | PDFOptionList): void {
  const options = choiceOptions(field)
  if (options.every((o) => o.value === o.label)) return
  const selected = field.getSelected()
  const values = selected.map((label) => options.find((o) => o.label === label)?.value ?? label)
  if (values.every((v, i) => v === selected[i])) return
  const dict = field.acroField.dict
  const strings = values.map((v) => PDFHexString.fromText(v))
  dict.set(PDFName.of('V'), strings.length === 1 ? strings[0] : dict.context.obj(strings))
}

const DA = PDFName.of('DA')
const TF = /(\/[^\0\t\n\f\r ]+[\0\t\n\f\r ]+)(\d*\.\d+|\d+)([\0\t\n\f\r ]+Tf)/g
/** Acrobat's ceiling for auto-sized multi-line text; pdf-lib would grow it until the box is full. */
const MULTILINE_MAX_SIZE = 12
const MULTILINE_MIN_SIZE = 4

function daOf(dict: PDFDict): string | undefined {
  const da = dict.lookup(DA)
  return da instanceof PDFString || da instanceof PDFHexString ? da.decodeText() : undefined
}

/** Whether a field's text size is "auto" (Tf 0, or none given) for every widget. */
function autoSized(dicts: PDFDict[]): boolean {
  const sizes = dicts.flatMap((d) => [...(daOf(d) ?? '').matchAll(TF)].slice(-1).map((m) => Number(m[2])))
  return sizes.every((n) => n === 0)
}

/** The largest size up to 12 pt at which `text`, wrapped at word breaks, fits a w×h box. */
export function fitMultiline(text: string, font: PDFFont, w: number, h: number): number {
  for (let size = MULTILINE_MAX_SIZE; size > MULTILINE_MIN_SIZE; size -= 0.5) {
    let lines = 0
    for (const paragraph of text.split('\n')) {
      lines++
      let used = 0
      for (const word of paragraph.split(' ')) {
        const width = font.widthOfTextAtSize(`${word} `, size)
        if (used > 0 && used + width > w) {
          lines++
          used = 0
        }
        used += width
      }
    }
    if (lines * font.heightAtSize(size) * 1.2 <= h) return size
  }
  return MULTILINE_MIN_SIZE
}

/** The field's dictionary and its widgets' (one dictionary when they are merged). */
function fieldDicts(field: PDFField): PDFDict[] {
  return [...new Set([field.acroField.dict, ...field.acroField.getWidgets().map((w) => w.dict)])]
}

/**
 * Runs `draw` and then puts back every /DA it touched. pdf-lib writes the
 * size it drew at into /DA, which would turn an "auto" field into a fixed
 * one for whoever edits it next; the appearance it drew carries its own.
 */
function keepingDA(dicts: PDFDict[], draw: () => void): void {
  const saved = dicts.map((d) => [d, d.get(DA)] as const)
  try {
    draw()
  } finally {
    for (const [d, da] of saved) {
      if (da === undefined) d.delete(DA)
      else d.set(DA, da)
    }
  }
}

/**
 * pdf-lib auto-sizes multi-line text to fill the box, so two short lines
 * come out 50 pt tall and clipped. Viewers start at 12 pt and shrink to
 * fit; this draws at that size (the field's "auto" is put back after).
 */
function drawMultilineAuto(field: PDFTextField, font: PDFFont): void {
  const size = Math.min(
    ...field.acroField.getWidgets().map((w) => {
      const [x1, y1, x2, y2] = rectOf(w)
      return fitMultiline(field.getText() ?? '', font, x2 - x1 - 4, y2 - y1 - 4)
    }),
  )
  for (const d of fieldDicts(field)) {
    const da = daOf(d)
    if (da) d.set(DA, PDFString.of(da.replace(TF, (_, a: string, _n: string, b: string) => `${a}${size}${b}`)))
  }
  if (!daOf(field.acroField.dict)) field.acroField.dict.set(DA, PDFString.of(`/Helv ${size} Tf 0 g`))
  field.defaultUpdateAppearances(font)
}

const drawable = (f: PDFField) => f instanceof PDFTextField || f instanceof PDFDropdown || f instanceof PDFOptionList

/** Draws appearances for changed fields and fields without one; returns the names it could not draw. */
function drawAppearances(form: PDFForm, font: PDFFont, redrawAll: boolean): string[] {
  const failed: string[] = []
  for (const field of form.getFields()) {
    step()
    if (field instanceof PDFSignature) continue
    if (!(redrawAll && drawable(field)) && !field.needsAppearancesUpdate()) continue
    try {
      if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) field.defaultUpdateAppearances()
      else {
        const dicts = fieldDicts(field)
        keepingDA(dicts, () => {
          if (field instanceof PDFTextField && field.isMultiline() && autoSized(dicts)) drawMultilineAuto(field, font)
          else (field as PDFTextField).defaultUpdateAppearances(font)
        })
      }
    } catch {
      failed.push(field.getName())
    }
    form.markFieldAsClean(field.ref)
  }
  for (const field of form.getFields()) if (field instanceof PDFDropdown || field instanceof PDFOptionList) exportChoiceValues(field)
  return failed
}

/** The widget's current normal appearance stream and a ref to it, or undefined when it has none to draw. */
function appearanceOf(doc: PDFDocument, widget: PDFWidgetAnnotation): { ref: PDFRef; stream: PDFStream } | undefined {
  const ap = widget.dict.lookup(PDFName.of('AP'))
  if (!(ap instanceof PDFDict)) return undefined
  let entry = ap.get(PDFName.of('N'))
  let n = doc.context.lookup(entry)
  if (n instanceof PDFDict && !(n instanceof PDFStream)) {
    const state = widget.getAppearanceState()
    if (!state) return undefined
    entry = n.get(state)
    n = doc.context.lookup(entry)
  }
  if (!(n instanceof PDFStream)) return undefined
  const ref = entry instanceof PDFRef ? entry : doc.context.register(n)
  return { ref, stream: n }
}

const numbers = (arr: unknown, count: number): number[] | undefined => {
  if (!(arr instanceof PDFArray) || arr.size() !== count) return undefined
  const out = arr.asArray().map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN))
  return out.every(Number.isFinite) ? out : undefined
}

/**
 * The matrix that draws a form XObject into a widget's rectangle, as viewers
 * do (PDF 32000-1 §12.5.5): the BBox, transformed by the stream's /Matrix,
 * is scaled and moved onto /Rect. pdf-lib's own flatten ignores both.
 */
export function appearanceMatrix(
  bbox: number[],
  matrix: number[],
  rect: [number, number, number, number],
): [number, number, number, number, number, number] | undefined {
  const [a, b, c, d, e, f] = matrix
  const corners = [
    [bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  if (maxX - minX <= 0 || maxY - minY <= 0) return undefined
  const sx = (rect[2] - rect[0]) / (maxX - minX)
  const sy = (rect[3] - rect[1]) / (maxY - minY)
  return [sx, 0, 0, sy, rect[0] - minX * sx, rect[1] - minY * sy]
}

/**
 * Bakes every field's appearance into its page and removes the form: the
 * widget annotations, the field dictionaries and the AcroForm. Hidden
 * widgets are dropped without drawing. Returns the fields that had nothing
 * to draw.
 */
function flattenForm(doc: PDFDocument, form: PDFForm): string[] {
  const pages = doc.getPages()
  const pageOf = widgetPages(doc)
  const blank: string[] = []
  const gone = new Set<PDFDict>()
  for (const field of form.getFields()) {
    step()
    let drew = false
    let visible = false
    for (const widget of field.acroField.getWidgets()) {
      gone.add(widget.dict)
      const index = pageOf.get(widget.dict)
      if (index === undefined || isHidden(widget)) continue
      visible = true
      const ap = appearanceOf(doc, widget)
      if (!ap) continue
      const bbox = numbers(ap.stream.dict.lookup(PDFName.of('BBox')), 4)
      const matrix = numbers(ap.stream.dict.lookup(PDFName.of('Matrix')), 6) ?? [1, 0, 0, 1, 0, 0]
      const cm = bbox && appearanceMatrix(bbox, matrix, rectOf(widget))
      if (!cm) continue
      ap.stream.dict.set(PDFName.of('Type'), PDFName.of('XObject'))
      ap.stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'))
      const page = pages[index]
      const key = page.node.newXObject('FlatWidget', ap.ref)
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...cm), drawObject(key), popGraphicsState())
      drew = true
    }
    // an empty, unchecked or unsigned field legitimately draws nothing; only say so for filled ones
    if (visible && !drew && hasValue(field)) blank.push(field.getName())
  }
  removeForm(doc, gone)
  return blank
}

function hasValue(field: PDFField): boolean {
  if (field instanceof PDFTextField) return !!field.getText()
  if (field instanceof PDFCheckBox) return field.isChecked()
  if (field instanceof PDFRadioGroup) return field.getSelected() !== undefined
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected().length > 0
  return false
}

/** Removes the field tree and its widgets from the pages and the file; appearance streams the pages now draw stay. */
function removeForm(doc: PDFDocument, widgets: Set<PDFDict>): void {
  const { context } = doc
  const acro = acroFormDict(doc)
  const nodes = new Set<PDFDict>(widgets)
  const refs = new Set<PDFRef>()
  const stack: unknown[] = acro?.lookup(Fields) instanceof PDFArray ? (acro.lookup(Fields) as PDFArray).asArray() : []
  while (stack.length) {
    const entry = stack.pop()
    const node = entry instanceof PDFRef ? context.lookup(entry) : entry
    if (!(node instanceof PDFDict) || nodes.has(node)) {
      if (entry instanceof PDFRef && node instanceof PDFDict) refs.add(entry)
      continue
    }
    nodes.add(node)
    if (entry instanceof PDFRef) refs.add(entry)
    const kids = node.lookup(Kids)
    if (kids instanceof PDFArray) stack.push(...kids.asArray())
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i)
      const annot = context.lookup(entry)
      if (annot instanceof PDFDict && nodes.has(annot)) {
        annots.remove(i)
        if (entry instanceof PDFRef) refs.add(entry)
      }
    }
  }
  const acroRef = doc.catalog.get(AcroForm)
  if (acroRef instanceof PDFRef) refs.add(acroRef)
  doc.catalog.delete(AcroForm)
  for (const ref of refs) context.delete(ref)
}

function checkStamp(stamp: Stamp, pageCount: number): void {
  const nums = [stamp.x, stamp.y, stamp.width, stamp.height, stamp.view.width, stamp.view.height]
  if (!Number.isInteger(stamp.page) || stamp.page < 0 || stamp.page >= pageCount) throw new PdfInputError('A placed item points at a page this PDF doesn’t have.')
  if (!nums.every(Number.isFinite) || stamp.width <= 0 || stamp.height <= 0 || stamp.view.width <= 0 || stamp.view.height <= 0) {
    throw new PdfInputError('A placed item has an impossible size or position.')
  }
}

async function drawStamps(doc: PDFDocument, stamps: Stamp[], images: Uint8Array[]): Promise<void> {
  if (stamps.length === 0) return
  const pages = doc.getPages()
  const embedded = new Map<number, PDFImage>()
  let font: PDFFont | undefined
  for (const stamp of stamps) {
    step()
    checkStamp(stamp, pages.length)
    const page: PDFPage = pages[stamp.page]
    const frame = viewFrame(page)
    const fx = frame.width / stamp.view.width
    const fy = frame.height / stamp.view.height
    const x = stamp.x * fx
    const top = frame.height - stamp.y * fy
    const width = stamp.width * fx
    const height = stamp.height * fy
    if (stamp.kind === 'image') {
      let image = embedded.get(stamp.image)
      if (!image) {
        const bytes = images[stamp.image]
        if (!bytes) throw new PdfInputError('A placed signature has no image.')
        const kind = imageKind(bytes)
        if (kind === 'other') throw new PdfInputError('A placed signature is not a PNG or JPEG image.')
        image = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        embedded.set(stamp.image, image)
      }
      frame.drawImage(image, x, top - height, width, height)
    } else if (stamp.kind === 'text') {
      const text = stamp.text.replace(/\r\n?/g, '\n')
      if (!text.trim()) continue
      const problem = encodingProblem(text, true)
      if (problem) throw new PdfInputError(`A text box: ${problem}`)
      font ??= await doc.embedFont(StandardFonts.Helvetica)
      const size = stamp.fontSize * fy
      if (!(size > 0)) throw new PdfInputError('A text box has an impossible font size.')
      frame.drawText(text, x, top - size * TEXT_ASCENT, { size, font, lineHeight: size * TEXT_LINE_HEIGHT, color: rgb(0, 0, 0) })
    } else {
      frame.drawSvgPath(CHECK_PATH, x, top, { scale: Math.min(width, height) / CHECK_BOX, color: rgb(0, 0, 0) })
    }
  }
}

/**
 * Writes field values (with appearances), optionally flattens the form, and
 * stamps images, text and checkmarks into the page content.
 */
export async function fillAndSign(bytes: Uint8Array, options: FillSignOptions): Promise<FillSignResult> {
  const doc = await loadPdf(bytes)
  const notes: string[] = []
  const xfa = xfaState(doc)
  if (xfa === 'only') throw new PdfInputError(XFA_ONLY_MESSAGE)
  const acro = acroFormDict(doc)
  const hadNeedAppearances = acro?.lookup(NeedAppearances) === PDFBool.True
  const form = formOf(doc)
  const names = Object.keys(options.values)
  if (!form && names.length > 0) throw new PdfInputError('This PDF has no form fields to fill.')
  if (xfa === 'hybrid') {
    notes.push('This PDF also carried an XFA copy of its form. It was removed so every viewer, Acrobat included, shows the values written here rather than the stale XFA data.')
  }
  const signed = signedCount(form)
  if (signed > 0) {
    notes.push(`This PDF held ${signed} digital signature${signed === 1 ? '' : 's'}. ${signed === 1 ? 'It' : 'They'} no longer validate${signed === 1 ? 's' : ''}: any change to a signed file breaks the signature.`)
  }
  if (form) {
    const byName = new Map<string, PDFField[]>()
    for (const field of form.getFields()) byName.set(field.getName(), [...(byName.get(field.getName()) ?? []), field])
    for (const name of names) {
      step()
      const fields = byName.get(name)
      if (!fields) throw new PdfInputError(`This PDF has no field called “${name}”.`)
      for (const field of fields) applyValue(field, options.values[name])
    }
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const failed = drawAppearances(form, font, hadNeedAppearances)
    if (failed.length > 0 && !options.flatten) {
      form.acroForm.dict.set(NeedAppearances, PDFBool.True)
      notes.push(
        `${failed.map((n) => `“${n}”`).join(', ')} could not be drawn with the built-in font (its value has characters outside Windows-1252), ` +
          'so NeedAppearances is set: Acrobat redraws such fields itself, while Preview and Chrome may show them blank.',
      )
    } else {
      form.acroForm.dict.delete(NeedAppearances)
      if (hadNeedAppearances && !options.flatten) notes.push('The file asked viewers to redraw its fields (NeedAppearances). Every field now has its appearance drawn, so that flag was removed.')
    }
    if (options.flatten) {
      const blank = flattenForm(doc, form)
      const lost = [...new Set([...failed, ...blank])]
      if (lost.length > 0) notes.push(`${lost.map((n) => `“${n}”`).join(', ')} had no appearance that could be drawn, so ${lost.length === 1 ? 'it is' : 'they are'} blank on the flattened page.`)
    }
  }
  await drawStamps(doc, options.stamps, options.images)
  return { bytes: await doc.save({ updateFieldAppearances: false }), notes }
}
