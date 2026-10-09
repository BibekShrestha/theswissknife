import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { profileColumns, type ColumnType } from './view'

/** Rows read to describe the columns — enough to tell an id from a category. */
const PROFILE_ROWS = 50_000
const PANEL_WIDTH = 320

const TYPE_MARK: Record<ColumnType, string> = { number: '#', date: 'D', boolean: 'B', text: 'T' }

interface GroupPickerProps {
  anchor: HTMLElement
  rows: string[][]
  bodyStart: number
  width: number
  types: ColumnType[]
  label: (column: number) => string
  current: number
  onPick: (column: number) => void
  onClose: () => void
}

/**
 * Lists every column with how many distinct values it holds and a preview of
 * them, so picking a column to group by is informed rather than a guess. A
 * column where every value differs is dimmed — grouping it gives one row per
 * group — but left pickable.
 */
export function GroupPicker({ anchor, rows, bodyStart, width, types, label, current, onPick, onClose }: GroupPickerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const profiles = useMemo(() => profileColumns(rows, bodyStart, width, PROFILE_ROWS), [rows, bodyStart, width])
  const sampled = rows.length - bodyStart > PROFILE_ROWS

  useLayoutEffect(() => {
    const place = () => {
      const box = anchor.getBoundingClientRect()
      setPosition({
        top: box.bottom + 4,
        left: Math.max(8, Math.min(box.left, window.innerWidth - PANEL_WIDTH - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panel.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [anchor, onClose])

  // Focus the current choice (or the first) so arrow keys work straight away.
  useEffect(() => {
    const items = panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    items?.[Math.max(0, current)]?.focus()
  }, [current])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      anchor.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1)
    items[next]?.focus()
  }

  return (
    <div
      ref={panel}
      className="csv-grouppick"
      role="menu"
      aria-label="Group rows by"
      style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
      onKeyDown={onKeyDown}
    >
      <header>
        <strong>Group rows by</strong>
        <span>rows sharing a value fold under one header, with a count and totals</span>
      </header>
      <ul>
        {profiles.map((profile, column) => {
          const values = profile.capped
            ? `${profile.distinct.toLocaleString()}+ values`
            : `${profile.distinct.toLocaleString()} value${profile.distinct === 1 ? '' : 's'}`
          return (
            <li key={column}>
              <button
                role="menuitemradio"
                aria-checked={current === column}
                className={`${current === column ? 'on' : ''}${profile.unique ? ' unique' : ''}`}
                onClick={() => onPick(column)}
                title={profile.unique ? 'Every value is different — each group would hold one row' : undefined}
              >
                <span className="csv-grouppick-type" aria-hidden>{TYPE_MARK[types[column] ?? 'text']}</span>
                <span className="csv-grouppick-main">
                  <span className="csv-grouppick-name">{label(column)}</span>
                  <span className="csv-grouppick-preview">
                    {profile.unique ? 'every value is different' : profile.top.join(', ') || 'all empty'}
                  </span>
                </span>
                <span className="csv-grouppick-count">{values}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {sampled && <footer>Counts from the first {PROFILE_ROWS.toLocaleString()} rows</footer>}
    </div>
  )
}
