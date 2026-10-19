import { describe, expect, it } from 'vitest'
import type { FieldInfo } from '../ops/form'
import { blockingProblems, changedValues, dateStamp, emptyRequired, fieldProblem, initialValues, itemName, toStamps, type Placed } from './model'

const field = (f: Partial<FieldInfo> & Pick<FieldInfo, 'name' | 'kind'>): FieldInfo => ({ readOnly: false, required: false, widgets: [], ...f })

const fields: FieldInfo[] = [
  field({ name: 'name', kind: 'text', value: 'Ada', required: true }),
  field({ name: 'zip', kind: 'text', value: '', maxLength: 5 }),
  field({ name: 'agree', kind: 'checkbox', checked: false, required: true }),
  field({ name: 'color', kind: 'radio', options: ['red', 'blue'], selected: [] }),
  field({ name: 'langs', kind: 'listbox', options: ['C', 'Go'], selected: ['C'] }),
  field({ name: 'locked', kind: 'text', value: 'x', readOnly: true }),
  field({ name: 'sig', kind: 'signature', unsupported: 'no' }),
]

const view = { width: 600, height: 800 }
const item = (p: Partial<Placed> & Pick<Placed, 'id' | 'kind'>): Placed => ({ page: 0, x: 10, y: 20, width: 30, height: 40, view, ...p })

describe('form values', () => {
  it('starts from the values in the file and sends only what changed', () => {
    const initial = initialValues(fields)
    expect(initial).toEqual({ name: 'Ada', zip: '', agree: false, color: '', langs: ['C'], locked: 'x' })
    expect(changedValues(fields, initial, initial)).toEqual({})
    const edited = { ...initial, zip: '12345', langs: ['C', 'Go'], locked: 'changed' }
    // read-only fields never go out, even when the state says otherwise
    expect(changedValues(fields, edited, initial)).toEqual({ zip: '12345', langs: ['C', 'Go'] })
  })

  it('says what is wrong with a value as it is typed', () => {
    expect(fieldProblem(fields[1], '123456')).toBe('At most 5 characters.')
    expect(fieldProblem(fields[0], 'Δ')).toMatch(/“Δ” can’t be written/)
    expect(fieldProblem(fields[0], 'Zoë')).toBe('')
    expect(blockingProblems(fields, { ...initialValues(fields), name: 'Ωmega' }, [])).toBe('Before creating the PDF, fix “name” in the form.')
    expect(blockingProblems(fields, initialValues(fields), [item({ id: 1, kind: 'text', text: '日付' })])).toMatch(/fix 1 text box with characters/)
    expect(blockingProblems(fields, initialValues(fields), [])).toBe('')
  })

  it('lists required fields that are still empty', () => {
    expect(emptyRequired(fields, initialValues(fields))).toEqual(['agree'])
    expect(emptyRequired(fields, { ...initialValues(fields), agree: true })).toEqual([])
  })
})

describe('placed items', () => {
  it('sends each signature image once, as a copy, and skips empty text boxes', () => {
    const sigs = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]
    const { stamps, images } = toStamps(
      [
        item({ id: 1, kind: 'signature', sig: 1 }),
        item({ id: 2, kind: 'signature', sig: 1, page: 2 }),
        item({ id: 3, kind: 'check' }),
        item({ id: 4, kind: 'text', text: '  ', fontSize: 12 }),
        item({ id: 5, kind: 'date', text: '2026-10-19', fontSize: 11 }),
      ],
      sigs,
    )
    expect(images).toEqual([new Uint8Array([4, 5])])
    expect(images[0]).not.toBe(sigs[1])
    expect(stamps.map((s) => s.kind)).toEqual(['image', 'image', 'check', 'text'])
    expect(stamps[1]).toMatchObject({ kind: 'image', image: 0, page: 2, x: 10, y: 20, width: 30, height: 40, view })
    expect(stamps[3]).toMatchObject({ kind: 'text', text: '2026-10-19', fontSize: 11 })
  })

  it('names items for screen readers', () => {
    expect(itemName(item({ id: 1, kind: 'signature' }), 'Drawn signature')).toBe('Drawn signature')
    expect(itemName(item({ id: 1, kind: 'date', text: '2026-10-19' }))).toBe('Date 2026-10-19')
    expect(itemName(item({ id: 1, kind: 'text', text: 'Approved\nby me' }))).toBe('Text box “Approved”')
  })

  it('writes the date in the reader’s numeric format, or ISO when that format needs other characters', () => {
    const d = new Date(2026, 9, 19)
    expect(dateStamp(d, 'en-CA')).toBe('2026-10-19')
    expect(dateStamp(d, 'en-GB')).toBe('19/10/2026')
    expect(dateStamp(d, 'de-DE')).toBe('19.10.2026')
    // Arabic digits are forced to Latin; anything the font still can't write falls back to ISO
    expect(dateStamp(d, 'ar-EG')).toMatch(/^[\d/.-]+$/)
  })
})
