import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  AD_MONTHS, bsToDay, dayToAd, dayToBs, FIRST_YEAR, fiscalYear, inRange, isoDate, LAST_YEAR, longAd, longBs, monthLength, MONTHS,
  nepaliBs, toNepaliDigits, today, weekday, WEEKDAYS, yearLength,
} from './calendar'
import { DateField } from './DateField'

type Copy = (text: string, what: string) => Promise<void>

interface Props {
  value: number
  onChange: (day: number) => void
  copy: Copy
}

export function Converter({ value, onChange, copy }: Props) {
  const bs = dayToBs(value)!
  const ad = dayToAd(value)
  const day = WEEKDAYS[weekday(value)]
  const fy = fiscalYear(bs)!
  const dayOfYear = value - bsToDay({ year: bs.year, month: 1, day: 1 })! + 1
  const rows: { label: string; text: string; copyText?: string; lang?: string }[] = [
    { label: 'BS', text: isoDate(bs), copyText: isoDate(bs) },
    { label: 'BS in words', text: `${day.en}, ${longBs(bs)}`, copyText: longBs(bs) },
    { label: 'Nepali', text: `${nepaliBs(bs)}, ${day.ne}`, copyText: nepaliBs(bs), lang: 'ne' },
    { label: 'AD', text: isoDate(ad), copyText: isoDate(ad) },
    { label: 'AD in words', text: `${day.en}, ${longAd(ad)}`, copyText: longAd(ad) },
  ]

  return (
    <div className="ndate-convert">
      <section className="ndate-card" aria-labelledby="ndate-convert-title">
        <h2 id="ndate-convert-title">Convert</h2>
        <DateField label="Date" value={value} onChange={onChange} />
        <dl className="ndate-facts" aria-live="polite">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>
                <span lang={row.lang}>{row.text}</span>
                {row.copyText && (
                  <button type="button" onClick={() => void copy(row.copyText!, row.label)} aria-label={`Copy ${row.label}`} title="Copy">
                    <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                  </button>
                )}
              </dd>
            </div>
          ))}
          <div>
            <dt>Fiscal year</dt>
            <dd>
              {fy.label}
              {fy.dayOf !== undefined && <span className="ndate-muted"> · day {fy.dayOf}{fy.length ? ` of ${fy.length}` : ''}</span>}
            </dd>
          </div>
          <div>
            <dt>In the year</dt>
            <dd>
              Day {dayOfYear} of {yearLength(bs.year)}
              <span className="ndate-muted"> · {MONTHS[bs.month - 1].en} {bs.year} has {monthLength(bs.year, bs.month)} days</span>
            </dd>
          </div>
        </dl>
      </section>
      <MonthGrid value={value} onPick={onChange} />
    </div>
  )
}

/** The BS month around `value`, laid out Sunday to Saturday like a printed patro. */
function MonthGrid({ value, onPick }: { value: number; onPick: (day: number) => void }) {
  const bs = dayToBs(value)!
  const [view, setView] = useState({ year: bs.year, month: bs.month })
  const [followed, setFollowed] = useState(`${bs.year}-${bs.month}`)
  const focusPending = useRef(false)
  const gridRef = useRef<HTMLTableElement>(null)

  // Follow the selected date into its month in the same render, so the
  // selected button exists when focus moves to it.
  if (followed !== `${bs.year}-${bs.month}`) {
    setFollowed(`${bs.year}-${bs.month}`)
    setView({ year: bs.year, month: bs.month })
  }

  useEffect(() => {
    if (!focusPending.current) return
    const button = gridRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
    if (!button) return
    focusPending.current = false
    button.focus()
  }, [value, view])

  const first = bsToDay({ ...view, day: 1 })!
  const length = monthLength(view.year, view.month)!
  const lead = weekday(first)
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => first + i)]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  const now = today()
  const selectedHere = value >= first && value < first + length
  const lastAd = dayToAd(first + length - 1)
  const firstAd = dayToAd(first)
  const adSpan = firstAd.month === lastAd.month
    ? `${AD_MONTHS[firstAd.month - 1]} ${firstAd.year}`
    : `${AD_MONTHS[firstAd.month - 1]}${firstAd.year !== lastAd.year ? ` ${firstAd.year}` : ''} – ${AD_MONTHS[lastAd.month - 1]} ${lastAd.year}`

  const step = (months: number) => {
    const index = view.year * 12 + view.month - 1 + months
    const year = Math.floor(index / 12)
    if (year >= FIRST_YEAR && year <= LAST_YEAR) setView({ year, month: (index % 12) + 1 })
  }
  const atStart = view.year === FIRST_YEAR && view.month === 1
  const atEnd = view.year === LAST_YEAR && view.month === 12

  const onKey = (event: KeyboardEvent<HTMLTableElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
    if (move === undefined || !selectedHere) return
    event.preventDefault()
    if (!inRange(value + move)) return
    focusPending.current = true
    onPick(value + move)
  }

  return (
    <section className="ndate-card ndate-month" aria-labelledby="ndate-month-title">
      <div className="ndate-month-head">
        <h2 id="ndate-month-title">
          {MONTHS[view.month - 1].en} {view.year} <span lang="ne">{MONTHS[view.month - 1].ne} {toNepaliDigits(view.year)}</span>
          <small>{adSpan}</small>
        </h2>
        <div className="ndate-month-nav">
          <button type="button" onClick={() => step(-1)} disabled={atStart} aria-label="Previous month" title="Previous month">
            <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
          </button>
          <select value={view.month} onChange={(event) => setView({ ...view, month: Number(event.target.value) })} aria-label="Month">
            {MONTHS.map((m, i) => <option key={m.en} value={i + 1}>{m.en}</option>)}
          </select>
          <select value={view.year} onChange={(event) => setView({ ...view, year: Number(event.target.value) })} aria-label="Year (BS)">
            {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" onClick={() => step(1)} disabled={atEnd} aria-label="Next month" title="Next month">
            <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
          </button>
        </div>
      </div>
      <table className="ndate-grid" ref={gridRef} onKeyDown={onKey}>
        <caption className="ndate-sr">Days of {MONTHS[view.month - 1].en} {view.year}; arrow keys move the selected day</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((w, i) => (
              <th key={w.en} scope="col" abbr={w.en} className={i === 6 ? 'ndate-sat' : undefined}>
                <span>{w.short}</span> <span lang="ne">{w.neShort}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((n, j) => {
                if (n === null) return <td key={j} />
                const d = dayToBs(n)!
                const a = dayToAd(n)
                const selected = n === value
                const tabbable = selectedHere ? selected : n === first
                return (
                  <td key={j}>
                    <button
                      type="button"
                      className={`ndate-day${j === 6 ? ' ndate-sat' : ''}${n === now ? ' ndate-today' : ''}`}
                      aria-pressed={selected}
                      aria-current={n === now ? 'date' : undefined}
                      aria-label={`${WEEKDAYS[j].en}, ${longBs(d)}, ${longAd(a)}`}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => onPick(n)}
                    >
                      <span className="ndate-day-bs" lang="ne">{toNepaliDigits(d.day)}</span>
                      <span className="ndate-day-ad">{a.day === 1 ? `${AD_MONTHS[a.month - 1].slice(0, 3)} 1` : a.day}</span>
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ndate-muted">Saturdays are marked. Public holidays are announced year by year and are not shown.</p>
    </section>
  )
}
