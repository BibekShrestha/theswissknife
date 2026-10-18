import { useId, useRef, type KeyboardEvent } from 'react'

export interface Option<T> {
  value: T
  label: string
  icon?: string
}

interface OptionGroupProps<T> {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  /** Split the cards over this many grid rows (keyboard order stays one list). */
  rows?: number
}

/**
 * A set of option cards that behaves as a radio group: one tab stop (the
 * checked card), arrow keys move the choice, Home/End jump to the ends.
 */
export function OptionGroup<T>({ label, options, value, onChange, rows = 1 }: OptionGroupProps<T>) {
  const id = useId()
  const cards = useRef<(HTMLButtonElement | null)[]>([])
  const checked = options.findIndex((o) => o.value === value)
  const tabStop = checked < 0 ? 0 : checked
  const perRow = Math.ceil(options.length / rows)

  function onKeyDown(e: KeyboardEvent, i: number) {
    const n = options.length
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    cards.current[next]?.focus()
  }

  return (
    <div className="pdf-form-group">
      <div className="pdf-form-label" id={id}>{label}</div>
      <div role="radiogroup" aria-labelledby={id}>
        {Array.from({ length: rows }, (_, r) => (
          <div className="pdf-option-grid" key={r} style={r ? { marginTop: 8 } : undefined}>
            {options.slice(r * perRow, (r + 1) * perRow).map((opt, k) => {
              const i = r * perRow + k
              return (
                <button
                  key={String(opt.value)}
                  ref={(el) => {
                    cards.current[i] = el
                  }}
                  type="button"
                  role="radio"
                  aria-checked={i === checked}
                  tabIndex={i === tabStop ? 0 : -1}
                  className={`pdf-option-card${i === checked ? ' on' : ''}`}
                  onClick={() => onChange(opt.value)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                >
                  {opt.icon && <span className="material-symbols-outlined" aria-hidden="true">{opt.icon}</span>}
                  <span>{opt.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
