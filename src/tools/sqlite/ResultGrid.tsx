import { useState } from 'react'
import { formatCell, type Cell, type Sort } from './sql'

/** Rows put in the DOM at once; the rest is one click away. 10,000 rows × many columns would stall layout. */
const RENDER_STEP = 1000

interface Props {
  columns: string[]
  rows: Cell[][]
  /** Row number shown for the first row (1 + page offset in the browser). */
  firstRow?: number
  sort?: Sort | null
  onSort?: (column: string) => void
}

export function ResultGrid({ columns, rows, firstRow = 1, sort = null, onSort }: Props) {
  const [shown, setShown] = useState(RENDER_STEP)
  const visible = rows.length > shown ? rows.slice(0, shown) : rows

  if (columns.length === 0) return null

  return (
    <div className="sqlite-grid-wrap">
      <table className="sqlite-grid">
        <thead>
          <tr>
            <th className="sqlite-rownum" scope="col">#</th>
            {columns.map((column, i) => {
              const active = sort?.column === column ? sort.dir : null
              return (
                <th
                  key={i}
                  scope="col"
                  aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined}
                >
                  {onSort ? (
                    <button type="button" className="sqlite-sort" onClick={() => onSort(column)} title={`Sort by ${column}`}>
                      <span>{column}</span>
                      <span className="material-symbols-outlined" aria-hidden>
                        {active === 'asc' ? 'arrow_upward' : active === 'desc' ? 'arrow_downward' : 'unfold_more'}
                      </span>
                    </button>
                  ) : (
                    column
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, r) => (
            <tr key={r}>
              <td className="sqlite-rownum">{firstRow + r}</td>
              {row.map((value, c) => {
                const cell = formatCell(value)
                return (
                  <td key={c} className={`sqlite-cell sqlite-cell-${cell.kind}`} title={cell.title}>
                    {cell.text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown && (
        <button type="button" className="sqlite-more" onClick={() => setShown((n) => n + RENDER_STEP * 4)}>
          Showing {shown.toLocaleString()} of {rows.length.toLocaleString()} rows — show more
        </button>
      )}
    </div>
  )
}
