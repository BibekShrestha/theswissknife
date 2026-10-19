import { useState } from 'react'

/** A whole number of at least `min` typed into a field, or null. */
export function parseWhole(value: string, min = 1): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) && n >= min ? n : null
}

interface NumberFieldProps {
  id: string
  label: string
  /** The raw text, so the field can be emptied and retyped. */
  value: string
  onChange: (value: string) => void
  min?: number
}

/**
 * A number input that keeps what is typed — clearing it leaves it empty
 * rather than snapping back to 1 — and says it is invalid once left.
 * Callers check it again with parseWhole on submit.
 */
export function NumberField({ id, label, value, onChange, min = 1 }: NumberFieldProps) {
  const [left, setLeft] = useState(false)
  const invalid = left && parseWhole(value, min) === null
  return (
    <div className="pdf-form-group">
      <label className="pdf-form-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="pdf-number-input"
        type="number"
        inputMode="numeric"
        min={min}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setLeft(true)
          const n = parseWhole(value, min)
          if (n !== null && String(n) !== value) onChange(String(n))
        }}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-invalid` : undefined}
      />
      {invalid && (
        <p className="pdf-form-hint pdf-form-invalid" id={`${id}-invalid`}>
          Enter a whole number, {min} or more.
        </p>
      )}
    </div>
  )
}
