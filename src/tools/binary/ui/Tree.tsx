import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { hexOffset } from '../util'
import { displayOf, type Row, type ViewChoice } from './model'

const ROW_H = 28
const OVERSCAN = 12

interface TreeProps {
  rows: Row[]
  selected: string | null
  choice: ViewChoice
  onSelect: (id: string) => void
  onToggle: (id: string, open: boolean) => void
}

const domId = (id: string) => `bin-node-${id.replace(/\./g, '_')}`

/**
 * The decoded tree as one flat, windowed list of treeitems (aria-level /
 * setsize / posinset carry the structure), so a 100,000-node result renders
 * a screenful of rows. Focus stays on the tree; aria-activedescendant names
 * the selected row, which is always scrolled into the rendered window.
 */
export function Tree({ rows, selected, choice, onSelect, onToggle }: TreeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(el.clientHeight || 480)
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])
  // The tree's height follows its rows (max-height), so measure again when they change too.
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.clientHeight || 480)
  }, [rows.length])

  const index = selected ? rows.findIndex((r) => r.id === selected) : -1

  useEffect(() => {
    const el = ref.current
    if (!el || index < 0) return
    const top = index * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
  }, [index])

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)

  const move = (to: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))]
    if (row) onSelect(row.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return
    const row = index >= 0 ? rows[index] : null
    const page = Math.max(1, Math.floor(height / ROW_H) - 1)
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1)
        break
      case 'ArrowUp':
        move(index - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(rows.length - 1)
        break
      case 'PageDown':
        move(index + page)
        break
      case 'PageUp':
        move(index - page)
        break
      case 'ArrowRight':
        if (!row) move(0)
        else if (row.hasChildren && !row.expanded) onToggle(row.id, true)
        else if (row.expanded) move(index + 1)
        break
      case 'ArrowLeft':
        if (row?.expanded) onToggle(row.id, false)
        else if (row?.parent) onSelect(row.parent)
        break
      case 'Enter':
      case ' ':
        if (row?.hasChildren) onToggle(row.id, !row.expanded)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div
      ref={ref}
      className="bin-tree"
      role="tree"
      aria-label="Decoded items"
      tabIndex={0}
      aria-activedescendant={index >= 0 ? domId(rows[index].id) : undefined}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop)
        setHeight(event.currentTarget.clientHeight || 480)
      }}
    >
      <div className="bin-tree-space" style={{ height: rows.length * ROW_H }}>
        {rows.slice(first, last).map((row, i) => {
          const { value, kind } = displayOf(row.node, row.id, choice)
          const n = row.node
          return (
            <div
              key={row.id}
              id={domId(row.id)}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-setsize={row.setsize}
              aria-posinset={row.posinset}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={row.id === selected}
              className={`bin-row${row.id === selected ? ' on' : ''}${n.notes?.some((x) => x.level === 'warn') ? ' warn' : ''}`}
              style={{ top: (first + i) * ROW_H, paddingLeft: `calc(${Math.min(row.depth, 24)} * 14px + var(--sp-2))` }}
              onClick={() => onSelect(row.id)}
            >
              <span
                className={`bin-twisty material-symbols-outlined${row.hasChildren ? '' : ' leaf'}`}
                aria-hidden
                onClick={(event) => {
                  if (!row.hasChildren) return
                  event.stopPropagation()
                  onSelect(row.id)
                  onToggle(row.id, !row.expanded)
                }}
              >
                {row.expanded ? 'expand_more' : 'chevron_right'}
              </span>
              <span className="bin-label">{n.label}</span>
              <span className="bin-kind">{kind}</span>
              <span className="bin-value">{value}</span>
              <span className="bin-off">{hexOffset(n.key ? Math.min(n.key.start, n.start) : n.start)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
