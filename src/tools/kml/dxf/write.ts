/**
 * Features (drawing units) → ASCII DXF R12 (AC1009): the oldest revision
 * every CAD program still opens, and the one AutoCAD reads without object
 * handles or an OBJECTS section. Lines and rings are POLYLINE/VERTEX/SEQEND
 * (3D polylines when altitude is kept), points are POINTs, labels TEXT.
 *
 * R12 has no true colour, so colours are the nearest AutoCAD Color Index;
 * strings are ASCII with \U+XXXX escapes; layer names keep to R12's rules
 * (31 characters of A–Z, 0–9, $, - and _), made unique.
 */

import { nearestAci } from './aci'
import type { Feature, Note, Rgb } from '../model'

export interface DxfWriteOptions {
  /** Lines written as 999 comments at the top (AutoCAD reads and ignores them). */
  comments: string[]
  /** Decimal places for coordinates. */
  precision: number
  /** Write Z (3D polylines); otherwise every vertex is at elevation 0. */
  use3d: boolean
  /** Height of TEXT entities, in drawing units. */
  textHeight: number
  /**
   * The drawing unit as an $INSUNITS code (0 = unitless, e.g. degrees) and
   * whether it is metric. Without these AutoCAD falls back to imperial
   * architectural units, which take one drawing unit to be an inch.
   */
  insunits: number
  metric: boolean
}

const MAX_LAYER = 31

/** R12 strings: printable ASCII, other characters as \U+XXXX, carets doubled the DXF way. */
export function dxfString(text: string): string {
  let out = ''
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
    const code = ch.codePointAt(0)!
    if (code === 0x5e) out += '^ '
    else if (code >= 0x20 && code < 0x7f) out += ch
    else if (code > 0xffff) out += '?'
    else if (code >= 0xa0) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** Maps free-form layer names onto unique legal R12 names. */
export function layerNamer() {
  const used = new Map<string, string>()
  const taken = new Set<string>(['0'])
  let renamed = 0
  const name = (raw: string): string => {
    const known = used.get(raw)
    if (known) return known
    let base = raw
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_\-$]+/g, '_')
      .replace(/^_+|_+$/g, '')
    if (!base) base = raw.trim() ? 'Layer' : '0'
    let result = base.slice(0, MAX_LAYER)
    if (result !== '0') {
      for (let n = 2; taken.has(result.toUpperCase()); n++) {
        const suffix = `~${n}`
        result = base.slice(0, MAX_LAYER - suffix.length) + suffix
      }
    }
    if (result !== raw && raw.trim() !== '') renamed++
    taken.add(result.toUpperCase())
    used.set(raw, result)
    return result
  }
  return { name, renamedCount: () => renamed, entries: () => [...used.entries()] }
}

function fmt(n: number, digits: number) {
  const s = n.toFixed(digits)
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
  return t === '-0' ? '0' : t
}

export interface DxfWritten {
  text: string
  notes: Note[]
  layerNames: Map<string, string>
}

export function writeDxf(features: Feature[], layerOrder: string[], options: DxfWriteOptions): DxfWritten {
  const out: string[] = []
  const pair = (code: number, value: string | number) => { out.push(String(code), String(value)) }
  const p = options.precision
  const xyz = (base: number, c: number[], i: number, z = options.use3d) => {
    pair(base, fmt(c[i], p)); pair(base + 10, fmt(c[i + 1], p)); pair(base + 20, z ? fmt(c[i + 2], 3) : '0')
  }

  const names = layerNamer()
  for (const layer of layerOrder) names.name(layer)

  // A layer's colour is its features' most common colour; others are set per entity.
  const layerColors = new Map<string, Map<number, number>>()
  const aciOf = (rgb: Rgb | null) => (rgb ? nearestAci(rgb) : 7)
  for (const f of features) {
    const layer = names.name(f.layer)
    let counts = layerColors.get(layer)
    if (!counts) layerColors.set(layer, (counts = new Map()))
    const aci = aciOf(f.color)
    counts.set(aci, (counts.get(aci) ?? 0) + 1)
  }
  const layerAci = new Map<string, number>()
  for (const [layer, counts] of layerColors) {
    layerAci.set(layer, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0])
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  const extend = (c: number[]) => {
    for (let i = 0; i < c.length; i += 3) {
      if (c[i] < minX) minX = c[i]
      if (c[i] > maxX) maxX = c[i]
      if (c[i + 1] < minY) minY = c[i + 1]
      if (c[i + 1] > maxY) maxY = c[i + 1]
      const z = options.use3d ? c[i + 2] : 0
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'point' || g.type === 'text') extend(g.at)
    else if (g.type === 'line') extend(g.coords)
    else for (const ring of g.rings) extend(ring)
  }
  if (minX > maxX) { minX = minY = minZ = maxX = maxY = maxZ = 0 }

  for (const comment of options.comments) pair(999, dxfString(comment))
  pair(0, 'SECTION'); pair(2, 'HEADER')
  pair(9, '$ACADVER'); pair(1, 'AC1009')
  pair(9, '$DWGCODEPAGE'); pair(3, 'ANSI_1252')
  // Decimal linear units: architectural/engineering would make AutoCAD read
  // every coordinate as inches. $INSUNITS and $MEASUREMENT came with R2000;
  // AutoCAD reads them by name from older files too, and R12-only readers skip them.
  pair(9, '$LUNITS'); pair(70, 2)
  pair(9, '$LUPREC'); pair(70, options.precision > 6 ? 8 : 4)
  pair(9, '$INSUNITS'); pair(70, options.insunits)
  pair(9, '$MEASUREMENT'); pair(70, options.metric ? 1 : 0)
  pair(9, '$INSBASE'); xyz(10, [0, 0, 0], 0)
  pair(9, '$EXTMIN'); xyz(10, [minX, minY, minZ], 0, true)
  pair(9, '$EXTMAX'); xyz(10, [maxX, maxY, maxZ], 0, true)
  pair(0, 'ENDSEC')

  pair(0, 'SECTION'); pair(2, 'TABLES')
  pair(0, 'TABLE'); pair(2, 'LTYPE'); pair(70, 1)
  pair(0, 'LTYPE'); pair(2, 'CONTINUOUS'); pair(70, 0); pair(3, 'Solid line'); pair(72, 65); pair(73, 0); pair(40, '0.0')
  pair(0, 'ENDTAB')
  const allLayers = new Set<string>(['0', ...layerAci.keys()])
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, allLayers.size)
  for (const layer of allLayers) {
    pair(0, 'LAYER'); pair(2, dxfString(layer)); pair(70, 0); pair(62, layerAci.get(layer) ?? 7); pair(6, 'CONTINUOUS')
  }
  pair(0, 'ENDTAB')
  pair(0, 'TABLE'); pair(2, 'STYLE'); pair(70, 1)
  pair(0, 'STYLE'); pair(2, 'STANDARD'); pair(70, 0); pair(40, '0.0'); pair(41, '1.0'); pair(50, '0.0'); pair(71, 0); pair(42, '2.5'); pair(3, 'txt'); pair(4, '')
  pair(0, 'ENDTAB')
  pair(0, 'ENDSEC')

  pair(0, 'SECTION'); pair(2, 'BLOCKS'); pair(0, 'ENDSEC')

  pair(0, 'SECTION'); pair(2, 'ENTITIES')
  const head = (type: string, f: Feature) => {
    const layer = names.name(f.layer)
    pair(0, type); pair(8, dxfString(layer))
    const aci = aciOf(f.color)
    if (aci !== layerAci.get(layer)) pair(62, aci)
    return layer
  }
  const polyline = (f: Feature, c: number[], closed: boolean) => {
    const layer = head('POLYLINE', f)
    pair(66, 1)
    pair(10, '0'); pair(20, '0'); pair(30, '0')
    pair(70, (closed ? 1 : 0) | (options.use3d ? 8 : 0))
    for (let i = 0; i < c.length; i += 3) {
      pair(0, 'VERTEX'); pair(8, dxfString(layer))
      xyz(10, c, i)
      if (options.use3d) pair(70, 32)
    }
    pair(0, 'SEQEND'); pair(8, dxfString(layer))
  }
  for (const f of features) {
    const g = f.geometry
    switch (g.type) {
      case 'point':
        head('POINT', f)
        xyz(10, g.at, 0)
        break
      case 'text':
        head('TEXT', f)
        xyz(10, g.at, 0)
        pair(40, fmt(g.height || options.textHeight, p))
        pair(1, dxfString(g.text))
        if (g.rotation) pair(50, fmt(g.rotation, 4))
        break
      case 'line':
        if (g.coords.length >= 6) polyline(f, g.coords, g.closed)
        break
      case 'polygon':
        for (const ring of g.rings) polyline(f, ring, true)
        break
    }
  }
  pair(0, 'ENDSEC')
  pair(0, 'EOF')

  const notes: Note[] = []
  const renamed = names.renamedCount()
  if (renamed) {
    const examples = names.entries().filter(([raw, n]) => raw.trim() !== '' && raw !== n).slice(0, 3).map(([raw, n]) => `“${raw}” → ${n}`)
    notes.push({ level: 'info', text: `${renamed} layer name${renamed === 1 ? ' was' : 's were'} shortened or cleaned to fit DXF R12 (up to 31 letters, digits, $, - and _): ${examples.join(', ')}${renamed > 3 ? ', …' : ''}.` })
  }
  return { text: out.join('\r\n') + '\r\n', notes, layerNames: new Map(names.entries()) }
}
