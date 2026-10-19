import type { FieldInfo, FieldValue } from '../ops/form'
import { fieldProblem } from './model'

interface Props {
  fields: FieldInfo[]
  values: Record<string, FieldValue>
  onChange: (name: string, value: FieldValue) => void
  /** A control got focus: show its field on the page. */
  onActivate: (index: number) => void
  activeIndex: number | null
}

/** The id of a field's control (radio groups: of option `option`), so the page overlay can focus it. */
export const controlId = (index: number, option?: number) => `pdf-fs-f${index}${option === undefined ? '' : `-${option}`}`

function pageOf(f: FieldInfo): number {
  return f.widgets.length ? Math.min(...f.widgets.map((w) => w.page)) : -1
}

/**
 * Every field as an ordinary labelled form control, grouped by page — the
 * form is fully usable here without the page picture.
 */
export function FieldList({ fields, values, onChange, onActivate, activeIndex }: Props) {
  const groups = new Map<number, number[]>()
  fields.forEach((f, i) => groups.set(pageOf(f), [...(groups.get(pageOf(f)) ?? []), i]))
  const pages = [...groups.keys()].sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b))

  return (
    <div className="pdf-fs-fields">
      {pages.map((page) => (
        <section key={page} className="pdf-fs-group" aria-labelledby={`pdf-fs-page-${page}`}>
          <h4 className="pdf-fs-group-title" id={`pdf-fs-page-${page}`}>{page < 0 ? 'Not on any page' : `Page ${page + 1}`}</h4>
          {groups.get(page)!.map((i) => (
            <Field key={i} index={i} field={fields[i]} value={values[fields[i].name]} onChange={onChange} onActivate={onActivate} active={activeIndex === i} />
          ))}
        </section>
      ))}
    </div>
  )
}

function Field({ index, field, value, onChange, onActivate, active }: { index: number; field: FieldInfo; value: FieldValue | undefined; onChange: Props['onChange']; onActivate: Props['onActivate']; active: boolean }) {
  const id = controlId(index)
  const title = field.label ?? field.name
  const problem = fieldProblem(field, value)
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const flags = [field.required && 'required', field.readOnly && 'read-only'].filter(Boolean) as string[]
  const hints: string[] = []
  if (field.label) hints.push(`Field ${field.name}`)
  if (field.kind === 'text' && field.comb) hints.push(`${field.maxLength} boxes, one character each`)
  else if (field.kind === 'text' && field.maxLength !== undefined) hints.push(`Up to ${field.maxLength} characters`)
  if (field.kind === 'listbox' && field.multiSelect) hints.push('Several can be chosen: Ctrl or ⌘ click, or Shift with the arrow keys')
  const describedBy = [hints.length ? hintId : '', problem ? errId : ''].filter(Boolean).join(' ') || undefined
  const common = {
    onFocus: () => onActivate(index),
    'aria-describedby': describedBy,
    'aria-required': field.required || undefined,
    'aria-invalid': problem ? true : undefined,
  }
  const set = (v: FieldValue) => onChange(field.name, v)

  const badges = flags.length > 0 && (
    <span className="pdf-fs-badges">
      {flags.map((f) => (
        <span key={f} className={`pdf-fs-badge ${f}`}>{f}</span>
      ))}
    </span>
  )
  const label = (
    <label className="pdf-fs-field-label" htmlFor={id}>
      {title}
      {badges}
    </label>
  )

  let control: React.ReactNode
  if (field.unsupported) {
    return (
      <div className={`pdf-fs-field off${active ? ' on' : ''}`}>
        <div className="pdf-fs-field-label">{title}</div>
        <p className="pdf-form-hint">{field.unsupported}</p>
      </div>
    )
  } else if (field.kind === 'text') {
    const text = typeof value === 'string' ? value : ''
    control = field.multiline ? (
      <textarea id={id} className="pdf-text-input pdf-fs-plain" rows={3} value={text} readOnly={field.readOnly} maxLength={field.maxLength} onChange={(e) => set(e.target.value)} {...common} />
    ) : (
      <input id={id} className="pdf-text-input pdf-fs-plain" type="text" value={text} readOnly={field.readOnly} maxLength={field.maxLength} onChange={(e) => set(e.target.value)} {...common} />
    )
  } else if (field.kind === 'checkbox') {
    return (
      <div className={`pdf-fs-field${active ? ' on' : ''}`}>
        <label className="pdf-checkbox pdf-fs-check">
          <input id={id} type="checkbox" checked={value === true} disabled={field.readOnly} onChange={(e) => set(e.target.checked)} {...common} />
          {title}
          {badges}
        </label>
        {hints.length > 0 && <p className="pdf-form-hint" id={hintId}>{hints.join(' · ')}</p>}
      </div>
    )
  } else if (field.kind === 'radio') {
    const chosen = typeof value === 'string' ? value : ''
    return (
      <fieldset className={`pdf-fs-field pdf-fs-fieldset${active ? ' on' : ''}`} aria-describedby={hints.length ? hintId : undefined}>
        <legend className="pdf-fs-field-label">
          {title}
          {badges}
        </legend>
        <div className="pdf-fs-radios">
          {(field.options ?? []).map((option, k) => (
            <label key={k} className="pdf-checkbox">
              <input id={controlId(index, k)} type="radio" name={id} value={option} checked={chosen === option} disabled={field.readOnly} onChange={() => set(option)} onFocus={() => onActivate(index)} aria-required={field.required || undefined} />
              {option}
            </label>
          ))}
          {chosen && !field.readOnly && (
            <button type="button" className="pdf-fs-link" onClick={() => set('')} onFocus={() => onActivate(index)}>
              Clear choice
            </button>
          )}
        </div>
        {hints.length > 0 && <p className="pdf-form-hint" id={hintId}>{hints.join(' · ')}</p>}
      </fieldset>
    )
  } else if (field.kind === 'dropdown') {
    const chosen = Array.isArray(value) ? value[0] ?? '' : ''
    const options = field.options ?? []
    control = field.editable ? (
      <>
        <input id={id} className="pdf-text-input pdf-fs-plain" type="text" list={`${id}-options`} value={chosen} readOnly={field.readOnly} onChange={(e) => set(e.target.value ? [e.target.value] : [])} {...common} />
        <datalist id={`${id}-options`}>
          {options.map((o, k) => (
            <option key={k} value={o} />
          ))}
        </datalist>
      </>
    ) : (
      <select id={id} className="pdf-fs-select" value={options.includes(chosen) ? chosen : ''} disabled={field.readOnly} onChange={(e) => set(e.target.value ? [e.target.value] : [])} {...common}>
        <option value="">— none —</option>
        {options.map((o, k) => (
          <option key={k} value={o}>{o}</option>
        ))}
      </select>
    )
  } else if (field.kind === 'listbox') {
    const chosen = Array.isArray(value) ? value : []
    const options = field.options ?? []
    control = field.multiSelect ? (
      <select
        id={id}
        className="pdf-fs-select"
        multiple
        size={Math.min(Math.max(options.length, 2), 6)}
        value={chosen}
        disabled={field.readOnly}
        onChange={(e) => set([...e.target.selectedOptions].map((o) => o.value))}
        {...common}
      >
        {options.map((o, k) => (
          <option key={k} value={o}>{o}</option>
        ))}
      </select>
    ) : (
      <select id={id} className="pdf-fs-select" value={chosen[0] ?? ''} disabled={field.readOnly} onChange={(e) => set(e.target.value ? [e.target.value] : [])} {...common}>
        <option value="">— none —</option>
        {options.map((o, k) => (
          <option key={k} value={o}>{o}</option>
        ))}
      </select>
    )
  }

  return (
    <div className={`pdf-fs-field${active ? ' on' : ''}`}>
      {label}
      {control}
      {hints.length > 0 && <p className="pdf-form-hint" id={hintId}>{hints.join(' · ')}</p>}
      {problem && <p className="pdf-form-hint pdf-form-invalid" id={errId}>{problem}</p>}
    </div>
  )
}
