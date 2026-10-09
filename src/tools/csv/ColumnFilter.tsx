import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FILTER_OPS, topValues, VALUELESS, type ColumnType, type Filter, type FilterOp } from './view'

const PICKS = 8
const POPOVER_WIDTH = 260

interface ColumnFilterProps {
  /** The header's filter button — the popover hangs below it. */
  anchor: HTMLElement
  column: number
  label: string
  type: ColumnType
  rows: string[][]
  bodyStart: number
  filter: Filter | undefined
  onChange: (filter: Filter | null) => void
  onClose: () => void
}

/**
 * One column's filter, opened from its header. Changes apply as they are
 * typed, so the grid behind answers straight away; there is nothing to submit.
 * Fixed-positioned so the grid's own scrolling cannot clip it.
 */
export function ColumnFilter({ anchor, column, label, type, rows, bodyStart, filter, onChange, onClose }: ColumnFilterProps) {
  const [op, setOp] = useState<FilterOp>(filter?.op ?? (type === 'text' ? 'contains' : 'equals'))
  const [value, setValue] = useState(filter?.value ?? '')
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const panel = useRef<HTMLDivElement>(null)

  const picks = useMemo(() => topValues(rows, bodyStart, column, PICKS), [rows, bodyStart, column])

  // Follows its header while the grid scrolls; once the header has scrolled
  // away (or been windowed out of the DOM) there is nothing left to hang from.
  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.getBoundingClientRect()
      if (!anchor.isConnected || box.right < 0 || box.left > window.innerWidth || box.width === 0) {
        onClose()
        return
      }
      setPosition({
        top: box.bottom + 4,
        left: Math.max(8, Math.min(box.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, onClose])

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panel.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  const apply = (nextOp: FilterOp, nextValue: string) => {
    setOp(nextOp)
    setValue(nextValue)
    onChange(VALUELESS.has(nextOp) || nextValue !== '' ? { column, op: nextOp, value: nextValue } : null)
  }

  const placeholder = type === 'number' ? 'number' : type === 'date' ? 'YYYY-MM-DD' : 'value'

  return (
    <div
      ref={panel}
      className="csv-colfilter"
      role="dialog"
      aria-label={`Filter ${label}`}
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
      onKeyDown={(event) => {
        // The popover sits inside the grid; its keys are not grid navigation.
        event.stopPropagation()
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault()
          onClose()
          anchor.focus()
        }
      }}
    >
      <header>
        <span className="material-symbols-outlined" aria-hidden>filter_alt</span>
        <strong>{label}</strong>
        <button onClick={onClose} aria-label="Close the filter">
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>
      <div className="csv-colfilter-row">
        <select value={op} onChange={(event) => apply(event.target.value as FilterOp, value)} aria-label="Condition">
          {FILTER_OPS.map((entry) => (
            <option key={entry.op} value={entry.op}>
              {entry.label}
            </option>
          ))}
        </select>
        {!VALUELESS.has(op) && (
          <input
            type="text"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => apply(op, event.target.value)}
            aria-label="Value"
          />
        )}
      </div>
      {picks.length > 0 && !VALUELESS.has(op) && (
        <ul className="csv-colfilter-picks" aria-label="Most common values">
          {picks.map((pick) => (
            <li key={pick.value}>
              <button
                className={op === 'equals' && value === pick.value ? 'on' : ''}
                onClick={() => apply('equals', pick.value)}
                title={`Keep rows where ${label} = ${pick.value}`}
              >
                <span>{pick.value.length > 60 ? `${pick.value.slice(0, 60)}…` : pick.value}</span>
                <small>{pick.count.toLocaleString()}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer>
        <button
          onClick={() => {
            setValue('')
            if (VALUELESS.has(op)) setOp(type === 'text' ? 'contains' : 'equals')
            onChange(null)
          }}
          disabled={!filter}
        >
          Clear
        </button>
      </footer>
    </div>
  )
}
