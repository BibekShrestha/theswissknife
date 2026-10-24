/**
 * ASCII DXF → features in world coordinates (drawing units). Reads every
 * revision from R12 to 2018: HEADER ($ACADVER, $INSUNITS, $DWGCODEPAGE),
 * the LAYER table, BLOCKS and model-space ENTITIES.
 *
 * Entities: POINT, LINE, LWPOLYLINE and 2D/3D POLYLINE (bulges become
 * arcs), CIRCLE, ARC, ELLIPSE, SPLINE (NURBS, sampled), TEXT, MTEXT,
 * ATTRIB, INSERT (nested blocks, MINSERT arrays, layer-0 and BYBLOCK
 * inheritance), HATCH boundaries (holes found by nesting), SOLID, TRACE,
 * 3DFACE and LEADER. Planar entities are placed through their object
 * coordinate system (the arbitrary axis algorithm). Everything else is
 * counted and named in the notes.
 *
 * The reader walks the text with a cursor and never splits it into lines, so
 * a large file costs one string, not millions. Block nesting is bounded and
 * a block that contains itself is cut off.
 */

import { aciToRgb } from './aci'
import { ccwSweep, pointInRing, pushArc, pushBulge, ringArea, sampleNurbs } from './curves'
import { Tally, type Feature, type Geometry, type Note, type Rgb } from '../model'

export class DxfError extends Error {}

type Pair = [number, string]

interface RawEntity {
  type: string
  pairs: Pair[]
  /** VERTEX entities of a POLYLINE, ATTRIBs of an INSERT. */
  children: RawEntity[]
}

interface Block {
  name: string
  base: [number, number, number]
  flags: number
  entities: RawEntity[]
}

interface LayerInfo {
  name: string
  color: Rgb
  hidden: boolean
}

export interface DxfReadOptions {
  /** Include entities on layers that are off or frozen. */
  includeHidden: boolean
}

export interface DxfRead {
  features: Feature[]
  /** Layer names in table order, then any only seen on entities. */
  layers: string[]
  version: string
  /** $INSUNITS, when the header has it. */
  insunits?: number
  /** $LUNITS: 3 (engineering) and 4 (architectural) mean one unit is an inch. */
  lunits?: number
  /** A PROJ string from a "CRS:" comment, as this tool writes. */
  crsComment?: string
  hasZ: boolean
  /** Converted entities by type, for the summary. */
  counts: [string, number][]
  notes: Note[]
}

const MAX_DEPTH = 16
const MAX_VERTICES = 5_000_000
const MAX_ARRAY = 10_000

const VERSIONS: Record<string, string> = {
  AC1006: 'R10', AC1009: 'R11/R12', AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004',
  AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018',
}

/** Text encodings for $DWGCODEPAGE, used by files before AutoCAD 2007 (which write UTF-8). */
const CODEPAGES: Record<string, string> = {
  ANSI_874: 'windows-874', ANSI_932: 'shift_jis', ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5',
  ANSI_1250: 'windows-1250', ANSI_1251: 'windows-1251', ANSI_1252: 'windows-1252', ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254', ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
}

export function versionName(acadver: string) {
  return VERSIONS[acadver] ? `AutoCAD ${VERSIONS[acadver]} (${acadver})` : acadver || 'unknown version'
}

/** Picks the text encoding: UTF-8 when it decodes cleanly or the file is 2007+, else the header's code page. */
export function decodeDxf(bytes: Uint8Array): { text: string; encoding: string } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 65536))
  const version = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? ''
  const codepage = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() ?? ''
  if (version >= 'AC1021') return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF-8' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    const label = CODEPAGES[codepage] ?? 'windows-1252'
    try {
      return { text: new TextDecoder(label).decode(bytes), encoding: label }
    } catch {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
    }
  }
}

/** \U+XXXX escapes and %%-codes in DXF strings. */
export function dxfText(raw: string): string {
  let s = raw.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
  if (s.includes('%%')) {
    s = s.replace(/%%(\d{3}|[cCdDpPuUoOkK%])/g, (_, code: string) => {
      if (/^\d{3}$/.test(code)) return String.fromCharCode(parseInt(code, 10))
      switch (code.toLowerCase()) {
        case 'c': return '⌀'
        case 'd': return '°'
        case 'p': return '±'
        case '%': return '%'
        default: return ''
      }
    })
  }
  return s.replace(/\^ /g, '^')
}

/** MTEXT inline formatting stripped to plain text, paragraphs joined by spaces. */
export function mtextPlain(raw: string): string {
  return dxfText(raw)
    .replace(/\\\\/g, '\u0000')
    .replace(/\\[{}]/g, (m) => (m === '\\{' ? '\u0001' : '\u0002'))
    .replace(/\\[Pp]/g, ' ')
    .replace(/\\[ACcFfHhQqTtWw][^;\\{}]*;/g, '')
    .replace(/\\p[^;]*;/g, '')
    .replace(/\\S([^;]*);/g, (_, frac: string) => frac.replace(/[#^]/, '/'))
    .replace(/\\[LlOoKkX]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\u0000/g, '\\')
    .replace(/\u0001/g, '{')
    .replace(/\u0002/g, '}')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Walks group code / value pairs without splitting the text into lines. */
class Cursor {
  pos = 0
  line = 0
  code = 0
  value = ''
  comments: string[] = []
  /** An entity read too far (a POLYLINE that never reached SEQEND), returned next. */
  queued: RawEntity | null = null
  private held = false

  constructor(private text: string) {
    if (text.charCodeAt(0) === 0xfeff) this.pos = 1
  }

  private readLine(): string | null {
    const { text } = this
    if (this.pos >= text.length) return null
    let end = text.indexOf('\n', this.pos)
    if (end < 0) end = text.length
    let line = text.slice(this.pos, end)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    this.pos = end + 1
    this.line++
    return line
  }

  next(): boolean {
    if (this.held) { this.held = false; return true }
    for (;;) {
      const codeLine = this.readLine()
      if (codeLine === null) return false
      const trimmed = codeLine.trim()
      if (trimmed === '' && this.text.slice(this.pos).trim() === '') return false
      const code = Number(trimmed)
      if (trimmed === '' || !Number.isInteger(code)) {
        throw new DxfError(`Line ${this.line}: expected a group code, found “${trimmed.slice(0, 40)}” — the file may be cut off or not ASCII DXF`)
      }
      const value = this.readLine()
      if (value === null) throw new DxfError(`Line ${this.line}: the file ends after group code ${code}`)
      if (code === 999) { if (this.comments.length < 100) this.comments.push(value); continue }
      this.code = code
      this.value = value
      return true
    }
  }

  /** Makes the next next() return the current pair again. */
  hold() { this.held = true }
}

function num(value: string | undefined, fallback = 0) {
  if (value === undefined) return fallback
  const n = Number(value.trim())
  return Number.isFinite(n) ? n : fallback
}

/** Reads `0 TYPE` + body pairs; null at ENDSEC/EOF or the end of the file. */
function readEntity(cur: Cursor): RawEntity | null {
  if (!cur.next()) return null
  if (cur.code !== 0) {
    // Stray pairs between entities: skip to the next entity start.
    while (cur.next()) if (cur.code === 0) break
    if (cur.code !== 0) return null
  }
  const type = cur.value.trim()
  if (type === 'ENDSEC' || type === 'EOF') return null
  const pairs: Pair[] = []
  while (cur.next()) {
    if (cur.code === 0) { cur.hold(); break }
    pairs.push([cur.code, cur.value])
  }
  return { type, pairs, children: [] }
}

/** The next entity, with VERTEX…SEQEND grouped under POLYLINE and ATTRIB…SEQEND under INSERT. */
function nextEntity(cur: Cursor): RawEntity | null {
  if (cur.queued) {
    const queued = cur.queued
    cur.queued = null
    return queued
  }
  const entity = readEntity(cur)
  if (!entity) return null
  const followers = entity.type === 'POLYLINE' || (entity.type === 'INSERT' && entity.pairs.some(([c, v]) => c === 66 && num(v) === 1))
  if (followers) {
    for (;;) {
      const sub = readEntity(cur)
      if (!sub || sub.type === 'SEQEND') break
      if (sub.type !== 'VERTEX' && sub.type !== 'ATTRIB') { cur.queued = sub; break }
      entity.children.push(sub)
    }
  }
  return entity
}

function get(pairs: Pair[], code: number): string | undefined {
  for (const [c, v] of pairs) if (c === code) return v
  return undefined
}

function getNum(pairs: Pair[], code: number, fallback = 0) {
  return num(get(pairs, code), fallback)
}

// --- 3×4 affine matrices, row-major: [a b c tx; d e f ty; g h i tz] ---
type Mat = number[]
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

function mul(A: Mat, B: Mat): Mat {
  const out = new Array(12)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c]
      if (c === 3) v += A[r * 4 + 3]
      out[r * 4 + c] = v
    }
  }
  return out
}

function translate(x: number, y: number, z: number): Mat {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]
}

function rotateZ(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]
}

function scale(x: number, y: number, z: number): Mat {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0]
}

/** Object coordinate system → world, by the arbitrary axis algorithm. */
function ocs(nx: number, ny: number, nz: number): Mat | null {
  const len = Math.hypot(nx, ny, nz)
  if (!len) return null
  nx /= len; ny /= len; nz /= len
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0) return null
  let ax: number, ay: number, az: number
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) { ax = nz; ay = 0; az = -nx } // Wy × N
  else { ax = -ny; ay = nx; az = 0 } // Wz × N
  const al = Math.hypot(ax, ay, az)
  ax /= al; ay /= al; az /= al
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax
  return [ax, bx, nx, 0, ay, by, ny, 0, az, bz, nz, 0]
}

function extrusion(pairs: Pair[]): Mat | null {
  return ocs(getNum(pairs, 210, 0), getNum(pairs, 220, 0), getNum(pairs, 230, 1))
}

function apply(M: Mat, coords: number[]): number[] {
  if (M === IDENTITY) return coords
  const out = new Array(coords.length)
  for (let i = 0; i < coords.length; i += 3) {
    const x = coords[i], y = coords[i + 1], z = coords[i + 2]
    out[i] = M[0] * x + M[1] * y + M[2] * z + M[3]
    out[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7]
    out[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11]
  }
  return out
}

/** Drops consecutive duplicate vertices (and a closing one that repeats the first). */
function dedupe(c: number[], closed: boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < c.length; i += 3) {
    const n = out.length
    if (n && out[n - 3] === c[i] && out[n - 2] === c[i + 1] && out[n - 1] === c[i + 2]) continue
    out.push(c[i], c[i + 1], c[i + 2])
  }
  if (closed && out.length >= 6) {
    const n = out.length
    if (out[0] === out[n - 3] && out[1] === out[n - 2] && out[2] === out[n - 1]) out.length = n - 3
  }
  return out
}

interface Context {
  M: Mat
  /** Layer that layer-0 entities take on (inside a block). */
  layer: string | null
  /** Colour that BYBLOCK entities take on. */
  byBlock: Rgb
  depth: number
  /** Blocks currently being expanded, for cycle detection. */
  stack: string[]
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

export function readDxf(text: string, options: DxfReadOptions): DxfRead {
  const cur = new Cursor(text)
  const layerInfo = new Map<string, LayerInfo>()
  const layerOrder: string[] = []
  const blocks = new Map<string, Block>()
  const features: Feature[] = []
  const converted = new Tally()
  const skipped = new Tally()
  const hiddenLayersUsed = new Set<string>()
  const deferred: RawEntity[] = []
  let vertices = 0
  let truncated = false
  let version = ''
  let insunits: number | undefined
  let lunits: number | undefined
  let hasZ = false
  let sawSection = false
  let sawEntities = false
  let sawBlocks = false

  const layerKey = (name: string) => name.toUpperCase()
  const layerFor = (name: string): LayerInfo => {
    const key = layerKey(name)
    let info = layerInfo.get(key)
    if (!info) {
      info = { name, color: WHITE, hidden: false }
      layerInfo.set(key, info)
      layerOrder.push(name)
    }
    return info
  }

  const readHeader = () => {
    let variable = ''
    while (cur.next()) {
      if (cur.code === 0) { if (cur.value.trim() === 'ENDSEC') return; continue }
      if (cur.code === 9) { variable = cur.value.trim(); continue }
      if (variable === '$ACADVER' && cur.code === 1) version = cur.value.trim()
      else if (variable === '$INSUNITS' && cur.code === 70) insunits = num(cur.value)
      else if (variable === '$LUNITS' && cur.code === 70) lunits = num(cur.value)
    }
  }

  const readTables = () => {
    let entity: RawEntity | null
    while ((entity = readEntity(cur))) {
      if (entity.type !== 'LAYER') continue
      const name = dxfText(get(entity.pairs, 2) ?? '').trim()
      if (!name) continue
      const aci = getNum(entity.pairs, 62, 7)
      const trueColor = get(entity.pairs, 420)
      const color = trueColor !== undefined ? rgbFromInt(num(trueColor)) : aciToRgb(aci) ?? WHITE
      const info = layerFor(name)
      info.color = color
      info.hidden = aci < 0 || (getNum(entity.pairs, 70) & 1) === 1
    }
  }

  const readBlocks = () => {
    let entity: RawEntity | null
    let block: Block | null = null
    while ((entity = nextEntity(cur))) {
      if (entity.type === 'BLOCK') {
        const name = dxfText(get(entity.pairs, 2) ?? '')
        block = { name, base: [getNum(entity.pairs, 10), getNum(entity.pairs, 20), getNum(entity.pairs, 30)], flags: getNum(entity.pairs, 70), entities: [] }
        blocks.set(name.toUpperCase(), block)
      } else if (entity.type === 'ENDBLK') {
        block = null
      } else if (block) {
        block.entities.push(entity)
      }
    }
  }

  const colorOf = (pairs: Pair[], layer: LayerInfo, ctx: Context): Rgb => {
    const trueColor = get(pairs, 420)
    if (trueColor !== undefined) return rgbFromInt(num(trueColor))
    const aci = Math.abs(getNum(pairs, 62, 256))
    if (aci === 0) return ctx.byBlock
    if (aci === 256) return layer.color
    return aciToRgb(aci) ?? layer.color
  }

  const emit = (entity: RawEntity, ctx: Context) => {
    if (truncated) return
    const { type, pairs } = entity
    if (getNum(pairs, 67) === 1) { skipped.add(`${type} in paper space`); return }
    if (getNum(pairs, 60) === 1) return
    const ownLayer = dxfText(get(pairs, 8) ?? '0').trim() || '0'
    const layerName = ownLayer === '0' && ctx.layer ? ctx.layer : ownLayer
    const layer = layerFor(layerName)
    if (layer.hidden && !options.includeHidden) { hiddenLayersUsed.add(layer.name); return }
    const color = colorOf(pairs, layer, ctx)

    const out = (geometry: Geometry, name = '') => {
      const n = geometry.type === 'point' || geometry.type === 'text' ? 1 : geometry.type === 'line' ? geometry.coords.length / 3 : geometry.rings.reduce((s, r) => s + r.length / 3, 0)
      vertices += n
      if (vertices > MAX_VERTICES) { truncated = true; return }
      if (!hasZ) {
        const coords = geometry.type === 'point' || geometry.type === 'text' ? geometry.at : geometry.type === 'line' ? geometry.coords : geometry.rings[0]
        for (let i = 2; i < coords.length; i += 3) if (Math.abs(coords[i]) > 1e-9) { hasZ = true; break }
      }
      features.push({ geometry, name, layer: layer.name, color, source: type })
    }
    const line = (local: number[], closed: boolean, M: Mat) => {
      const coords = dedupe(apply(M, local), closed)
      if (coords.length >= 6) { out({ type: 'line', coords, closed: closed && coords.length >= 9 }); return true }
      if (coords.length === 3) { out({ type: 'point', at: coords }); return true }
      return false
    }
    const withOcs = (): Mat => {
      const o = extrusion(pairs)
      return o ? mul(ctx.M, o) : ctx.M
    }
    const point3 = (code: number) => [getNum(pairs, code), getNum(pairs, code + 10), getNum(pairs, code + 20)]

    switch (type) {
      case 'POINT':
        out({ type: 'point', at: apply(ctx.M, point3(10)) })
        break
      case 'LINE':
        if (!line([...point3(10), ...point3(11)], false, ctx.M)) return
        break
      case 'CIRCLE': {
        const [cx, cy, cz] = point3(10)
        const r = getNum(pairs, 40)
        if (!(r > 0)) { skipped.add('CIRCLE with no radius'); return }
        const local: number[] = []
        pushArc(local, cx, cy, cz, r, 0, Math.PI * 2, true)
        local.length -= 3
        line(local, true, withOcs())
        break
      }
      case 'ARC': {
        const [cx, cy, cz] = point3(10)
        const r = getNum(pairs, 40)
        if (!(r > 0)) { skipped.add('ARC with no radius'); return }
        const start = (getNum(pairs, 50) * Math.PI) / 180
        const end = (getNum(pairs, 51) * Math.PI) / 180
        const local: number[] = []
        pushArc(local, cx, cy, cz, r, start, ccwSweep(start, end), true)
        line(local, false, withOcs())
        break
      }
      case 'ELLIPSE': {
        const [cx, cy, cz] = point3(10)
        const [mx, my, mz] = point3(11)
        const ratio = getNum(pairs, 40, 1)
        const nx = getNum(pairs, 210, 0), ny = getNum(pairs, 220, 0), nz = getNum(pairs, 230, 1)
        const nl = Math.hypot(nx, ny, nz) || 1
        // Minor axis = ratio × (extrusion × major axis).
        const ix = (ratio * (ny * mz - nz * my)) / nl, iy = (ratio * (nz * mx - nx * mz)) / nl, iz = (ratio * (nx * my - ny * mx)) / nl
        const t0 = getNum(pairs, 41, 0)
        const t1 = getNum(pairs, 42, Math.PI * 2)
        const sweep = ccwSweep(t0, t1)
        const full = Math.abs(sweep - Math.PI * 2) < 1e-9
        const n = Math.max(8, Math.ceil(sweep / ((3 * Math.PI) / 180)))
        const local: number[] = []
        for (let k = 0; k <= (full ? n - 1 : n); k++) {
          const t = t0 + (sweep * k) / n
          const c = Math.cos(t), s = Math.sin(t)
          local.push(cx + mx * c + ix * s, cy + my * c + iy * s, cz + mz * c + iz * s)
        }
        line(local, full, ctx.M)
        break
      }
      case 'LWPOLYLINE': {
        const flags = getNum(pairs, 70)
        const z = getNum(pairs, 38)
        const verts: number[][] = []
        for (const [c, v] of pairs) {
          if (c === 10) verts.push([num(v), 0, 0])
          else if (c === 20 && verts.length) verts[verts.length - 1][1] = num(v)
          else if (c === 42 && verts.length) verts[verts.length - 1][2] = num(v)
        }
        line(bulgePath(verts, z, (flags & 1) === 1), (flags & 1) === 1, withOcs())
        break
      }
      case 'POLYLINE': {
        const flags = getNum(pairs, 70)
        if (flags & 16) { skipped.add('POLYLINE (3D mesh)'); return }
        if (flags & 64) { skipped.add('POLYLINE (polyface mesh)'); return }
        const closed = (flags & 1) === 1
        const is3d = (flags & 8) === 8
        const z = getNum(pairs, 30)
        const verts: number[][] = []
        for (const v of entity.children) {
          if (v.type !== 'VERTEX') continue
          const vflags = getNum(v.pairs, 70)
          if (vflags & 16) continue // spline frame control point: not on the curve
          verts.push([getNum(v.pairs, 10), getNum(v.pairs, 20), is3d ? getNum(v.pairs, 30) : z, getNum(v.pairs, 42)])
        }
        if (is3d) line(verts.flatMap((v) => [v[0], v[1], v[2]]), closed, ctx.M)
        else line(bulgePath(verts.map((v) => [v[0], v[1], v[3]]), z, closed), closed, withOcs())
        break
      }
      case 'SPLINE': {
        const flags = getNum(pairs, 70)
        const degree = getNum(pairs, 71, 3)
        const knots: number[] = [], control: number[] = [], fit: number[] = [], weights: number[] = []
        for (const [c, v] of pairs) {
          if (c === 40) knots.push(num(v))
          else if (c === 41) weights.push(num(v))
          else if (c === 10) control.push(num(v), 0, 0)
          else if (c === 20) control[control.length - 2] = num(v)
          else if (c === 30) control[control.length - 1] = num(v)
          else if (c === 11) fit.push(num(v), 0, 0)
          else if (c === 21) fit[fit.length - 2] = num(v)
          else if (c === 31) fit[fit.length - 1] = num(v)
        }
        const closed = (flags & 1) === 1
        const samples = Math.min(4000, Math.max(64, (control.length / 3) * 32))
        const curve = sampleNurbs(degree, knots, control, weights.length ? weights : null, samples)
        if (curve) line(curve, closed, ctx.M)
        else if (fit.length >= 6) { line(fit, closed, ctx.M); skipped.add('SPLINE drawn through its fit points (knots unreadable)') }
        else if (control.length >= 6) { line(control, closed, ctx.M); skipped.add('SPLINE drawn as its control polygon (knots unreadable)') }
        else { skipped.add('SPLINE without points'); return }
        break
      }
      case 'TEXT':
      case 'ATTRIB': {
        if (type === 'ATTRIB' && (getNum(pairs, 70) & 1)) return
        const textValue = dxfText(get(pairs, 1) ?? '').trim()
        if (!textValue) return
        const aligned = getNum(pairs, 72) !== 0 || getNum(pairs, type === 'TEXT' ? 73 : 74) !== 0
        const at = aligned && get(pairs, 11) !== undefined ? point3(11) : point3(10)
        const M = withOcs()
        out({ type: 'text', at: apply(M, at), text: textValue, height: getNum(pairs, 40) * scaleOf(M), rotation: getNum(pairs, 50) }, textValue)
        break
      }
      case 'MTEXT': {
        let raw = ''
        for (const [c, v] of pairs) if (c === 3) raw += v
        raw += get(pairs, 1) ?? ''
        const textValue = mtextPlain(raw)
        if (!textValue) return
        out({ type: 'text', at: apply(ctx.M, point3(10)), text: textValue, height: getNum(pairs, 40) * scaleOf(ctx.M), rotation: 0 }, textValue)
        break
      }
      case 'SOLID':
      case 'TRACE':
      case '3DFACE': {
        const p = [point3(10), point3(11), point3(12), point3(13)]
        const ring = type === '3DFACE' ? [...p[0], ...p[1], ...p[2], ...p[3]] : [...p[0], ...p[1], ...p[3], ...p[2]]
        const coords = dedupe(apply(type === '3DFACE' ? ctx.M : withOcs(), ring), true)
        if (coords.length >= 9) out({ type: 'polygon', rings: [coords] })
        else if (!line(coords, false, IDENTITY)) return
        break
      }
      case 'LEADER': {
        const local: number[] = []
        for (const [c, v] of pairs) {
          if (c === 10) local.push(num(v), 0, 0)
          else if (c === 20) local[local.length - 2] = num(v)
          else if (c === 30) local[local.length - 1] = num(v)
        }
        if (!line(local, false, ctx.M)) return
        break
      }
      case 'HATCH': {
        const rings = hatchRings(pairs)
        if (!rings.length) { skipped.add('HATCH without a readable boundary'); return }
        const M = withOcs()
        for (const polygon of nestRings(rings.map((r) => dedupe(r, true)).filter((r) => r.length >= 9))) {
          out({ type: 'polygon', rings: polygon.map((r) => apply(M, r)) })
        }
        break
      }
      case 'INSERT': {
        insert(entity, ctx, layer, color)
        return
      }
      case 'ATTDEF':
        return
      case 'VIEWPORT':
        return
      case 'DIMENSION': case 'ARC_DIMENSION': case 'LARGE_RADIAL_DIMENSION':
        skipped.add('dimension'); return
      case 'RAY': case 'XLINE':
        skipped.add(`${type} (infinite line)`); return
      case 'REGION': case '3DSOLID': case 'BODY': case 'SURFACE':
        skipped.add(`${type} (ACIS solid)`); return
      default:
        skipped.add(type); return
    }
    converted.add(type)
  }

  const insert = (entity: RawEntity, ctx: Context, layer: LayerInfo, color: Rgb) => {
    const { pairs } = entity
    const name = dxfText(get(pairs, 2) ?? '')
    const block = blocks.get(name.toUpperCase())
    if (!block) {
      if (!sawBlocks) { deferred.push(entity); return }
      skipped.add('INSERT of an undefined block'); return
    }
    if (block.flags & 4) { skipped.add('external reference (xref)'); return }
    if (ctx.stack.includes(block.name.toUpperCase())) { skipped.add('block that contains itself (cut off)'); return }
    if (ctx.depth >= MAX_DEPTH) { skipped.add(`block nested more than ${MAX_DEPTH} deep`); return }

    const sx = getNum(pairs, 41, 1), sy = getNum(pairs, 42, 1), sz = getNum(pairs, 43, 1)
    const rotation = (getNum(pairs, 50) * Math.PI) / 180
    const cols = Math.max(1, Math.floor(getNum(pairs, 70, 1)))
    const rows = Math.max(1, Math.floor(getNum(pairs, 71, 1)))
    const colSpacing = getNum(pairs, 44), rowSpacing = getNum(pairs, 45)
    const ucols = colSpacing ? cols : 1, urows = rowSpacing ? rows : 1
    if (ucols * urows > MAX_ARRAY) { skipped.add(`MINSERT array larger than ${MAX_ARRAY.toLocaleString('en-US')} copies`); return }
    const base = mul(ctx.M, extrusion(pairs) ?? IDENTITY)
    const [ix, iy, iz] = [getNum(pairs, 10), getNum(pairs, 20), getNum(pairs, 30)]
    const inner = mul(scale(sx, sy, sz), translate(-block.base[0], -block.base[1], -block.base[2]))
    const child: Omit<Context, 'M'> = {
      layer: layer.name,
      byBlock: color,
      depth: ctx.depth + 1,
      stack: [...ctx.stack, block.name.toUpperCase()],
    }
    for (let r = 0; r < urows; r++) {
      for (let c = 0; c < ucols; c++) {
        // MINSERT spacing is rotated with the block but never scaled.
        const M = mul(mul(mul(base, translate(ix, iy, iz)), rotateZ(rotation)), mul(translate(c * colSpacing, r * rowSpacing, 0), inner))
        for (const e of block.entities) emit(e, { ...child, M })
      }
    }
    // Attributes are already placed in world space by the INSERT.
    for (const attrib of entity.children) emit(attrib, ctx)
    converted.add('INSERT')
  }

  const readEntities = () => {
    sawEntities = true
    let entity: RawEntity | null
    const top: Context = { M: IDENTITY, layer: null, byBlock: WHITE, depth: 0, stack: [] }
    while ((entity = nextEntity(cur))) emit(entity, top)
  }

  // The file is a run of sections; pairs outside one are ignored.
  const isSectionName = () => cur.next() && cur.code === 2
  while (cur.next()) {
    if (cur.code !== 0) continue
    const marker = cur.value.trim()
    if (marker === 'EOF') break
    if (marker !== 'SECTION' || !isSectionName()) continue
    sawSection = true
    const name = cur.value.trim()
    if (name === 'HEADER') readHeader()
    else if (name === 'TABLES') readTables()
    else if (name === 'BLOCKS') { readBlocks(); sawBlocks = true }
    else if (name === 'ENTITIES') readEntities()
    else while (cur.next()) if (cur.code === 0 && cur.value.trim() === 'ENDSEC') break
  }
  if (!sawSection) throw new DxfError('No DXF sections found — this is not an ASCII DXF file')

  sawBlocks = true
  const top: Context = { M: IDENTITY, layer: null, byBlock: WHITE, depth: 0, stack: [] }
  for (const entity of deferred) emit(entity, top)

  const crsComment = cur.comments.map((c) => /^\s*CRS:\s*(\+proj=.*)$/.exec(c)?.[1]?.trim()).find(Boolean)

  const notes: Note[] = []
  if (!sawEntities) notes.push({ level: 'warn', text: 'The file has no ENTITIES section.' })
  if (truncated) notes.push({ level: 'warn', text: `Stopped after ${MAX_VERTICES.toLocaleString('en-US')} vertices — the rest of the drawing was left out.` })
  if (hiddenLayersUsed.size) {
    const list = [...hiddenLayersUsed]
    notes.push({ level: 'info', text: `Entities on ${list.length} layer${list.length === 1 ? '' : 's'} that are off or frozen were left out (${list.slice(0, 5).join(', ')}${list.length > 5 ? ', …' : ''}). Tick “Hidden layers” to include them.` })
  }
  for (const [what, n] of skipped.entries()) notes.push({ level: 'warn', text: `${n.toLocaleString('en-US')} × ${what} — skipped.` })

  return {
    features,
    layers: layerOrder,
    version,
    insunits,
    lunits,
    crsComment,
    hasZ,
    counts: converted.entries(),
    notes,
  }
}

/** A bulged vertex list ([x, y, bulge]) as a flat path at elevation z. */
function bulgePath(verts: number[][], z: number, closed: boolean): number[] {
  const out: number[] = []
  for (let i = 0; i < verts.length; i++) {
    const [x, y, bulge] = verts[i]
    out.push(x, y, z)
    const next = i + 1 < verts.length ? verts[i + 1] : closed ? verts[0] : null
    if (next && bulge) pushBulge(out, x, y, next[0], next[1], z, bulge)
  }
  return out
}

function rgbFromInt(n: number): Rgb {
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Linear scale of a transform in its XY plane (for text heights). */
function scaleOf(M: Mat) {
  return Math.sqrt(Math.abs(M[0] * M[5] - M[1] * M[4])) || 1
}

/** Boundary paths of a HATCH as OCS rings at its elevation. */
function hatchRings(pairs: Pair[]): number[][] {
  let i = 0
  const n = pairs.length
  const at = (code: number) => (i < n && pairs[i][0] === code ? num(pairs[i++][1]) : NaN)
  let elevation = 0
  // Header: up to the boundary path count (91).
  for (; i < n; i++) {
    const [c, v] = pairs[i]
    if (c === 30) elevation = num(v)
    if (c === 91) { i++; break }
  }
  const rings: number[][] = []
  const deg = Math.PI / 180
  while (i < n && pairs[i][0] === 92) {
    const flags = num(pairs[i++][1])
    const ring: number[] = []
    if (flags & 2) {
      const hasBulge = at(72) === 1
      at(73)
      const count = at(93)
      const verts: number[][] = []
      for (let k = 0; k < count && i < n; k++) {
        const x = at(10), y = at(20)
        const b = hasBulge && i < n && pairs[i][0] === 42 ? num(pairs[i++][1]) : 0
        if (Number.isFinite(x) && Number.isFinite(y)) verts.push([x, y, b])
      }
      ring.push(...bulgePath(verts, elevation, true))
    } else {
      const edges = at(93)
      for (let k = 0; k < edges && i < n; k++) {
        const type = at(72)
        if (type === 1) {
          const x1 = at(10), y1 = at(20), x2 = at(11), y2 = at(21)
          ring.push(x1, y1, elevation, x2, y2, elevation)
        } else if (type === 2) {
          const cx = at(10), cy = at(20), r = at(40), s = at(50), e = at(51)
          const ccw = i < n && pairs[i][0] === 73 ? num(pairs[i++][1]) !== 0 : true
          const sweep = ccwSweep(s * deg, e * deg)
          // Clockwise edges store their angles mirrored (360° − angle).
          if (ccw) pushArc(ring, cx, cy, elevation, r, s * deg, sweep, true)
          else pushArc(ring, cx, cy, elevation, r, -s * deg, -sweep, true)
        } else if (type === 3) {
          const cx = at(10), cy = at(20), mx = at(11), my = at(21), ratio = at(40), s = at(50), e = at(51)
          const ccw = i < n && pairs[i][0] === 73 ? num(pairs[i++][1]) !== 0 : true
          const sweep = ccwSweep(s * deg, e * deg)
          const steps = Math.max(8, Math.ceil(sweep / (3 * deg)))
          for (let j = 0; j <= steps; j++) {
            const t = ccw ? s * deg + (sweep * j) / steps : -(s * deg + (sweep * j) / steps)
            const c = Math.cos(t), sn = Math.sin(t)
            ring.push(cx + mx * c - my * ratio * sn, cy + my * c + mx * ratio * sn, elevation)
          }
        } else if (type === 4) {
          const degree = at(94)
          if (i < n && pairs[i][0] === 73) i++
          if (i < n && pairs[i][0] === 74) i++
          const nk = at(95), nc = at(96)
          const knots: number[] = [], control: number[] = [], weights: number[] = []
          for (let k2 = 0; k2 < nk && i < n; k2++) knots.push(at(40))
          for (let k2 = 0; k2 < nc && i < n; k2++) {
            control.push(at(10), at(20), elevation)
            if (i < n && pairs[i][0] === 42) weights.push(num(pairs[i++][1]))
          }
          const fitCount = i < n && pairs[i][0] === 97 ? at(97) : 0
          const fit: number[] = []
          for (let k2 = 0; k2 < fitCount && i < n; k2++) fit.push(at(11), at(21), elevation)
          while (i < n && (pairs[i][0] === 12 || pairs[i][0] === 22 || pairs[i][0] === 13 || pairs[i][0] === 23)) i++
          const curve = sampleNurbs(degree, knots, control, weights.length ? weights : null, Math.max(64, nc * 32))
          ring.push(...(curve ?? (fit.length ? fit : control)))
        } else {
          break
        }
      }
    }
    // Source boundary object references.
    if (i < n && pairs[i][0] === 97) {
      const refs = num(pairs[i++][1])
      for (let k = 0; k < refs && i < n && pairs[i][0] === 330; k++) i++
    }
    if (ring.length >= 9 && ring.every(Number.isFinite)) rings.push(ring)
  }
  return rings
}

/**
 * Groups rings into polygons by nesting: a ring inside an even number of
 * others is an outer boundary, one inside an odd number is a hole of the
 * smallest ring around it — the "normal" hatch style.
 */
export function nestRings(rings: number[][]): number[][][] {
  if (rings.length <= 1) return rings.map((r) => [r])
  if (rings.length > 400) return rings.map((r) => [r])
  const area = rings.map((r) => Math.abs(ringArea(r)))
  const parents: number[][] = rings.map((r, i) => rings.map((_, j) => j).filter((j) => j !== i && area[j] > area[i] && pointInRing(r[0], r[1], rings[j])))
  const polygons = new Map<number, number[][]>()
  rings.forEach((ring, i) => {
    if (parents[i].length % 2 === 0) polygons.set(i, [ring])
  })
  rings.forEach((ring, i) => {
    if (parents[i].length % 2 === 1) {
      const holder = parents[i].reduce((best, j) => (area[j] < area[best] ? j : best), parents[i][0])
      polygons.get(holder)?.push(ring)
    }
  })
  return [...polygons.values()]
}
