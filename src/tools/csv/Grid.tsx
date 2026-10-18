import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  columnName,
  describeFilter,
  groupIndex,
  isGroupHeader,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  type ColumnType,
  type Filter,
  type Group,
  type Sort,
  TYPE_SAMPLE,
} from './view'
import { bodyHeightFor, columnOffsets, columnWindow, rowWindow, toScrollTop, toVirtualTop } from './virtual'
import { ColumnFilter } from './ColumnFilter'

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
  /**
   * Row indices in display order, after filtering and sorting. When grouped,
   * group headers are mixed in as negative entries (`~groupIndex`).
   */
  order: number[]
  /** The groups `order` refers to, or null when the grid is not grouped. */
  groups: Group[] | null
  groupColumn: number
  collapsed: ReadonlySet<string>
  /** When grouped, the gutter shows each row's line in the data instead of its position. */
  bodyStart: number
  /** At most one per column. */
  filters: Filter[]
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
  onToggleGroup: (value: string) => void
  onFilter: (column: number, filter: Filter | null) => void
}

const TYPE_MARK: Record<ColumnType, string> = {
  number: '#',
  date: 'D',
  boolean: 'B',
  text: 'T',
}

const SAMPLED = `the first ${TYPE_SAMPLE} non-empty values`

const TYPE_TITLE: Record<ColumnType, string> = {
  number: `Every value checked (${SAMPLED}) is a number — it sorts numerically`,
  date: `Every value checked (${SAMPLED}) is an ISO date — it sorts chronologically`,
  boolean: `Every value checked (${SAMPLED}) is a true/false flag`,
  text: 'Mixed or free text — it sorts alphabetically',
}

/**
 * Where `needle` occurs in `text`, as [start, end) offsets into `text` itself.
 * Lower-casing can change a string's length ('İ' becomes two code units), so
 * offsets found in the lower-cased copy are mapped back character by
 * character rather than reused as they are.
 */
export function highlightRanges(text: string, needle: string, caseSensitive: boolean): [number, number][] {
  if (!needle) return []
  let haystack = caseSensitive ? text : text.toLowerCase()
  let origin: number[] | null = null
  if (!caseSensitive && haystack.length !== text.length) {
    // origin[i] is where the code unit at haystack[i] came from in text.
    haystack = ''
    origin = []
    for (let i = 0; i < text.length; ) {
      const char = String.fromCodePoint(text.codePointAt(i)!)
      const lower = char.toLowerCase()
      for (let j = 0; j < lower.length; j++) origin.push(i)
      haystack += lower
      i += char.length
    }
    origin.push(text.length)
  }
  const ranges: [number, number][] = []
  let at = 0
  for (;;) {
    const found = haystack.indexOf(needle, at)
    if (found === -1) break
    const end = found + needle.length
    if (origin) {
      // A match ending part-way through one character's lower-case form
      // still covers that whole character.
      const last = origin[end - 1]
      let stop = end
      while (stop < origin.length - 1 && origin[stop] === last) stop++
      ranges.push([origin[found], origin[stop]])
    } else ranges.push([found, end])
    at = end
  }
  return ranges
}

function Highlight({ text, needle, caseSensitive }: { text: string; needle: string; caseSensitive: boolean }) {
  const ranges = highlightRanges(text, needle, caseSensitive)
  if (ranges.length === 0) return <>{text}</>

  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([start, end], key) => {
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<mark key={key}>{text.slice(start, end)}</mark>)
    at = end
  })
  parts.push(text.slice(at))
  return <>{parts}</>
}

const formatSum = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 6 })

interface GroupHeaderProps {
  group: Group
  index: number
  id: string
  top: number
  width: number
  /** The visible width — the label spans the screen, not the whole row. */
  viewWidth: number
  label: string
  sumLabel: (column: number) => string
  open: boolean
  selected: boolean
  ariaRow: number
  onToggle: () => void
}

/**
 * One row standing for a whole group: the shared value, how many rows have it
 * and the sum of every number column. The text sticks to the left edge so it
 * stays readable however far the grid is scrolled sideways.
 */
function GroupHeader({ group, id, top, width, viewWidth, label, sumLabel, open, selected, ariaRow, onToggle }: GroupHeaderProps) {
  const count = group.rows.length
  return (
    <div
      className={`csv-row csv-group${selected ? ' on' : ''}`}
      role="row"
      id={id}
      aria-rowindex={ariaRow}
      aria-expanded={open}
      aria-selected={selected}
      style={{ top, width }}
    >
      <button
        type="button"
        className="csv-group-label"
        style={{ width: Math.min(width, viewWidth) }}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
        title={open ? 'Collapse this group' : 'Expand this group'}
      >
        <span className="material-symbols-outlined" aria-hidden>
          {open ? 'expand_more' : 'chevron_right'}
        </span>
        <span className="csv-group-key">{label}</span>
        <strong>{group.value === '' ? <em>empty</em> : oneLine(group.value)}</strong>
        <span className="csv-group-count">
          {count.toLocaleString()} row{count === 1 ? '' : 's'}
        </span>
        {[...group.sums].map(([column, sum]) => (
          <span key={column} className="csv-group-sum">
            {sumLabel(column)} Σ <b>{formatSum(sum)}</b>
          </span>
        ))}
      </button>
    </div>
  )
}

export function Grid(props: GridProps) {
  const { rows, order, width, headers, types, widths, sort, needle, caseSensitive, cursor, editable } = props
  const { groups, groupColumn, collapsed, bodyStart, filters } = props
  const { onSort, onResize, onAutoFit, onCursor, onEdit, onToggleGroup, onFilter } = props
  const [filterOpen, setFilterOpen] = useState<{ column: number; anchor: HTMLElement } | null>(null)
  const closeFilter = useCallback(() => setFilterOpen(null), [])

  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [viewport, setViewport] = useState({ width: 900, height: 480 })
  const [editing, setEditing] = useState<Cursor | null>(null)
  const [draft, setDraft] = useState('')

  const offsets = useMemo(() => columnOffsets(widths), [widths])
  const totalWidth = GUTTER_WIDTH + (offsets[offsets.length - 1] ?? 0)
  // Past the browser's height limit the body is capped and the scrollbar
  // scaled: `virtualTop` is where the reader is in the full list, and rows are
  // drawn rowLift px higher than their real offset so they land in view.
  const bodyTotal = order.length * ROW_HEIGHT
  const bodyHeight = bodyHeightFor(order.length, ROW_HEIGHT)
  const scaled = bodyTotal > bodyHeight
  const bodyViewport = Math.max(ROW_HEIGHT, viewport.height - HEADER_HEIGHT)
  const virtualTop = toVirtualTop(scroll.top, bodyTotal, bodyHeight, bodyViewport)
  const rowLift = virtualTop - scroll.top
  const idBase = useId()
  const cellId = (index: number, column: number) => `${idBase}-r${index}-c${column}`

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const visibleRows = rowWindow(virtualTop, viewport.height, ROW_HEIGHT, order.length)
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
      // Worked out in the full list's coordinates, then mapped onto the
      // (possibly scaled) scrollbar — rounding away from the row, so a
      // scaled pixel never leaves it half off screen.
      const view = Math.max(ROW_HEIGHT, element.clientHeight - HEADER_HEIGHT)
      const total = order.length * ROW_HEIGHT
      const height = bodyHeightFor(order.length, ROW_HEIGHT)
      const top = next.index * ROW_HEIGHT
      const viewTop = toVirtualTop(element.scrollTop, total, height, view)
      if (top < viewTop) element.scrollTop = Math.floor(toScrollTop(top, total, height, view))
      else if (top + ROW_HEIGHT > viewTop + view) {
        element.scrollTop = Math.ceil(toScrollTop(top + ROW_HEIGHT - view, total, height, view))
      }

      const left = GUTTER_WIDTH + offsets[next.column]
      const right = left + widths[next.column]
      if (left - GUTTER_WIDTH < element.scrollLeft) element.scrollLeft = Math.max(0, left - GUTTER_WIDTH)
      else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right - element.clientWidth
      }
    },
    [offsets, widths, order.length],
  )

  const commit = useCallback(() => {
    if (!editing) return
    const row = order[editing.index]
    // Leaving a cell as it was is not an edit.
    if (row !== undefined && !isGroupHeader(row) && (rows[row]?.[editing.column] ?? '') !== draft) {
      onEdit(row, editing.column, draft)
    }
    setEditing(null)
  }, [draft, editing, onEdit, order, rows])

  const beginEdit = useCallback(
    (next: Cursor) => {
      if (!editable) return
      const row = order[next.index]
      if (row === undefined || isGroupHeader(row)) return
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
      // Ctrl/⌘ with Home and End jumps to the first and last row, as in a spreadsheet.
      case 'Home': next = event.ctrlKey || event.metaKey ? { ...current, index: 0 } : { ...current, column: 0 }; break
      case 'End': next = event.ctrlKey || event.metaKey ? { ...current, index: order.length - 1 } : { ...current, column: width - 1 }; break
      case 'Enter':
      case 'F2':
        if (cursor) {
          event.preventDefault()
          const item = order[cursor.index]
          if (groups && item !== undefined && isGroupHeader(item)) {
            const group = groups[groupIndex(item)]
            if (group) onToggleGroup(group.value)
          } else beginEdit(cursor)
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
  // The cursor cell is announced through aria-activedescendant — focus stays
  // on the grid — so it has to be one of the cells actually rendered.
  const activeId =
    cursor &&
    cursor.index >= visibleRows.first &&
    cursor.index < visibleRows.last &&
    order[cursor.index] !== undefined &&
    (isGroupHeader(order[cursor.index]) ||
      (cursor.column >= visibleColumns.first && cursor.column < visibleColumns.last))
      ? cellId(cursor.index, isGroupHeader(order[cursor.index]) ? -1 : cursor.column)
      : undefined

  return (
    <div
      ref={scroller}
      className="csv-grid"
      tabIndex={0}
      role="grid"
      aria-rowcount={order.length + (headers ? 1 : 0)}
      aria-colcount={width}
      aria-label="CSV rows"
      aria-activedescendant={editing ? undefined : activeId}
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
            const filter = filters.find((entry) => entry.column === column)
            const filterShown = filterOpen?.column === column
            return (
              <div
                key={column}
                className={`csv-head-cell${active ? ' sorted' : ''}${filter ? ' filtered' : ''}`}
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
                <button
                  type="button"
                  className={`csv-head-filter${filter || filterShown ? ' on' : ''}`}
                  aria-label={`Filter ${label}`}
                  aria-expanded={filterShown}
                  aria-haspopup="dialog"
                  title={filter ? `Filtered: ${label} ${describeFilter(filter)}` : `Filter ${label}`}
                  onClick={(event) => {
                    const anchor = event.currentTarget
                    setFilterOpen((open) => (open?.column === column ? null : { column, anchor }))
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden>filter_alt</span>
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

        <div
          className="csv-body"
          // Overscan rows drawn past the capped height must not grow it.
          style={{ height: bodyHeight, width: totalWidth, overflow: scaled ? 'clip' : undefined }}
        >
          {order.slice(visibleRows.first, visibleRows.last).map((rowIndex, offset) => {
            const index = visibleRows.first + offset
            if (isGroupHeader(rowIndex)) {
              const group = groups?.[groupIndex(rowIndex)]
              if (!group) return null
              return (
                <GroupHeader
                  key={rowIndex}
                  group={group}
                  index={index}
                  top={index * ROW_HEIGHT - rowLift}
                  id={cellId(index, -1)}
                  width={totalWidth}
                  viewWidth={viewport.width}
                  label={headers?.[groupColumn]?.trim() || columnName(groupColumn)}
                  sumLabel={(column) => headers?.[column]?.trim() || columnName(column)}
                  open={!collapsed.has(group.value)}
                  selected={cursor?.index === index}
                  ariaRow={index + (headers ? 2 : 1)}
                  onToggle={() => {
                    onCursor({ index, column: cursor?.column ?? 0 })
                    onToggleGroup(group.value)
                  }}
                />
              )
            }
            const row = rows[rowIndex]
            const selectedRow = cursor?.index === index
            return (
              <div
                key={rowIndex}
                className={`csv-row${selectedRow ? ' on' : ''}`}
                role="row"
                aria-rowindex={index + (headers ? 2 : 1)}
                style={{ top: index * ROW_HEIGHT - rowLift, width: totalWidth }}
              >
                <div className="csv-gutter csv-cell" style={{ width: GUTTER_WIDTH }} role="rowheader">
                  {groups ? rowIndex - bodyStart + 1 : index + 1}
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
                      id={cellId(index, column)}
                      aria-colindex={column + 1}
                      aria-selected={isCursor}
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
      {filterOpen && filterOpen.column < width && (
        <ColumnFilter
          key={filterOpen.column}
          anchor={filterOpen.anchor}
          column={filterOpen.column}
          label={headers?.[filterOpen.column]?.trim() || columnName(filterOpen.column)}
          type={types[filterOpen.column] ?? 'text'}
          rows={rows}
          bodyStart={bodyStart}
          filter={filters.find((entry) => entry.column === filterOpen.column)}
          onChange={(next) => onFilter(filterOpen.column, next)}
          onClose={closeFilter}
        />
      )}
    </div>
  )
}
