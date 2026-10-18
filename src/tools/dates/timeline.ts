import {
  addDays, epochDay, formatOffset, hhmm, longDate, MINUTE, offsetMs, resolveWall, wallAt,
  type PlainDate, type Wall,
} from './zone'

/**
 * The meeting planner's timeline: the chosen calendar date in the reference
 * (first) zone, from its first instant to the first instant of the next day,
 * cut into 15-minute slots counted from that first instant. Every UTC offset
 * in use since the mid-20th century is a multiple of 15 minutes, so every
 * zone's hour boundaries fall on slot boundaries and rows line up on the same
 * instants. A 23- or 25-hour reference day has 92 or 100 slots.
 *
 * Two historical cases break that, and are flagged rather than hidden:
 * - a date the reference zone skipped entirely (Pacific/Apia jumped from
 *   29 to 31 December 2011) has no slots at all — `missing`;
 * - local mean time (most zones before about 1900; Africa/Monrovia kept
 *   −00:44:30 until 1972) puts a row's hours between slot boundaries — its
 *   `offGrid`. Its cells show the clock reading at each slot's start, and
 *   meeting times are computed from exact instants, so nothing is rounded.
 */
export const SLOT_MINUTES = 15
export const SLOT_MS = SLOT_MINUTES * MINUTE

export interface Timeline {
  date: PlainDate
  zone: string
  start: number
  end: number
  slots: number
  /** The date does not exist in the reference zone (the calendar skipped it). */
  missing: boolean
}

export function buildTimeline(date: PlainDate, zone: string): Timeline {
  const midnight = (d: PlainDate): Wall => ({ ...d, hour: 0, minute: 0, second: 0, ms: 0 })
  const start = resolveWall(midnight(date), zone).ms
  const end = resolveWall(midnight(addDays(date, 1)), zone).ms
  const slots = Math.max(0, Math.round((end - start) / SLOT_MS))
  return { date, zone, start, end, slots, missing: slots === 0 }
}

/** A selection [from, to) kept on the timeline; null when the timeline is empty. */
export function clampSel(sel: [number, number], slots: number): [number, number] | null {
  if (slots <= 0) return null
  const from = Math.max(0, Math.min(sel[0], slots - 1))
  const to = Math.max(from + 1, Math.min(sel[1], slots))
  return [from, to]
}

export interface WorkHours {
  /** Minutes after local midnight, inclusive. */
  start: number
  /** Minutes after local midnight, exclusive. */
  end: number
}

export interface Cell {
  /** First slot (inclusive) and last slot (exclusive) on the timeline. */
  from: number
  to: number
  /** Local wall time at the cell's first slot. */
  hour: number
  minute: number
  date: PlainDate
  /** Local date minus the timeline date: −1, 0 or +1. */
  dayShift: number
  work: boolean
}

export interface Transition {
  slot: number
  beforeMinutes: number
  afterMinutes: number
  /** Local clock just before and just after the change, e.g. 01:00 → 02:00. */
  from: string
  to: string
}

export interface ZoneRow {
  zone: string
  cells: Cell[]
  /** Per slot: inside working hours. */
  work: boolean[]
  transitions: Transition[]
  /** Offset at the start of the timeline, in minutes. */
  offsetMinutes: number
  /** Some hour of this zone starts between slot boundaries (local mean time). */
  offGrid: boolean
}

function inWork(minuteOfDay: number, hours: WorkHours): boolean {
  if (hours.start <= hours.end) return minuteOfDay >= hours.start && minuteOfDay < hours.end
  // Overnight shift such as 22–06.
  return minuteOfDay >= hours.start || minuteOfDay < hours.end
}

export function buildRow(timeline: Timeline, zone: string, hours: WorkHours): ZoneRow {
  const base = epochDay(timeline.date)
  const cells: Cell[] = []
  const work: boolean[] = []
  const transitions: Transition[] = []
  let previousOffset = offsetMs(timeline.start, zone)
  const firstOffset = previousOffset
  let offGrid = false
  for (let i = 0; i < timeline.slots; i++) {
    const t = timeline.start + i * SLOT_MS
    const wall = wallAt(t, zone)
    const offset = offsetMs(t, zone)
    if (wall.minute % SLOT_MINUTES !== 0 || wall.second !== 0 || wall.ms !== 0) offGrid = true
    if (offset !== previousOffset) {
      transitions.push({
        slot: i,
        beforeMinutes: previousOffset / MINUTE,
        afterMinutes: offset / MINUTE,
        from: hhmm(localClock(t, previousOffset)),
        to: hhmm(wall),
      })
      previousOffset = offset
    }
    const isWork = inWork(wall.hour * 60 + wall.minute, hours)
    work.push(isWork)
    const last = cells[cells.length - 1]
    const dayShift = epochDay(wall) - base
    if (last && last.hour === wall.hour && last.dayShift === dayShift && last.work === isWork && !transitions.some((x) => x.slot === i)) {
      last.to = i + 1
    } else {
      cells.push({ from: i, to: i + 1, hour: wall.hour, minute: wall.minute, date: { year: wall.year, month: wall.month, day: wall.day }, dayShift, work: isWork })
    }
  }
  return { zone, cells, work, transitions, offsetMinutes: firstOffset / MINUTE, offGrid }
}

/** The wall clock an instant would show under a given offset. */
function localClock(t: number, offset: number): { hour: number, minute: number } {
  const d = new Date(t + offset)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

/** Slots inside working hours in every row. */
export function overlap(rows: ZoneRow[], slots: number): boolean[] {
  return Array.from({ length: slots }, (_, i) => rows.length > 0 && rows.every((row) => row.work[i]))
}

/** Runs of true values as [from, to) pairs. */
export function ranges(flags: boolean[]): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  flags.forEach((flag, i) => {
    if (flag && start < 0) start = i
    if (!flag && start >= 0) { out.push([start, i]); start = -1 }
  })
  if (start >= 0) out.push([start, flags.length])
  return out
}

export interface MeetingTime {
  zone: string
  start: Wall
  end: Wall
  offsetMinutes: number
  /** Offset at the end, when a clock change falls inside the meeting. */
  endOffsetMinutes: number
  dayShift: number
}

export function meetingTimes(timeline: Timeline, zones: string[], startMs: number, endMs: number): MeetingTime[] {
  const base = epochDay(timeline.date)
  return zones.map((zone) => {
    const start = wallAt(startMs, zone)
    return {
      zone,
      start,
      end: wallAt(endMs, zone),
      offsetMinutes: offsetMs(startMs, zone) / MINUTE,
      endOffsetMinutes: offsetMs(endMs, zone) / MINUTE,
      dayShift: epochDay(start) - base,
    }
  })
}

export function dayShiftLabel(shift: number): string {
  if (shift === 0) return ''
  return shift > 0 ? `+${shift} day` : `−${-shift} day`
}

/** Plain-text summary of a meeting in every zone (ASCII offsets for pasting). */
export function meetingText(times: MeetingTime[], startMs: number, endMs: number, title = ''): string {
  const minutes = Math.round((endMs - startMs) / MINUTE)
  const length = minutes % 60 === 0 ? `${minutes / 60} h` : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
  const utc = new Date(startMs).toISOString().slice(0, 16).replace('T', ' ')
  const head = `${title.trim() || 'Meeting'} (${length}) — ${utc} UTC`
  const width = Math.max(...times.map((t) => t.zone.length))
  const lines = times.map((t) => {
    const shift = t.dayShift ? ` (${t.dayShift > 0 ? '+' : '-'}${Math.abs(t.dayShift)} day)` : ''
    const offset = t.endOffsetMinutes !== t.offsetMinutes
      ? `${formatOffset(t.offsetMinutes, true)} -> ${formatOffset(t.endOffsetMinutes, true)}`
      : formatOffset(t.offsetMinutes, true)
    return `${t.zone.padEnd(width)}  ${longDate(t.start)} ${hhmm(t.start)}-${hhmm(t.end)}  ${offset}${shift}`
  })
  return [head, ...lines].join('\n')
}
