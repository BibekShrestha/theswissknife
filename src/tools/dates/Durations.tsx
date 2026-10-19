import { useEffect, useMemo, useState } from 'react'
import {
  addDuration, breakdownToDuration, businessDays, calendarDifference, exactDuration, explainDuration,
  exactHoursDuration, formatDuration, joinEnglish, parseDuration, type AddOutcome,
} from './duration'
import { durationsHash, type DurationsState } from './share'
import { localZone, ZonePicker } from './ZonePicker'
import {
  DAY, formatLocalDateTime, formatOffset, hhmmss, HOUR, isoDate, longDate, MINUTE, offsetMinutes, parseLocalDateTime,
  resolveWall, wallAt, type Resolved,
} from './zone'

const EXAMPLES = ['P1D', 'PT24H', 'P1M', 'P1W', 'PT90M', 'P1Y2M10DT2H30M', '-P1D']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function defaults(): DurationsState {
  const now = wallAt(Date.now(), localZone)
  const start = { ...now, hour: 9, minute: 0, second: 0, ms: 0 }
  const end = { ...start, ...addMonthsSimple(now, 1), hour: 17 }
  return {
    start: formatLocalDateTime(start),
    startZone: localZone,
    end: formatLocalDateTime(end),
    endZone: localZone,
    iso: 'P1M',
    base: formatLocalDateTime({ ...start, day: 31, month: 1 }),
    baseZone: localZone,
    op: 'add',
  }
}

function addMonthsSimple(d: { year: number, month: number }, n: number) {
  const index = d.year * 12 + d.month - 1 + n
  return { year: Math.floor(index / 12), month: (index % 12) + 1, day: 1 }
}

function monthWords(years: number, months: number): string {
  return joinEnglish([
    ...(years ? [`${fmtNumber(years)} year${years === 1 ? '' : 's'}`] : []),
    ...(months ? [`${months} month${months === 1 ? '' : 's'}`] : []),
  ])
}

const fmtNumber = (n: number, digits = 4) => n.toLocaleString('en-US', { maximumFractionDigits: digits })

interface Point { ms: number, resolved: Resolved }

function point(text: string, zone: string): Point | null {
  const wall = parseLocalDateTime(text)
  if (!wall) return null
  const resolved = resolveWall(wall, zone)
  return { ms: resolved.ms, resolved }
}

function nowText(zone: string): string {
  return formatLocalDateTime({ ...wallAt(Date.now(), zone), ms: 0 })
}

function describeOutcome(o: AddOutcome, zone: string): string {
  return `${longDate(o.wall)} ${hhmmss(o.wall)} ${formatOffset(offsetMinutes(o.ms, zone))}`
}

interface DurationsProps {
  initial: Partial<DurationsState>
  active: boolean
  copy: (text: string, what: string) => Promise<void>
}

export function Durations({ initial, active, copy }: DurationsProps) {
  const [state, setState] = useState<DurationsState>(() => ({ ...defaults(), ...initial }))
  const set = <K extends keyof DurationsState>(key: K, value: DurationsState[K]) => setState((s) => ({ ...s, [key]: value }))

  useEffect(() => {
    if (!active) return
    const hash = durationsHash(state)
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [active, state])

  const a = point(state.start, state.startZone)
  const b = point(state.end, state.endZone)

  return (
    <div className="dates-durations">
      <section className="dates-card" aria-labelledby="dates-diff-title">
        <h2 id="dates-diff-title">Difference between two date-times</h2>
        <div className="dates-pair">
          <DateTimeField label="Start" value={state.start} zone={state.startZone} invalid={!a}
            onValue={(v) => set('start', v)} onZone={(z) => set('startZone', z)} onNow={() => set('start', nowText(state.startZone))} />
          <button type="button" className="dates-swap" aria-label="Swap start and end" title="Swap start and end"
            onClick={() => setState((s) => ({ ...s, start: s.end, startZone: s.endZone, end: s.start, endZone: s.startZone }))}>
            <span className="material-symbols-outlined" aria-hidden>swap_horiz</span>
          </button>
          <DateTimeField label="End" value={state.end} zone={state.endZone} invalid={!b}
            onValue={(v) => set('end', v)} onZone={(z) => set('endZone', z)} onNow={() => set('end', nowText(state.endZone))} />
        </div>
        {a && b ? <Difference a={a} b={b} startZone={state.startZone} endZone={state.endZone} startText={state.start} endText={state.end} copy={copy} />
          : <p className="dates-error" role="alert">Enter both date-times.</p>}
      </section>

      <section className="dates-card" aria-labelledby="dates-add-title">
        <h2 id="dates-add-title">Add or subtract an ISO 8601 duration</h2>
        <div className="dates-pair">
          <DateTimeField label="From" value={state.base} zone={state.baseZone} invalid={!parseLocalDateTime(state.base)}
            onValue={(v) => set('base', v)} onZone={(z) => set('baseZone', z)} onNow={() => set('base', nowText(state.baseZone))} />
        </div>
        <div className="dates-row dates-add-row">
          <div className="dates-seg" role="radiogroup" aria-label="Operation">
            <button type="button" role="radio" aria-checked={state.op === 'add'} className={state.op === 'add' ? 'on' : ''} onClick={() => set('op', 'add')}>+ Add</button>
            <button type="button" role="radio" aria-checked={state.op === 'sub'} className={state.op === 'sub' ? 'on' : ''} onClick={() => set('op', 'sub')}>− Subtract</button>
          </div>
          <input type="text" className="dates-iso mono" value={state.iso} onChange={(e) => set('iso', e.target.value)}
            aria-label="ISO 8601 duration" placeholder="P1DT2H" spellCheck={false} autoComplete="off" autoCapitalize="characters" />
        </div>
        <div className="dates-examples" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className={ex === state.iso.trim() ? 'on' : ''} onClick={() => set('iso', ex)}><code>{ex}</code></button>
          ))}
        </div>
        <AddResultView base={state.base} zone={state.baseZone} iso={state.iso} op={state.op} copy={copy} />
      </section>

      <section className="dates-help" aria-label="How this works">
        <div>
          <h2>Calendar vs exact</h2>
          <p>
            Years, months, weeks and days are <em>calendar</em> units: <code>P1D</code> moves the date by one and keeps the wall-clock
            time, so across a daylight-saving change it is 23 or 25 real hours. Hours, minutes and seconds are <em>exact</em>:{' '}
            <code>PT24H</code> is always 24 × 3600 seconds. Additions apply years and months first, then weeks and days, then the
            time part. Adding months clamps to the end of a shorter month (31 January + <code>P1M</code> = 28 or 29 February).
            A wall time skipped by a clock change moves forward by the gap; one that happens twice uses the earlier occurrence.
          </p>
        </div>
        <div>
          <h2>Conventions</h2>
          <p>
            The calendar breakdown counts on the start zone’s wall clock: the most whole months that fit, then whole days, then
            the exact remainder — so 31 January to 28 February is one month. Business days count Monday to Friday after the
            start date up to and including the end date (each date as entered); public holidays are not known.
            Durations accept a fraction on the last component (<code>PT1.5H</code>, with <code>.</code> or <code>,</code>) and a
            leading minus sign; a fractional day or week is added as exact hours.
          </p>
        </div>
      </section>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  zone: string
  invalid: boolean
  onValue: (v: string) => void
  onZone: (z: string) => void
  onNow: () => void
}

function DateTimeField({ label, value, zone, invalid, onValue, onZone, onNow }: FieldProps) {
  const at = point(value, zone)?.ms ?? Date.now()
  return (
    <fieldset className="dates-field">
      <legend className="dates-label">{label}</legend>
      <div className="dates-row">
        <input type="datetime-local" step={1} value={value} aria-invalid={invalid} aria-label={`${label} date and time`}
          onChange={(e) => e.target.value && onValue(e.target.value)} />
        <button type="button" onClick={onNow}>Now</button>
      </div>
      <ZonePicker label={`${label} time zone`} value={zone} at={at} onPick={onZone} />
    </fieldset>
  )
}

interface DifferenceProps {
  a: Point
  b: Point
  startZone: string
  endZone: string
  startText: string
  endText: string
  copy: (text: string, what: string) => Promise<void>
}

function Difference({ a, b, startZone, endZone, startText, endText, copy }: DifferenceProps) {
  const total = b.ms - a.ms
  const breakdown = useMemo(() => calendarDifference(a.ms, b.ms, startZone), [a.ms, b.ms, startZone])
  const calendarIso = formatDuration(breakdownToDuration(breakdown))
  const exactIso = formatDuration(exactDuration(total))
  const startDate = parseLocalDateTime(startText)!
  const endDate = parseLocalDateTime(endText)!
  const business = businessDays(startDate, endDate)
  const abs = Math.abs(total)
  const sign = total < 0 ? '−' : ''
  const exactParts = [
    [Math.floor(abs / DAY), 'd'], [Math.floor((abs % DAY) / HOUR), 'h'], [Math.floor((abs % HOUR) / MINUTE), 'min'], [(abs % MINUTE) / 1000, 's'],
  ] as const
  const calendarWords = joinEnglish(([
    ['years', breakdown.years], ['months', breakdown.months], ['days', breakdown.days], ['hours', breakdown.hours],
    ['minutes', breakdown.minutes], ['seconds', breakdown.seconds + breakdown.milliseconds / 1000],
  ] as const).filter(([, n]) => n).map(([unit, n]) => `${fmtNumber(n, 3)} ${n === 1 ? unit.slice(0, -1) : unit}`)) || 'nothing'
  const offA = offsetMinutes(a.ms, startZone)
  const offB = offsetMinutes(b.ms, startZone)
  const endInStart = wallAt(b.ms, startZone)

  return (
    <div className="dates-results">
      <div className="dates-stats">
        <Stat label="Days (24 h)" value={`${sign}${fmtNumber(abs / DAY)}`} />
        <Stat label="Hours" value={`${sign}${fmtNumber(abs / HOUR)}`} />
        <Stat label="Minutes" value={`${sign}${fmtNumber(abs / MINUTE)}`} />
        <Stat label="Seconds" value={`${sign}${fmtNumber(abs / 1000, 3)}`} />
        <Stat label="Business days" value={String(business)} />
      </div>
      <dl className="dates-facts">
        <dt>Exact</dt>
        <dd className="mono">{sign}{exactParts.filter(([n], i) => n || (i === 3 && abs < 1000)).map(([n, u]) => `${fmtNumber(n, 3)} ${u}`).join(' ')}</dd>
        <dt>Calendar</dt>
        <dd>{breakdown.sign < 0 && total !== 0 ? 'Minus ' : ''}{calendarWords}</dd>
        <dt>ISO 8601</dt>
        <dd className="dates-iso-out">
          <code>{calendarIso}</code> <small>calendar</small>
          <button type="button" onClick={() => void copy(calendarIso, 'Calendar duration')} aria-label="Copy calendar duration">
            <span className="material-symbols-outlined" aria-hidden>content_copy</span>
          </button>
          <code>{exactIso}</code> <small>exact</small>
          <button type="button" onClick={() => void copy(exactIso, 'Exact duration')} aria-label="Copy exact duration">
            <span className="material-symbols-outlined" aria-hidden>content_copy</span>
          </button>
        </dd>
        <dt>Instants</dt>
        <dd className="mono dates-small">{new Date(a.ms).toISOString()} → {new Date(b.ms).toISOString()}</dd>
      </dl>
      {startZone !== endZone && (
        <p className="dates-note">
          The zones differ, so the calendar breakdown is counted on {startZone}’s wall clock, where the end is{' '}
          <span className="mono">{isoDate(endInStart)} {hhmmss(endInStart)}</span>. Business days use each date as entered.
        </p>
      )}
      {offA !== offB && (
        <p className="dates-note">
          {startZone}’s UTC offset changes in this span ({formatOffset(offA)} → {formatOffset(offB)}), so calendar days and
          24-hour days differ: the calendar count keeps the wall clock, the exact count does not.
        </p>
      )}
      {[a, b].map((p, i) => p.resolved.kind !== 'ok' && (
        <p className="dates-note" key={i}>
          {i === 0 ? 'Start' : 'End'}: {p.resolved.kind === 'gap'
            ? `that wall time does not exist in ${i === 0 ? startZone : endZone} (clocks jump ${p.resolved.gapMinutes} min), so it was moved forward to ${hhmmss(wallAt(p.ms, i === 0 ? startZone : endZone))}.`
            : `that wall time happens twice in ${i === 0 ? startZone : endZone}; the earlier occurrence (${formatOffset(offsetMinutes(p.ms, i === 0 ? startZone : endZone))}) is used.`}
        </p>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string, value: string }) {
  return (
    <div className="dates-stat">
      <span className="dates-label">{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  )
}

interface AddViewProps {
  base: string
  zone: string
  iso: string
  op: 'add' | 'sub'
  copy: (text: string, what: string) => Promise<void>
}

function AddResultView({ base, zone, iso, op, copy }: AddViewProps) {
  const parsed = parseDuration(iso)
  const start = point(base, zone)
  if (!parsed.ok) return <p className="dates-error" role="alert">{parsed.error}</p>
  if (!start) return <p className="dates-error" role="alert">Enter a date-time to add to.</p>
  const d = parsed.duration
  const result = addDuration(start.ms, zone, d, op === 'add' ? 1 : -1)
  const startWall = wallAt(start.ms, zone)
  const forward = d.sign * (op === 'add' ? 1 : -1) > 0
  return (
    <div className="dates-results">
      <p className="dates-explain"><strong>{formatDuration(d)}</strong> — {explainDuration(d)}</p>
      {!result.ok ? <p className="dates-error" role="alert">{result.error}</p> : (
        <>
          <dl className="dates-facts">
            <dt>{d.years || d.months || d.weeks || d.days ? 'Calendar' : 'Result'}</dt>
            <dd>
              <span className="mono">{describeOutcome(result.calendar, zone)}</span>
              <button type="button" onClick={() => void copy(new Date(result.calendar.ms).toISOString(), 'Result')} aria-label="Copy result as UTC ISO timestamp">
                <span className="material-symbols-outlined" aria-hidden>content_copy</span>
              </button>
              <small className="mono dates-small"> {new Date(result.calendar.ms).toISOString()}</small>
            </dd>
            {result.exact && result.exact.ms !== result.calendar.ms && (
              <>
                <dt>Exact</dt>
                <dd>
                  <span className="mono">{describeOutcome(result.exact, zone)}</span>
                  <small className="mono dates-small"> {new Date(result.exact.ms).toISOString()}</small>
                </dd>
              </>
            )}
          </dl>
          {result.exact && result.exact.ms !== result.calendar.ms && (
            <p className="dates-note">
              These differ because the UTC offset in {zone} changes in between. <strong>Calendar</strong> keeps the wall-clock time
              ({fmtNumber(Math.abs(result.calendar.ms - start.ms) / HOUR)} real hours); <strong>exact</strong> treats each day as 24 hours
              ({fmtNumber(Math.abs(result.exact.ms - start.ms) / HOUR)} hours). Write <code>{exactHoursDuration(d)}</code> if
              you mean exact hours.
            </p>
          )}
          {!result.exact && (
            <p className="dates-muted">Years and months have no fixed length, so only the calendar result applies.</p>
          )}
          {result.clamped && (
            <p className="dates-note">
              <strong>Month-end clamping:</strong> {startWall.day} {MONTH_NAMES[startWall.month - 1]} {forward ? '+' : '−'} {monthWords(d.years, d.months)} would
              land on {result.clamped.from.day} {MONTH_NAMES[result.clamped.from.month - 1]}, which does not exist — clamped to {result.clamped.to.day} {MONTH_NAMES[result.clamped.to.month - 1]} {result.clamped.to.year}{d.weeks || d.days || d.hours || d.minutes || d.seconds ? ', then the rest of the duration is added' : ''}.
            </p>
          )}
          {result.gapMinutes !== undefined && (
            <p className="dates-note">The calendar step landed in a daylight-saving gap in {zone} (clocks jump {result.gapMinutes} min), so the time was moved forward by {result.gapMinutes} min.</p>
          )}
          {result.fold && (
            <p className="dates-note">The calendar step landed on a wall time that happens twice in {zone}; the earlier occurrence is used.</p>
          )}
          {result.fractionalDayMs !== undefined && (
            <p className="dates-note">The fractional day part was added as {fmtNumber(result.fractionalDayMs / HOUR)} exact hours after the whole days.</p>
          )}
        </>
      )}
    </div>
  )
}
