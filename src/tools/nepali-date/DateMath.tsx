import {
  asciiDigits, dayToAd, dayToBs, isoDate, LAST_DAY, longAd, longBs, nepaliBs, weekday, WEEKDAYS, bsToDay,
} from './calendar'
import { DateField } from './DateField'
import { addBsMonths, span } from './math'
import { UNITS, type State, type Unit } from './share'

type Copy = (text: string, what: string) => Promise<void>

interface Props {
  state: State
  set: (patch: Partial<State>) => void
  copy: Copy
}

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

/** The amount box: whole numbers, Devanagari digits allowed. */
const MAX_AMOUNT: Record<Unit, number> = { days: 100000, weeks: 10000, months: 1200, years: 100 }

export function DateMath({ state, set, copy }: Props) {
  return (
    <div className="ndate-math">
      <section className="ndate-card" aria-labelledby="ndate-between-title">
        <h2 id="ndate-between-title">Days between two dates</h2>
        <div className="ndate-pair">
          <DateField label="From" value={state.from} onChange={(from) => set({ from })} />
          <button type="button" className="ndate-swap" aria-label="Swap the two dates" title="Swap"
            onClick={() => set({ from: state.to, to: state.from })}>
            <span className="material-symbols-outlined" aria-hidden>swap_horiz</span>
          </button>
          <DateField label="To" value={state.to} onChange={(to) => set({ to })} />
        </div>
        <Between from={state.from} to={state.to} copy={copy} />
      </section>

      <section className="ndate-card" aria-labelledby="ndate-add-title">
        <h2 id="ndate-add-title">Add or subtract a period</h2>
        <DateField label="Start" value={state.base} onChange={(base) => set({ base })} />
        <div className="ndate-add-row">
          <div className="ndate-seg" role="radiogroup" aria-label="Operation">
            <button type="button" role="radio" aria-checked={state.op === 'add'} className={state.op === 'add' ? 'on' : ''} onClick={() => set({ op: 'add' })}>+ Add</button>
            <button type="button" role="radio" aria-checked={state.op === 'sub'} className={state.op === 'sub' ? 'on' : ''} onClick={() => set({ op: 'sub' })}>− Subtract</button>
          </div>
          <input className="ndate-amount" inputMode="numeric" value={state.amount} onChange={(event) => set({ amount: event.target.value })}
            aria-label="How many" spellCheck={false} autoComplete="off" />
          <select value={state.unit} onChange={(event) => set({ unit: event.target.value as Unit })} aria-label="Unit">
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <Added state={state} copy={copy} />
      </section>

      <section className="ndate-help" aria-label="How the counting works">
        <div>
          <h2>Counting days</h2>
          <p>
            Adding <em>N</em> days gives the date <em>N</em> days later: the start date is day 0. Rules that say “within <em>N</em> days
            from” a date differ on whether that date counts, so where it matters the result also shows the last day when the start
            date counts as day 1. Between two dates, the plain count excludes the first date; “counting both ends” includes it.
          </p>
        </div>
        <div>
          <h2>Months and years</h2>
          <p>
            Months and years are BS months and years, whose lengths vary (29–32 days). Adding months keeps the day of the month and
            moves to the last day of a shorter month when needed. The BS breakdown counts the most whole months that fit after the
            earlier date, then the days left. Saturdays are counted; public holidays are announced year by year and are not known here.
          </p>
        </div>
      </section>
    </div>
  )
}

function Between({ from, to, copy }: { from: number; to: number; copy: Copy }) {
  const s = span(from, to)!
  const abs = Math.abs(s.days)
  const breakdown = [plural(s.years, 'year'), plural(s.months, 'month'), plural(s.restDays, 'day')].filter((t) => !t.startsWith('0 ')).join(', ') || '0 days'
  const stats = [
    { label: 'Days', value: `${s.days < 0 ? '−' : ''}${abs.toLocaleString('en-US')}` },
    { label: 'Counting both ends', value: (abs + 1).toLocaleString('en-US') },
    { label: 'Weeks', value: `${Math.floor(abs / 7)} w ${abs % 7} d` },
    { label: 'Saturdays', value: String(s.saturdays) },
    { label: 'Without Saturdays', value: (abs - s.saturdays).toLocaleString('en-US') },
  ]
  return (
    <div className="ndate-results" aria-live="polite">
      <div className="ndate-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="ndate-stat"><span className="ndate-label">{stat.label}</span><strong>{stat.value}</strong></div>
        ))}
      </div>
      <p className="ndate-line">
        <span>In the BS calendar: <strong>{breakdown}</strong>{s.days < 0 ? ' (the second date is earlier)' : ''}</span>
        <button type="button" onClick={() => void copy(String(s.days), 'Day count')} aria-label="Copy the day count" title="Copy">
          <span className="material-symbols-outlined" aria-hidden>content_copy</span>
        </button>
      </p>
      {s.clamped && (
        <p className="ndate-note">The earlier date is past the end of a later, shorter month, so a whole month from it ends on that month’s last day.</p>
      )}
    </div>
  )
}

function Added({ state, copy }: { state: State; copy: Copy }) {
  const text = asciiDigits(state.amount).trim()
  if (!/^\d+$/.test(text)) return <p className="ndate-error" role="alert">Enter a whole number.</p>
  const amount = Number(text)
  if (amount > MAX_AMOUNT[state.unit]) return <p className="ndate-error" role="alert">At most {MAX_AMOUNT[state.unit].toLocaleString('en-US')} {state.unit}.</p>
  const sign = state.op === 'add' ? 1 : -1

  let result: number
  let clamped = false
  if (state.unit === 'days' || state.unit === 'weeks') {
    result = state.base + sign * amount * (state.unit === 'weeks' ? 7 : 1)
  } else {
    const step = addBsMonths(dayToBs(state.base)!, sign * amount * (state.unit === 'years' ? 12 : 1))
    if (!step) {
      return (
        <p className="ndate-error" role="alert">
          That lands outside 2000–2083 BS, where no approved calendar is available yet, so BS months cannot be counted. A period in
          days still works.
        </p>
      )
    }
    result = bsToDay(step.date)!
    clamped = step.clamped
  }

  const bs = dayToBs(result)
  const ad = dayToAd(result)
  const day = WEEKDAYS[weekday(result)]
  const dayOne = state.op === 'add' && (state.unit === 'days' || state.unit === 'weeks') && amount > 0 ? result - 1 : null
  return (
    <div className="ndate-results" aria-live="polite">
      <dl className="ndate-facts">
        <div>
          <dt>BS</dt>
          <dd>
            {bs ? (
              <>
                <span>{day.en}, {longBs(bs)} · {isoDate(bs)}</span>
                <button type="button" onClick={() => void copy(isoDate(bs), 'BS date')} aria-label="Copy the BS date" title="Copy">
                  <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                </button>
              </>
            ) : (
              <span className="ndate-muted">{result > LAST_DAY ? 'After' : 'Before'} 2000–2083 BS — no approved calendar to name it in BS yet</span>
            )}
          </dd>
        </div>
        {bs && <div><dt>Nepali</dt><dd lang="ne">{nepaliBs(bs)}, {day.ne}</dd></div>}
        <div>
          <dt>AD</dt>
          <dd>
            <span>{day.en}, {longAd(ad)} · {isoDate(ad)}</span>
            <button type="button" onClick={() => void copy(isoDate(ad), 'AD date')} aria-label="Copy the AD date" title="Copy">
              <span className="material-symbols-outlined" aria-hidden>content_copy</span>
            </button>
          </dd>
        </div>
      </dl>
      {weekday(result) === 6 && <p className="ndate-note">This date is a Saturday.</p>}
      {clamped && <p className="ndate-note">The start day does not exist in the target month, so the result is that month’s last day.</p>}
      {dayOne !== null && (
        <p className="ndate-muted">
          If the start date counts as day 1, day {amount * (state.unit === 'weeks' ? 7 : 1)} is one day earlier:{' '}
          {dayToBs(dayOne) ? `${longBs(dayToBs(dayOne)!)} · ` : ''}{longAd(dayToAd(dayOne))} ({WEEKDAYS[weekday(dayOne)].en}).
        </p>
      )}
    </div>
  )
}
