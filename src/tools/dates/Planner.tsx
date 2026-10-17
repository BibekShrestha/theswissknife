import { useEffect, useMemo, useRef, useState } from 'react'
import { buildIcs } from './ics'
import {
  buildRow, buildTimeline, dayShiftLabel, meetingText, meetingTimes, overlap, ranges, SLOT_MINUTES, SLOT_MS,
  type ZoneRow,
} from './timeline'
import { MAX_ZONES, MEETING_LENGTHS, plannerHash, type PlannerState } from './share'
import { ALL_ZONES, localZone, ZonePicker } from './ZonePicker'
import { zoneCity } from './catalog'
import { addDays, formatOffset, hhmm, isoDate, longDate, parseIsoDate, wallAt } from './zone'

const SLOT_PX = 12

function defaultZones(): string[] {
  const picks = ['America/New_York', 'Europe/London', 'Asia/Kolkata'].filter((z) => z !== localZone && ALL_ZONES.includes(z))
  return [localZone, ...picks.slice(0, 2)]
}

function today(): string {
  return isoDate(wallAt(Date.now(), localZone))
}

const HOURS = Array.from({ length: 25 }, (_, i) => i)
const pad = (n: number) => String(n).padStart(2, '0')
const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`)

interface PlannerProps {
  initial: Partial<PlannerState>
  active: boolean
  copy: (text: string, what: string) => Promise<void>
  showToast: (msg: string) => void
}

export function Planner({ initial, active, copy, showToast }: PlannerProps) {
  const [zones, setZones] = useState<string[]>(() => initial.zones ?? defaultZones())
  const [date, setDate] = useState(() => initial.date ?? today())
  const [work, setWork] = useState<[number, number]>(() => initial.work ?? [9, 17])
  const [len, setLen] = useState(() => initial.len ?? 60)
  const [sel, setSel] = useState<[number, number] | null>(() => initial.sel ?? null)
  const [title, setTitle] = useState('')
  const autoSelected = useRef(initial.sel != null)

  const plainDate = parseIsoDate(date) ?? parseIsoDate(today())!
  const timeline = useMemo(() => buildTimeline(plainDate, zones[0]), [date, zones[0]]) // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => ({ start: work[0] * 60, end: work[1] * 60 }), [work])
  const rows = useMemo(() => zones.map((z) => buildRow(timeline, z, hours)), [timeline, zones, hours])
  const shared = useMemo(() => overlap(rows, timeline.slots), [rows, timeline.slots])
  const sharedRanges = useMemo(() => ranges(shared), [shared])

  const clampedSel = sel ? clampSel(sel, timeline.slots) : null

  useEffect(() => {
    if (autoSelected.current) return
    autoSelected.current = true
    const first = sharedRanges[0]
    if (first) setSel([first[0], Math.min(first[0] + len / SLOT_MINUTES, timeline.slots)])
  }, [sharedRanges, len, timeline.slots])

  useEffect(() => {
    if (!active) return
    const hash = plannerHash({ zones, date, work, len, sel: clampedSel })
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [active, zones, date, work, len, clampedSel?.[0], clampedSel?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the selection (or the working morning) into view when the day changes.
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstSlot = clampedSel?.[0]
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = Math.max(0, ((firstSlot ?? work[0] * 4) - 4) * SLOT_PX)
  }, [timeline.start, firstSlot === undefined]) // eslint-disable-line react-hooks/exhaustive-deps

  const startMs = clampedSel ? timeline.start + clampedSel[0] * SLOT_MS : 0
  const endMs = clampedSel ? timeline.start + clampedSel[1] * SLOT_MS : 0
  const times = clampedSel ? meetingTimes(timeline, zones, startMs, endMs) : []

  const moveZone = (i: number, to: number) => setZones((list) => {
    const next = [...list]
    const [z] = next.splice(i, 1)
    next.splice(to, 0, z)
    return next
  })

  const shiftDate = (days: number) => setDate(isoDate(addDays(plainDate, days)))

  const nudge = (slots: number) => setSel((current) => {
    const s = current ? clampSel(current, timeline.slots) : [0, len / SLOT_MINUTES] as [number, number]
    const width = s[1] - s[0]
    const from = Math.max(0, Math.min(timeline.slots - width, s[0] + slots))
    return [from, from + width]
  })

  const downloadIcs = () => {
    if (!clampedSel) return
    const text = meetingText(times, startMs, endMs, title)
    const ics = buildIcs({
      uid: `${crypto.randomUUID()}@theswissknife.com`,
      stamp: Date.now(),
      start: startMs,
      end: endMs,
      summary: title.trim() || 'Meeting',
      description: text.split('\n').slice(1).join('\n'),
    })
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `meeting-${new Date(startMs).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')}.ics`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('Calendar file downloaded')
  }

  const ref = timeline.zone
  const refDay = timeline.slots / 4

  return (
    <div className="dates-planner">
      <section className="dates-controls" aria-label="Planner settings">
        <div className="dates-control">
          <span className="dates-label">Date in {zoneCity(ref)}</span>
          <div className="dates-row">
            <button type="button" onClick={() => shiftDate(-1)} aria-label="Previous day">
              <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
            </button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <button type="button" onClick={() => shiftDate(1)} aria-label="Next day">
              <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
            </button>
            <button type="button" onClick={() => setDate(today())}>Today</button>
          </div>
        </div>
        <div className="dates-control">
          <span className="dates-label">Working hours (local, every zone)</span>
          <div className="dates-row">
            <select value={work[0]} onChange={(e) => setWork([Number(e.target.value), work[1]])} aria-label="Working hours start">
              {HOURS.slice(0, 24).map((h) => <option key={h} value={h} disabled={h === work[1]}>{pad(h)}:00</option>)}
            </select>
            <span>to</span>
            <select value={work[1]} onChange={(e) => setWork([work[0], Number(e.target.value)])} aria-label="Working hours end">
              {HOURS.slice(1).map((h) => <option key={h} value={h} disabled={h === work[0]}>{pad(h)}:00</option>)}
            </select>
          </div>
        </div>
        <div className="dates-control">
          <span className="dates-label">Meeting length</span>
          <select value={len} onChange={(e) => {
            const next = Number(e.target.value)
            setLen(next)
            if (clampedSel) setSel(clampSel([clampedSel[0], clampedSel[0] + next / SLOT_MINUTES], timeline.slots))
          }} aria-label="Meeting length">
            {MEETING_LENGTHS.map((m) => <option key={m} value={m}>{lengthLabel(m)}</option>)}
          </select>
        </div>
      </section>

      <section className="dates-zones" aria-label="Zones">
        <div className="dates-strips-scroll" ref={scrollRef}>
          <Strips
            rows={rows}
            slots={timeline.slots}
            shared={sharedRanges}
            sel={clampedSel}
            len={len}
            onSelect={setSel}
            onMove={moveZone}
            onRemove={(i) => setZones((list) => list.filter((_, j) => j !== i))}
          />
        </div>
        <div className="dates-add">
          {zones.length < MAX_ZONES
            ? <ZonePicker label="Add a time zone" placeholder="Add a zone — city, region or abbreviation (PST, CET)…" at={timeline.start} exclude={zones} onPick={(z) => setZones((list) => [...list, z])} />
            : <span className="dates-muted">Up to {MAX_ZONES} zones.</span>}
        </div>
        <p className="dates-hint">
          The first zone is the reference: the strips cover its {refDay === 24 ? '24-hour' : `${refDay}-hour`} day.
          Click to start a {lengthLabel(len)} meeting on that half hour, or drag across slots (mouse) to pick any 15-minute range.
          <span className="dates-legend"><i className="dates-swatch dates-swatch-work" /> working hours <i className="dates-swatch dates-swatch-overlap" /> everyone working</span>
        </p>
        {rows.some((r) => r.transitions.length > 0) && (
          <ul className="dates-transitions">
            {rows.flatMap((r) => r.transitions.map((t) => {
              const diff = t.afterMinutes - t.beforeMinutes
              const amount = Math.abs(diff) % 60 === 0 ? `${Math.abs(diff) / 60} hour${Math.abs(diff) === 60 ? '' : 's'}` : `${Math.abs(diff)} minutes`
              return (
                <li key={`${r.zone}-${t.slot}`}>
                  <strong>{r.zone}</strong>: clocks go {diff > 0 ? 'forward' : 'back'} {amount} at {t.from} → {t.to} local
                  ({formatOffset(t.beforeMinutes)} → {formatOffset(t.afterMinutes)}).
                </li>
              )
            }))}
          </ul>
        )}
      </section>

      <section className="dates-meeting" aria-label="Selected time" aria-live="polite">
        <div className="dates-meeting-head">
          <span className="dates-label">Selected time</span>
          <div className="dates-row dates-nudge">
            <button type="button" onClick={() => nudge(-1)} aria-label="Earlier by 15 minutes">−15 min</button>
            <button type="button" onClick={() => nudge(1)} aria-label="Later by 15 minutes">+15 min</button>
            <button type="button" disabled={!sharedRanges.length} onClick={() => {
              const first = sharedRanges[0]
              if (first) setSel([first[0], Math.min(first[1], first[0] + len / SLOT_MINUTES)])
            }}>Jump to overlap</button>
          </div>
        </div>
        <p className="dates-overlap-text">
          {sharedRanges.length === 0
            ? `No time on this day is inside ${pad(work[0])}:00–${pad(work[1] % 24)}:00 in every zone.`
            : <>Everyone is in working hours {sharedRanges.map(([a, b], i) => {
              const s = wallAt(timeline.start + a * SLOT_MS, ref)
              const e = wallAt(timeline.start + b * SLOT_MS, ref)
              return <span key={a}>{i > 0 && ', '}<strong className="mono">{hhmm(s)}–{hhmm(e)}</strong></span>
            })} {zoneCity(ref)} time.</>}
        </p>
        {clampedSel ? (
          <>
            <ul className="dates-times">
              {times.map((t) => (
                <li key={t.zone}>
                  <span className="dates-times-zone">{zoneCity(t.zone)} <small className="mono">{t.zone}</small></span>
                  <span className="dates-times-when mono">{longDate(t.start)} · {hhmm(t.start)}–{hhmm(t.end)}</span>
                  <span className="dates-times-off mono">
                    {formatOffset(t.offsetMinutes)}{t.endOffsetMinutes !== t.offsetMinutes && ` → ${formatOffset(t.endOffsetMinutes)}`}
                  </span>
                  {t.dayShift !== 0 && <span className="dates-badge">{dayShiftLabel(t.dayShift)}</span>}
                </li>
              ))}
            </ul>
            <div className="dates-row dates-actions">
              <input type="text" className="dates-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title (only used in the copy and .ics)" aria-label="Event title" maxLength={200} />
              <button type="button" onClick={() => void copy(meetingText(times, startMs, endMs, title), 'Meeting times')}>
                <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy times
              </button>
              <button type="button" onClick={downloadIcs}>
                <span className="material-symbols-outlined" aria-hidden>event</span> Download .ics
              </button>
            </div>
            <p className="dates-muted">The .ics event uses UTC start and end times ({new Date(startMs).toISOString().slice(11, 16)}–{new Date(endMs).toISOString().slice(11, 16)} UTC); calendar apps show it in each viewer’s own zone.</p>
          </>
        ) : (
          <p className="dates-muted">Click a slot on the strips to choose a meeting time.</p>
        )}
      </section>
    </div>
  )
}

function clampSel(sel: [number, number], slots: number): [number, number] {
  const from = Math.max(0, Math.min(sel[0], slots - 1))
  const to = Math.max(from + 1, Math.min(sel[1], slots))
  return [from, to]
}

interface StripsProps {
  rows: ZoneRow[]
  slots: number
  shared: [number, number][]
  sel: [number, number] | null
  len: number
  onSelect: (sel: [number, number]) => void
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
}

function Strips({ rows, slots, shared, sel, len, onSelect, onMove, onRemove }: StripsProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ anchor: number, pointer: string, x: number, moved: boolean } | null>(null)
  const width = slots * SLOT_PX
  const lenSlots = len / SLOT_MINUTES

  const slotAt = (clientX: number) => {
    const rect = gridRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(slots - 1, Math.floor((clientX - rect.left) / SLOT_PX)))
  }
  // A click snaps to the half hour (on the reference zone's clock); a drag does not.
  const clickSel = (slot: number): [number, number] => {
    const from = Math.min(slot - (slot % 2), Math.max(0, slots - lenSlots))
    return [from, Math.min(slots, from + lenSlots)]
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.dates-strip-label')) return
    const slot = slotAt(event.clientX)
    drag.current = { anchor: slot, pointer: event.pointerType, x: event.clientX, moved: false }
    if (event.pointerType === 'mouse') {
      event.preventDefault()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      onSelect(clickSel(slot))
    }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(event.clientX - d.x) > 6) d.moved = true
    if (d.pointer !== 'mouse' || !d.moved) return
    const slot = slotAt(event.clientX)
    if (slot === d.anchor) onSelect(clickSel(slot))
    else onSelect([Math.min(slot, d.anchor), Math.max(slot, d.anchor) + 1])
  }
  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag.current) return
    const d = drag.current
    drag.current = null
    if (d && d.pointer !== 'mouse' && !d.moved) onSelect(clickSel(slotAt(event.clientX)))
  }

  return (
    <div
      ref={gridRef}
      className="dates-grid"
      style={{ width, gridTemplateColumns: `repeat(${slots}, ${SLOT_PX}px)`, gridTemplateRows: `${rows.map(() => '26px 30px').join(' ')} 10px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null }}
    >
      {rows.map((row, index) => (
        <div key={row.zone} className="dates-strip-label" style={{ gridRow: index * 2 + 1 }}>
          <div className="dates-strip-sticky">
            <strong>{zoneCity(row.zone)}</strong>
            <span className="mono">{formatOffset(row.offsetMinutes)}{row.transitions.length > 0 && ` → ${formatOffset(row.transitions[row.transitions.length - 1].afterMinutes)}`}</span>
            {index === 0 && <span className="dates-ref">reference</span>}
            {index > 0 && (
              <button type="button" onClick={() => onMove(index, 0)} title="Make reference zone" aria-label={`Make ${row.zone} the reference zone`}>
                <span className="material-symbols-outlined" aria-hidden>vertical_align_top</span>
              </button>
            )}
            {index > 0 && (
              <button type="button" onClick={() => onMove(index, index - 1)} title="Move up" aria-label={`Move ${row.zone} up`}>
                <span className="material-symbols-outlined" aria-hidden>arrow_upward</span>
              </button>
            )}
            <button type="button" disabled={rows.length === 1} onClick={() => onRemove(index)} title="Remove" aria-label={`Remove ${row.zone}`}>
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
          </div>
        </div>
      ))}
      {rows.flatMap((row, r) => row.cells.map((cell) => (
        <div
          key={`${r}-${cell.from}`}
          aria-hidden
          className={`dates-cell${cell.work ? ' dates-cell-work' : ''}${cell.dayShift !== 0 ? ' dates-cell-other' : ''}${cell.hour === 0 && cell.minute === 0 ? ' dates-cell-midnight' : ''}`}
          style={{ gridColumn: `${cell.from + 1} / ${cell.to + 1}`, gridRow: r * 2 + 2 }}
          title={`${row.zone} ${longDate(cell.date)} ${pad(cell.hour)}:${pad(cell.minute)}`}
        >
          {cell.to - cell.from >= 2 && (
            cell.hour === 0 && cell.minute === 0
              ? <span className="dates-cell-day">{cell.date.day}/{cell.date.month}</span>
              : <span>{cell.hour}{cell.minute ? <small>:{pad(cell.minute)}</small> : null}</span>
          )}
        </div>
      )))}
      {shared.map(([a, b]) => (
        <div key={`o${a}`} aria-hidden className="dates-overlap" style={{ gridColumn: `${a + 1} / ${b + 1}`, gridRow: rows.length * 2 + 1 }} />
      ))}
      {sel && <div aria-hidden className="dates-sel" style={{ gridColumn: `${sel[0] + 1} / ${sel[1] + 1}`, gridRow: `1 / ${rows.length * 2 + 2}` }} />}
    </div>
  )
}
