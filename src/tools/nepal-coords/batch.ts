/**
 * Batch input: one point per line, columns split by tab, comma or semicolon
 * (spaces when a line has none of those), as a total station or a field
 * book writes them. An optional point id comes first; columns after the two
 * coordinates (height, code…) are carried through untouched. A first line
 * whose coordinates aren't numbers is a header. Bad lines are listed with a
 * reason and a line number, never more than a few characters of their text.
 */

import { asciiDigits, clip, parseAngle, type AngleKind } from './angle'
import { fromGrid, gridProblem, nearestZone, toGrid, warningsFor, type Geo, type Grid, type ShiftId, type WarningKind, type Zone } from './mutm'

export type InputKind = 'grid' | 'geo'
/**
 * Column order. 'auto' uses the size of the numbers: across Nepal the
 * northing (about 2.9–3.4 million m) is always larger than the easting
 * (under 1 million), and the longitude (80–88°) larger than the latitude
 * (26–31°). 'normal' is E, N or lat, lon; 'swapped' is N, E or lon, lat.
 */
export type Order = 'auto' | 'normal' | 'swapped'

export const MAX_LINES = 10_000

export interface Row {
  line: number
  id: string
  /** Grid input: easting, northing. Geo input: latitude, longitude. */
  first: number
  second: number
  /** Columns after the coordinates, with their 0-based column index. */
  extras: { column: number; text: string }[]
}

export interface BadLine {
  line: number
  reason: string
}

export interface Parsed {
  rows: Row[]
  bad: BadLine[]
  /** The header's cells, when the first line was one. */
  header: string[] | null
  /** Lines past MAX_LINES that were not read. */
  skipped: number
}

/** Splits a CSV-ish line, honouring double quotes around a field. */
export function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : /[,;]/.test(line) ? null : ' '
  if (sep === ' ') return line.trim().split(/\s+/).filter(Boolean)
  if (sep === '\t') return line.split('\t').map(unquote).map((f) => f.trim())
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field.trim() === '') { quoted = true; field = '' }
    else if (c === ',' || c === ';') { fields.push(field.trim()); field = '' }
    else field += c
  }
  fields.push(field.trim())
  return fields
}

function unquote(field: string): string {
  const t = field.trim()
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t
}

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/

/** A plain grid number in metres (Devanagari digits allowed; no thousands separators). */
export function parseMetres(text: string): number | null {
  const t = asciiDigits(text).trim().replace(/^−/, '-')
  return NUMBER.test(t) ? Number(t) : null
}

type Cell = { value: number; kind?: AngleKind } | null

function readCell(text: string, input: InputKind): Cell {
  if (input === 'grid') {
    const v = parseMetres(text)
    return v === null ? null : { value: v }
  }
  const r = parseAngle(text)
  return r.ok ? { value: r.value, kind: r.kind } : null
}

/** Two numbers that look like an MUTM or lat/lon pair in Nepal, in either order. */
function plausible(a: number, b: number, input: InputKind): boolean {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return input === 'grid'
    ? lo >= 100_000 && lo <= 900_000 && hi >= 2_600_000 && hi <= 3_600_000
    : lo >= 25 && lo <= 32 && hi >= 78 && hi <= 90
}

/** Puts a line's two cells in normal order (E, N or lat, lon), or explains why it can't. */
function arrange(a: NonNullable<Cell>, b: NonNullable<Cell>, input: InputKind, order: Order): [number, number] | string {
  if (input === 'geo' && (a.kind || b.kind)) {
    // Hemisphere letters decide.
    const firstIsLon = a.kind === 'lon' || b.kind === 'lat'
    if ((a.kind && a.kind === b.kind)) return 'Both values name the same axis (N/S or E/W)'
    if (order === 'normal' && firstIsLon) return 'Latitude was expected first, but the letters say longitude'
    if (order === 'swapped' && !firstIsLon) return 'Longitude was expected first, but the letters say latitude'
    return firstIsLon ? [b.value, a.value] : [a.value, b.value]
  }
  const swap = order === 'swapped' || (order === 'auto' && Math.abs(a.value) > Math.abs(b.value))
  return swap ? [b.value, a.value] : [a.value, b.value]
}

export function parseBatch(text: string, input: InputKind, order: Order): Parsed {
  const lines = text.split(/\r\n|\n|\r/)
  const rows: Row[] = []
  const bad: BadLine[] = []
  let header: string[] | null = null
  let seenContent = false
  const limit = Math.min(lines.length, MAX_LINES)
  let skipped = 0
  for (let i = limit; i < lines.length; i++) if (lines[i].trim()) skipped++

  for (let i = 0; i < limit; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const line = i + 1
    const first = !seenContent
    seenContent = true
    if (raw.length > 500) { bad.push({ line, reason: 'Line is too long (over 500 characters)' }); continue }
    const fields = splitLine(raw)
    while (fields.length && fields[fields.length - 1] === '') fields.pop()
    const cells = fields.map((f) => readCell(f, input))

    // Where the coordinates are: columns 0–1, or 1–2 after a point id.
    let at = 0
    if (!cells[0] && fields.length >= 2) at = 1
    else if (cells[0] && cells[1] && cells[2] && plausible(cells[1].value, cells[2].value, input) && !plausible(cells[0].value, cells[1].value, input)) at = 1

    const a = cells[at], b = cells[at + 1]
    if (!a || !b) {
      if (first && !cells.some(Boolean)) { header = fields; continue }
      if (fields.length - at < 2) { bad.push({ line, reason: input === 'grid' ? 'Needs an easting and a northing' : 'Needs a latitude and a longitude' }); continue }
      const culprit = !a ? fields[at] : fields[at + 1]
      bad.push({ line, reason: `“${clip(culprit)}” is not ${input === 'grid' ? 'a number in metres' : 'an angle'}` })
      continue
    }
    const arranged = arrange(a, b, input, order)
    if (typeof arranged === 'string') { bad.push({ line, reason: arranged }); continue }
    const [p, q] = arranged
    if (input === 'geo' && (Math.abs(p) > 90 || Math.abs(q) > 180)) { bad.push({ line, reason: 'Latitude must be within ±90° and longitude within ±180°' }); continue }
    rows.push({
      line,
      id: at === 1 ? fields[0] : '',
      first: p,
      second: q,
      extras: fields.slice(at + 2).map((t, k) => ({ column: at + 2 + k, text: t })),
    })
  }
  return { rows, bad, header, skipped }
}

export interface Converted {
  row: Row
  zone: Zone
  geo: Geo
  grid: Grid
  warnings: WarningKind[]
}

/**
 * Converts parsed rows. Grid input needs a zone; geo input takes a fixed
 * zone or, with 'auto', each point's nearest. Rows whose grid values cannot
 * be MUTM move to `bad`.
 */
export function convertRows(rows: Row[], input: InputKind, zone: Zone | 'auto', shift: ShiftId): { done: Converted[]; bad: BadLine[] } {
  const done: Converted[] = []
  const bad: BadLine[] = []
  for (const row of rows) {
    if (input === 'grid') {
      const grid = { e: row.first, n: row.second }
      const problem = gridProblem(grid)
      if (problem) { bad.push({ line: row.line, reason: problem }); continue }
      const z = zone === 'auto' ? 84 : zone
      const geo = fromGrid(grid, z, shift)
      done.push({ row, zone: z, geo, grid, warnings: warningsFor(geo, z).map((w) => w.kind) })
    } else {
      const geo = { lat: row.first, lon: row.second }
      const z = zone === 'auto' ? nearestZone(geo.lon) : zone
      done.push({ row, zone: z, geo, grid: toGrid(geo, z, shift), warnings: warningsFor(geo, z).map((w) => w.kind) })
    }
  }
  return { done, bad }
}

function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const NOTE: Record<WarningKind, string> = { outside: 'outside Nepal', zone: 'far from zone meridian' }

/**
 * CSV of every converted row: id, both coordinate pairs, zone, the extra
 * columns (named from the header when there was one), and a note column.
 */
export function toCsv(done: Converted[], header: string[] | null, formatDms: (v: number, k: AngleKind) => string): string {
  const extraColumns = [...new Set(done.flatMap((c) => c.row.extras.map((x) => x.column)))].sort((a, b) => a - b)
  const names = extraColumns.map((col) => header?.[col]?.trim() || `column_${col + 1}`)
  const head = ['id', 'zone', 'easting', 'northing', 'latitude', 'longitude', 'latitude_dms', 'longitude_dms', ...names, 'note']
  const lines = [head.map(csvCell).join(',')]
  for (const c of done) {
    const extras = extraColumns.map((col) => c.row.extras.find((x) => x.column === col)?.text ?? '')
    lines.push([
      c.row.id,
      String(c.zone),
      c.grid.e.toFixed(3),
      c.grid.n.toFixed(3),
      c.geo.lat.toFixed(8),
      c.geo.lon.toFixed(8),
      formatDms(c.geo.lat, 'lat'),
      formatDms(c.geo.lon, 'lon'),
      ...extras,
      c.warnings.map((w) => NOTE[w]).join('; '),
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
