/**
 * Fill & Sign's screen state, kept free of pdf-lib: the field values the
 * form list edits, the items placed on pages, and turning both into the
 * worker job's options. Types come from ops/form.ts (erased at build).
 */
import type { FieldInfo, FieldValue, Stamp } from '../ops/form'
import { TEXT_FONT_STACK, TEXT_LINE_HEIGHT } from '../lib/stamp'
import { encodingProblem, unencodable } from '../lib/winansi'
import type { Box, Size } from './pad'

export type ItemKind = 'signature' | 'text' | 'date' | 'check'

/** Something placed on a page, in points of the page as displayed (origin top-left). */
export interface Placed extends Box {
  id: number
  kind: ItemKind
  page: number
  /** The displayed page size the box is measured against. */
  view: Size
  /** signature: index into the session's signature images */
  sig?: number
  /** text and date */
  text?: string
  fontSize?: number
}

export const fillable = (f: FieldInfo) => !f.unsupported && !f.readOnly

/** The value each field starts with, as the list edits it. */
export function initialValues(fields: FieldInfo[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const f of fields) {
    if (f.unsupported) continue
    if (f.kind === 'text') out[f.name] = f.value ?? ''
    else if (f.kind === 'checkbox') out[f.name] = f.checked ?? false
    else if (f.kind === 'radio') out[f.name] = f.selected?.[0] ?? ''
    else if (f.kind === 'dropdown' || f.kind === 'listbox') out[f.name] = f.selected ?? []
  }
  return out
}

const same = (a: FieldValue | undefined, b: FieldValue | undefined) => JSON.stringify(a) === JSON.stringify(b)

/** Only what the person changed goes to the worker, so untouched fields keep their own appearances. */
export function changedValues(fields: FieldInfo[], values: Record<string, FieldValue>, initial: Record<string, FieldValue>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const f of fields) {
    if (!fillable(f) || !(f.name in values)) continue
    if (!same(values[f.name], initial[f.name])) out[f.name] = values[f.name]
  }
  return out
}

/** What is wrong with a field's value, or '' — the worker checks the same, this says it while typing. */
export function fieldProblem(field: FieldInfo, value: FieldValue | undefined): string {
  if (field.kind === 'text' && typeof value === 'string') {
    if (field.maxLength !== undefined && value.length > field.maxLength) return `At most ${field.maxLength} characters.`
    return encodingProblem(value, field.multiline)
  }
  if (field.kind === 'dropdown' && Array.isArray(value)) return encodingProblem(value.join(''))
  return ''
}

/** Required fields still empty, by name. */
export function emptyRequired(fields: FieldInfo[], values: Record<string, FieldValue>): string[] {
  return fields
    .filter((f) => f.required && !f.unsupported)
    .filter((f) => {
      const v = values[f.name]
      return v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)
    })
    .map((f) => f.label ?? f.name)
}

/**
 * A date stamp for `date` in the person's own numeric format (2026-10-19,
 * 19/10/2026, …), Latin digits; ISO 8601 when the locale's format has
 * characters the built-in font cannot write.
 */
export function dateStamp(date: Date, locale?: string): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  try {
    const local = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', numberingSystem: 'latn' })
      .format(date)
      .replace(/[‎‏؜]/g, '')
    return unencodable(local).length === 0 ? local : iso
  } catch {
    return iso
  }
}

/** What a screen reader calls a placed item. */
export function itemName(item: Placed, signatureLabel?: string): string {
  switch (item.kind) {
    case 'signature': return signatureLabel ?? 'Signature'
    case 'check': return 'Checkmark'
    case 'date': return `Date ${item.text ?? ''}`.trim()
    default: return `Text box “${(item.text ?? '').split('\n')[0].slice(0, 40)}”`
  }
}

/**
 * The worker job's stamps: each signature image sent once, however many
 * times it is placed. Image bytes are copied — the job transfers (empties)
 * what it is given, and the session keeps its signatures.
 */
export function toStamps(items: Placed[], signatures: Uint8Array[]): { stamps: Stamp[]; images: Uint8Array[] } {
  const images: Uint8Array[] = []
  const slot = new Map<number, number>()
  const stamps: Stamp[] = []
  for (const item of items) {
    const base = { page: item.page, x: item.x, y: item.y, width: item.width, height: item.height, view: { ...item.view } }
    if (item.kind === 'signature') {
      const sig = item.sig!
      if (!slot.has(sig)) {
        slot.set(sig, images.length)
        images.push(signatures[sig].slice())
      }
      stamps.push({ ...base, kind: 'image', image: slot.get(sig)! })
    } else if (item.kind === 'check') stamps.push({ ...base, kind: 'check' })
    else if ((item.text ?? '').trim()) stamps.push({ ...base, kind: 'text', text: item.text!, fontSize: item.fontSize! })
  }
  return { stamps, images }
}

let measurer: CanvasRenderingContext2D | null = null

/** A text box's size in points: its widest line by its line count, in the Helvetica-compatible stack. */
export function textBoxSize(text: string, fontSize: number): Size {
  measurer ??= document.createElement('canvas').getContext('2d')
  const lines = (text || ' ').split('\n')
  let width = fontSize
  if (measurer) {
    measurer.font = `${fontSize}px ${TEXT_FONT_STACK}`
    width = Math.max(fontSize, ...lines.map((l) => measurer!.measureText(l).width))
  }
  return { width: Math.ceil(width + 1), height: lines.length * fontSize * TEXT_LINE_HEIGHT }
}

/** Every encoding or length problem in the form and the text boxes, as one message, or ''. */
export function blockingProblems(fields: FieldInfo[], values: Record<string, FieldValue>, items: Placed[]): string {
  const bad = fields.filter((f) => fillable(f) && fieldProblem(f, values[f.name])).map((f) => `“${f.label ?? f.name}”`)
  const texts = items.filter((i) => (i.kind === 'text' || i.kind === 'date') && encodingProblem(i.text ?? '', true)).length
  const parts: string[] = []
  if (bad.length) parts.push(`fix ${bad.join(', ')} in the form`)
  if (texts) parts.push(`fix ${texts} text box${texts === 1 ? '' : 'es'} with characters the built-in font can’t write`)
  return parts.length ? `Before creating the PDF, ${parts.join(' and ')}.` : ''
}
