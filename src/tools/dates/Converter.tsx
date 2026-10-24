import { useEffect, useMemo, useState } from 'react'
import { zoneCity } from './catalog'
import {
  dayShiftLabel, describeTransition, formatDiff, nextTransition, PERIOD_LABEL, readingLine, readings, readingsText,
  type ZoneReading,
} from './convert'
import { converterHash, MAX_ZONES, type ConverterState } from './share'
import { ALL_ZONES, localZone, ZonePicker } from './ZonePicker'
import {
  formatOffset, hhmm, HOUR, isoDate, longDate, MINUTE, offsetMinutes, parseIsoDate, resolveWall, wallAt, type Resolved, type Wall,
} from './zone'

function defaultZones(): string[] {
  const picks = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo']
    .filter((z) => z !== localZone && ALL_ZONES.includes(z))
  return [localZone, ...picks.slice(0, 4)]
}

const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE

/** The last time typed into a row, kept to explain a skipped or repeated clock reading. */
interface Edit {
  zone: string
  wall: Wall
  resolved: Resolved
  /** The other occurrence of a repeated time. */
  later?: number
}

interface ConverterProps {
  initial: Partial<ConverterState>
  active: boolean
  copy: (text: string, what: string) => Promise<void>
}

export function Converter({ initial, active, copy }: ConverterProps) {
  const [zones, setZones] = useState<string[]>(() => initial.zones ?? defaultZones())
  const [at, setAt] = useState(() => initial.at ?? minuteNow())
  const [live, setLive] = useState(() => initial.at == null)
  const [edit, setEdit] = useState<Edit | null>(null)

  // Live mode follows the clock to the minute.
  useEffect(() => {
    if (!live) return
    setAt(minuteNow())
    const timer = window.setInterval(() => setAt(minuteNow()), 1000)
    return () => window.clearInterval(timer)
  }, [live])

  useEffect(() => {
    if (!active) return
    const hash = converterHash({ zones, at: live ? null : at })
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [active, zones, at, live])

  const list = useMemo(() => readings(at, zones), [at, zones])
  const ref = list[0]

  const setInstant = (ms: number) => {
    setLive(false)
    setEdit(null)
    setAt(ms)
  }

  /** A date or time typed into a row: that zone's clock reading becomes the instant. */
  const setWall = (zone: string, wall: Wall) => {
    const resolved = resolveWall(wall, zone)
    const later = resolved.kind === 'fold' ? resolveWall(wall, zone, 'later').ms : undefined
    setLive(false)
    setAt(resolved.ms)
    setEdit(resolved.kind === 'ok' ? null : { zone, wall, resolved, later })
  }

  const onDate = (r: ZoneReading, value: string) => {
    const date = parseIsoDate(value)
    if (date) setWall(r.zone, { ...r.wall, ...date, second: 0, ms: 0 })
  }
  const onTime = (r: ZoneReading, value: string) => {
    const m = /^(\d{2}):(\d{2})/.exec(value)
    if (m) setWall(r.zone, { ...r.wall, hour: Number(m[1]), minute: Number(m[2]), second: 0, ms: 0 })
  }

  const makeReference = (i: number) => setZones((z) => [z[i], ...z.filter((_, j) => j !== i)])
  const remove = (i: number) => setZones((z) => z.filter((_, j) => j !== i))

  const refMinutes = ref ? ref.wall.hour * 60 + ref.wall.minute : 0

  return (
    <div className="dates-conv">
      <section className="dates-conv-bar" aria-label="Time controls">
        <div className="dates-row">
          {live
            ? <span className="dates-live" role="status"><i aria-hidden /> Live — following the clock</span>
            : <button type="button" onClick={() => { setEdit(null); setLive(true) }}>Now</button>}
          <button type="button" onClick={() => setInstant(at - HOUR)} aria-label="One hour earlier">−1 h</button>
          <button type="button" onClick={() => setInstant(at + HOUR)} aria-label="One hour later">+1 h</button>
          <button type="button" onClick={() => setInstant(at - 24 * HOUR)} aria-label="One day earlier">−1 day</button>
          <button type="button" onClick={() => setInstant(at + 24 * HOUR)} aria-label="One day later">+1 day</button>
        </div>
        {ref && (
          <label className="dates-conv-scrub">
            <span className="dates-label">Time in {zoneCity(ref.zone)}</span>
            <input
              type="range"
              min={0}
              max={1425}
              step={15}
              value={Math.round(refMinutes / 15) * 15}
              onChange={(e) => {
                const m = Number(e.target.value)
                setWall(ref.zone, { ...ref.wall, hour: Math.floor(m / 60), minute: m % 60, second: 0, ms: 0 })
              }}
              aria-valuetext={`${hhmm(ref.wall)} in ${zoneCity(ref.zone)}`}
            />
            <span className="dates-conv-ticks" aria-hidden><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></span>
          </label>
        )}
        <button type="button" disabled={!list.length} onClick={() => void copy(readingsText(at, list), 'All times')}>
          <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy all
        </button>
      </section>

      {edit && (
        <p className="dates-note" role="status">
          {edit.resolved.kind === 'gap'
            ? <>{hhmm(edit.wall)} on {longDate(edit.wall)} does not exist in {edit.zone} — clocks jump forward
              {' '}{formatDiff(edit.resolved.gapMinutes ?? 60).slice(1)} there. Showing {hhmm(wallAt(edit.resolved.ms, edit.zone))} instead.</>
            : <>{hhmm(edit.wall)} on {longDate(edit.wall)} happens twice in {edit.zone} — clocks go back that night.
              {' '}Showing the {at === edit.later ? 'second' : 'first'} one ({formatOffset(offsetMinutes(at, edit.zone))}).
              {' '}{edit.later !== undefined && (
                <button type="button" className="dates-link" onClick={() => setAt(at === edit.later ? edit.resolved.ms : edit.later!)}>
                  Use the {at === edit.later ? 'first' : 'second'}
                </button>
              )}</>}
        </p>
      )}

      <ul className="dates-conv-list" aria-label="Time in each zone">
        {list.map((r, i) => (
          <Row
            key={r.zone}
            reading={r}
            at={at}
            isRef={i === 0}
            refCity={ref ? zoneCity(ref.zone) : ''}
            canRemove={list.length > 1}
            onDate={(v) => onDate(r, v)}
            onTime={(v) => onTime(r, v)}
            onCopy={() => void copy(readingLine(r), zoneCity(r.zone))}
            onReference={() => makeReference(i)}
            onRemove={() => remove(i)}
          />
        ))}
      </ul>

      <div className="dates-add">
        {zones.length < MAX_ZONES
          ? <ZonePicker label="Add a time zone" placeholder="Add a zone — city, country or abbreviation (PST, CET, IST)…" at={at} exclude={zones} onPick={(z) => setZones((list) => [...list, z])} />
          : <span className="dates-muted">Up to {MAX_ZONES} zones.</span>}
      </div>
      <p className="dates-hint">
        Edit the date or time in any row to convert from that zone. Day and offset differences are measured from the
        first row (the reference); a row’s “Make reference” button measures from that zone instead. Times are exact wall-clock readings from your browser’s time zone data, including
        daylight saving.
      </p>
    </div>
  )
}

interface RowProps {
  reading: ZoneReading
  at: number
  isRef: boolean
  refCity: string
  canRemove: boolean
  onDate: (value: string) => void
  onTime: (value: string) => void
  onCopy: () => void
  onReference: () => void
  onRemove: () => void
}

function Row({ reading: r, at, isRef, refCity, canRemove, onDate, onTime, onCopy, onReference, onRemove }: RowProps) {
  const city = zoneCity(r.zone)
  const transition = useMemo(() => nextTransition(at, r.zone), [at, r.zone])
  return (
    <li className={`dates-conv-row${isRef ? ' dates-conv-ref' : ''}`}>
      <div className="dates-conv-zone">
        <div className="dates-conv-name">
          <strong>{city}</strong>
          {r.abbreviation && <span className="dates-conv-abbr mono">{r.abbreviation}</span>}
          {isRef && <span className="dates-ref">reference</span>}
        </div>
        <span className="dates-conv-id mono">{r.zone} · {formatOffset(r.offsetMinutes)}</span>
      </div>
      <div className="dates-conv-when">
        <input type="date" value={isoDate(r.wall)} onChange={(e) => onDate(e.target.value)} aria-label={`Date in ${city}`} />
        <input type="time" value={hhmm(r.wall)} onChange={(e) => onTime(e.target.value)} aria-label={`Time in ${city}`} />
      </div>
      <div className="dates-conv-meta">
        <span className="dates-conv-day">{longDate(r.wall).slice(0, 3)}</span>
        {r.dayShift !== 0 && <span className="dates-badge">{dayShiftLabel(r.dayShift)}</span>}
        {!isRef && <span className="dates-conv-diff mono" title={`Offset compared with ${refCity}`}>{formatDiff(r.diffMinutes)}</span>}
        <span className={`dates-conv-period dates-conv-${r.period}`}><i aria-hidden />{PERIOD_LABEL[r.period]}</span>
      </div>
      <div className="dates-conv-actions">
        <button type="button" onClick={onCopy} title="Copy" aria-label={`Copy the time in ${city}`}>
          <span className="material-symbols-outlined" aria-hidden>content_copy</span>
        </button>
        {!isRef && (
          <button type="button" onClick={onReference} title="Make reference" aria-label={`Make ${city} the reference zone`}>
            <span className="material-symbols-outlined" aria-hidden>vertical_align_top</span>
          </button>
        )}
        <button type="button" onClick={onRemove} disabled={!canRemove} title="Remove" aria-label={`Remove ${city}`}>
          <span className="material-symbols-outlined" aria-hidden>close</span>
        </button>
      </div>
      {transition && <p className="dates-conv-dst">{describeTransition(transition, r.zone)}</p>}
    </li>
  )
}
