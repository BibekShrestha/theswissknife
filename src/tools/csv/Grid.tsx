import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { columnName, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type ColumnType, type Sort } from './view'
import { columnOffsets, columnWindow, rowWindow } from './virtual'

export const ROW_HEIGHT = 29
export const HEADER_HEIGHT = 34
export const GUTTER_WIDTH = 64

/** Long values are shown in the detail strip, not stretched across a row. */
const CELL_CHARS = 300

/**
 * Rows are a fixed height — that is what makes the windowing arithmetic work —
 * so a field with a newline in it has to stay on one line. The break is shown
 * rather than swallowed, and the strip under the grid has the real value.
 */
export const oneLine = (value: string) => (value.includes('\n') ? value.replace(/\r?\n/g, ' \u21b5 ') : value)

/** Position in the *visible* order, so sorting does not need a reverse index. */
export interface Cursor {
  index: number
  column: number
}

interface GridProps {
  rows: string[][]
  /** Row indices in display order, after filtering and sorting. */
  order: number[]
  width: number
  headers: string[] | null
  types: ColumnType[]
  widths: number[]
  sort: Sort | null
  /** Lower-cased already when the search is case-insensitive. */
  needle: string
  caseSensitive: boolean
  cursor: Cursor | null
  editable: boolean
  onSort: (column: number) => void
  onResize: (column: number, width: number) => void
  onAutoFit: (column: number) => void
  onCursor: (cursor: Cursor | null) => void
  onEdit: (row: number, column: number, value: string) => void
}

const TYPE_MARK: Record<ColumnType, string> = {
  number: '#',
  date: 'D',
  boolean: 'B',
  text: 'T',
}

const TYPE_TITLE: Record<ColumnType, string> = {
  number: 'Every value in this column is a number — it sorts numerically',
  date: 'Every value is an ISO date — it sorts chronologically',
  boolean: 'Every value is a true/false flag',
  text: 'Mixed or free text — it sorts alphabetically',
}

function Highlight({ text, needle, caseSensitive }: { text: string; needle: string; caseSensitive: boolean }) {
  if (!needle) return <>{text}</>
  const haystack = caseSensitive ? text : text.toLowerCase()
  if (!haystack.includes(needle)) return <>{text}</>

  const parts: ReactNode[] = []
  let at = 0
  let key = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found === -1) break
    if (found > at) parts.push(text.slice(at, found))
    parts.push(<mark key={key++}>{text.slice(found, found + needle.length)}</mark>)
    at = found + needle.length
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

export function Grid(props: GridProps) {
  const { rows, order, width, headers, types, widths, sort, needle, caseSensitive, cursor, editable } = props
  const { onSort, onResize, onAutoFit, onCursor, onEdit } = props

  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ width: 900, height: 480 })
  const [editing, setEditing] = useState<Cursor | null>(null)
  const [draft, setDraft] = useState('')

  const offsets = useMemo(() => columnOffsets(widths), [widths])
  const totalWidth = GUTTER_WIDTH + (offsets[offsets.length - 1] ?? 0)
  const bodyHeight = order.length * ROW_HEIGHT

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const visibleRows = rowWindow(scroll.top, viewport.height, ROW_HEIGHT, order.length)
  const visibleColumns = columnWindow(offsets, Math.max(0, scroll.left - GUTTER_WIDTH), viewport.width)

  const columnIndexes = useMemo(() => {
    const list: number[] = []
    for (let c = visibleColumns.first; c < visibleColumns.last; c++) list.push(c)
    return list
  }, [visibleColumns.first, visibleColumns.last])

  /* ---- column resizing ---------------------------------------------- */

  const drag = useRef<{ column: number; startX: number; startWidth: number } | null>(null)

  const startResize = (event: PointerEvent<HTMLSpanElement>, column: number) => {
    event.preventDefault()
    event.stopPropagation()
    drag.current = { column, startX: event.clientX, startWidth: widths[column] }
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  const moveResize = (event: PointerEvent<HTMLSpanElement>) => {
    const state = drag.current
    if (!state) return
    const next = Math.min(
      MAX_COLUMN_WIDTH * 3,
      Math.max(MIN_COLUMN_WIDTH, state.startWidth + event.clientX - state.startX),
    )
    onResize(state.column, next)
  }

  const endResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return
    drag.current = null
    ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
  }

  /* ---- selection and editing ----------------------------------------- */

  const scrollCursorIntoView = useCallback(
    (next: Cursor) => {
      const element = scroller.current
      if (!element) return
      const top = next.index * ROW_HEIGHT
      const viewTop = element.scrollTop
      const viewBottom = viewTop + element.clientHeight - HEADER_HEIGHT
      if (top < viewTop) element.scrollTop = top
      else if (top + ROW_HEIGHT > viewBottom) element.scrollTop = top + ROW_HEIGHT - element.clientHeight + HEADER_HEIGHT

      const left = GUTTER_WIDTH + offsets[next.column]
      const right = left + widths[next.column]
      if (left - GUTTER_WIDTH < element.scrollLeft) element.scrollLeft = Math.max(0, left - GUTTER_WIDTH)
      else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right - element.clientWidth
      }
    },
    [offsets, widths],
  )

  const commit = useCallback(() => {
    if (!editing) return
    const row = order[editing.index]
    if (row !== undefined) onEdit(row, editing.column, draft)
    setEditing(null)
  }, [draft, editing, onEdit, order])

  const beginEdit = useCallback(
    (next: Cursor) => {
      if (!editable) return
      const row = order[next.index]
      if (row === undefined) return
      setDraft(rows[row]?.[next.column] ?? '')
      setEditing(next)
    },
    [editable, order, rows],
  )

  // A cursor left pointing past the end after a filter would navigate from a
  // row that is no longer on screen.
  useEffect(() => {
    if (cursor && cursor.index >= order.length) onCursor(null)
  }, [cursor, onCursor, order.length])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    const current = cursor ?? { index: visibleRows.first, column: visibleColumns.first }
    let next: Cursor | null = null

    switch (event.key) {
      case 'ArrowDown': next = { ...current, index: Math.min(order.length - 1, current.index + 1) }; break
      case 'ArrowUp': next = { ...current, index: Math.max(0, current.index - 1) }; break
      case 'ArrowRight': next = { ...current, column: Math.min(width - 1, current.column + 1) }; break
      case 'ArrowLeft': next = { ...current, column: Math.max(0, current.column - 1) }; break
      case 'PageDown': next = { ...current, index: Math.min(order.length - 1, current.index + 20) }; break
      case 'PageUp': next = { ...current, index: Math.max(0, current.index - 20) }; break
      case 'Home': next = { ...current, column: 0 }; break
      case 'End': next = { ...current, column: width - 1 }; break
      case 'Enter':
      case 'F2':
        if (cursor) {
          event.preventDefault()
          beginEdit(cursor)
        }
        return
      case 'Escape':
        onCursor(null)
        return
      default:
        return
    }

    if (!next || order.length === 0) return
    event.preventDefault()
    onCursor(next)
    scrollCursorIntoView(next)
  }

  const gridStyle: CSSProperties = { height: HEADER_HEIGHT + bodyHeight, width: totalWidth }

  return (
    <div
      ref={scroller}
      className="csv-grid"
      tabIndex={0}
      role="grid"
      aria-rowcount={order.length + (headers ? 1 : 0)}
      aria-colcount={width}
      aria-label="CSV rows"
      onKeyDown={onKeyDown}
      onScroll={(event) =>
        setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
      }
    >
      <div className="csv-grid-inner" style={gridStyle}>
        <div className="csv-head" role="row" aria-rowindex={1} style={{ width: totalWidth }}>
          <div className="csv-gutter csv-head-cell" style={{ width: GUTTER_WIDTH }} role="columnheader">
            <span className="csv-head-type">{order.length ? '#' : ''}</span>
          </div>
          {columnIndexes.map((column) => {
            const label = headers?.[column]?.trim() || columnName(column)
            const active = sort?.column === column
            return (
              <div
                key={column}
                className={`csv-head-cell${active ? ' sorted' : ''}`}
                role="columnheader"
                aria-colindex={column + 1}
                aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                style={{ left: GUTTER_WIDTH + offsets[column], width: widths[column] }}
              >
                <button
                  type="button"
                  onClick={() => onSort(column)}
                  title={`${label} — ${TYPE_TITLE[types[column] ?? 'text']}`}
                >
                  <span className="csv-head-type" aria-hidden>{TYPE_MARK[types[column] ?? 'text']}</span>
                  <span className="csv-head-label">{label}</span>
                  {active && (
                    <span className="csv-head-arrow" aria-hidden>
                      {sort.direction === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
                <span
                  className="csv-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${label}`}
                  onPointerDown={(event) => startResize(event, column)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={() => onAutoFit(column)}
                  title="Drag to resize, double-click to fit the content"
                />
              </div>
            )
          })}
        </div>

        <div className="csv-body" style={{ height: bodyHeight, width: totalWidth }}>
          {order.slice(visibleRows.first, visibleRows.last).map((rowIndex, offset) => {
            const index = visibleRows.first + offset
            const row = rows[rowIndex]
            const selectedRow = cursor?.index === index
            return (
              <div
                key={rowIndex}
                className={`csv-row${selectedRow ? ' on' : ''}`}
                role="row"
                aria-rowindex={index + (headers ? 2 : 1)}
                style={{ top: index * ROW_HEIGHT, width: totalWidth }}
              >
                <div className="csv-gutter csv-cell" style={{ width: GUTTER_WIDTH }} role="rowheader">
                  {index + 1}
                </div>
                {columnIndexes.map((column) => {
                  const value = row?.[column] ?? ''
                  const isCursor = selectedRow && cursor?.column === column
                  const isEditing = editing?.index === index && editing.column === column
                  return (
                    <div
                      key={column}
                      className={`csv-cell${isCursor ? ' cursor' : ''}${
                        types[column] === 'number' ? ' num' : ''
                      }${value === '' ? ' empty' : ''}`}
                      role="gridcell"
                      aria-colindex={column + 1}
                      style={{ left: GUTTER_WIDTH + offsets[column], width: widths[column] }}
                      onMouseDown={() => onCursor({ index, column })}
                      onDoubleClick={() => beginEdit({ index, column })}
                    >
                      {isEditing ? (
                        <input
                          className="csv-editor"
                          autoFocus
                          value={draft}
                          aria-label="Edit cell"
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={commit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commit()
                            } else if (event.key === 'Escape') {
                              event.preventDefault()
                              setEditing(null)
                            }
                            event.stopPropagation()
                          }}
                        />
                      ) : value.length > CELL_CHARS ? (
                        `${oneLine(value.slice(0, CELL_CHARS))}…`
                      ) : (
                        <Highlight text={oneLine(value)} needle={needle} caseSensitive={caseSensitive} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
