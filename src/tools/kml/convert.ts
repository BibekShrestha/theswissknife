/**
 * The two pipelines, as plain functions over bytes (run in the worker, tested
 * in Node): KML/KMZ → project → DXF, and DXF → unproject → KML/KMZ. Each
 * returns its output plus a summary, notes and a preview of the drawing.
 */

import { readDxf, decodeDxf, versionName, DxfError } from './dxf/read'
import { writeDxf } from './dxf/write'
import { readKml, KmlError } from './kml/read'
import { declaredEncoding } from './kml/xml'
import { writeKml } from './kml/write'
import { plural, vertexCount, type Feature, type Geometry, type Note } from './model'
import { buildPreview, type Preview } from './preview'
import { CrsError, LONLAT, parseProj, utmProj, utmZoneFor, UNITS, type Crs } from './proj/crs'

export type Direction = 'kml-to-dxf' | 'dxf-to-kml'

/** Units the DXF can be written in; 'crs' keeps the coordinate system's own. */
export type DxfUnit = 'crs' | 'm' | 'ft' | 'us-ft' | 'mm'

export interface KmlToDxfOptions {
  /** A PROJ string, or 'utm-auto' for the UTM zone at the data's centre. */
  crs: string
  units: DxfUnit
  altitude: boolean
  labels: boolean
  /** One layer per folder, or everything on one layer. */
  folders: boolean
}

export interface DxfToKmlOptions {
  /** A PROJ string; empty when the user hasn't chosen one yet. */
  crs: string
  /** 'auto' follows $INSUNITS; otherwise a key of UNITS. */
  units: string
  altitude: boolean
  polygons: boolean
  texts: boolean
  includeHidden: boolean
  kmz: boolean
}

export interface Output {
  name: string
  mime: string
  data: string | Uint8Array<ArrayBuffer>
  size: number
}

export interface Summary {
  direction: Direction
  output?: Output
  /** DXF → KML only: no CRS chosen yet, so there is no output. */
  needsCrs?: boolean
  crs?: { label: string; proj: string }
  /** DXF → KML: what the file itself suggests (our CRS comment, or degrees). */
  suggestion?: { proj: string; reason: string }
  facts: [string, string][]
  counts: [string, number][]
  hasZ: boolean
  /** DXF → KML: the header's $INSUNITS, for the units menu. */
  insunits?: number
  notes: Note[]
  preview: Preview
}

export type ConvertResult = { ok: true; summary: Summary } | { ok: false; error: string }

const ZIP = [0x50, 0x4b, 0x03, 0x04]

function isZip(bytes: Uint8Array) {
  return ZIP.every((b, i) => bytes[i] === b)
}

export function stem(name: string) {
  return name.replace(/\.[^./\\]*$/, '') || 'converted'
}

/** $INSUNITS codes that name a length, in metres. */
export const INSUNITS: Record<number, { key: string; metres: number }> = {
  1: { key: 'in', metres: 0.0254 }, 2: { key: 'ft', metres: 0.3048 }, 3: { key: 'mi', metres: 1609.344 },
  4: { key: 'mm', metres: 0.001 }, 5: { key: 'cm', metres: 0.01 }, 6: { key: 'm', metres: 1 },
  7: { key: 'km', metres: 1000 }, 10: { key: 'yd', metres: 0.9144 }, 14: { key: 'dm', metres: 0.1 },
  21: { key: 'us-ft', metres: 1200 / 3937 }, 23: { key: 'us-yd', metres: 3600 / 3937 },
}

function mapCoords(g: Geometry, fn: (c: number[]) => number[]): Geometry {
  switch (g.type) {
    case 'point': return { type: 'point', at: fn(g.at) }
    case 'text': return { ...g, at: fn(g.at) }
    case 'line': return { ...g, coords: fn(g.coords) }
    case 'polygon': return { type: 'polygon', rings: g.rings.map(fn) }
  }
}

function eachCoord(features: Feature[], fn: (x: number, y: number, z: number) => void) {
  for (const f of features) {
    const g = f.geometry
    const visit = (c: number[]) => { for (let i = 0; i < c.length; i += 3) fn(c[i], c[i + 1], c[i + 2]) }
    if (g.type === 'point' || g.type === 'text') visit(g.at)
    else if (g.type === 'line') visit(g.coords)
    else g.rings.forEach(visit)
  }
}

function bounds(features: Feature[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  eachCoord(features, (x, y) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })
  return { minX, minY, maxX, maxY }
}

/** A round label height: about 1/400 of the drawing's larger side. */
function labelHeight(features: Feature[]) {
  const b = bounds(features)
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY)
  if (!(size > 0)) return 1
  const raw = size / 400
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? raw
}

function fmtNumber(n: number, digits: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

function lonLatBox(features: Feature[]): string {
  const b = bounds(features)
  if (!(b.maxX >= b.minX)) return '—'
  const f = (n: number) => n.toFixed(5)
  return `${f(b.minY)}, ${f(b.minX)} → ${f(b.maxY)}, ${f(b.maxX)}`
}

function featureCounts(features: Feature[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const f of features) {
    const key = f.geometry.type === 'line' ? (f.geometry.closed ? 'closed line' : 'line') : f.geometry.type === 'polygon' ? 'polygon' : f.geometry.type === 'text' ? 'label' : 'point'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
}

function resolveCrs(spec: string, features: Feature[]): Crs {
  if (spec !== 'utm-auto') return parseProj(spec)
  const b = bounds(features)
  const lon = (b.minX + b.maxX) / 2, lat = (b.minY + b.maxY) / 2
  const zone = utmZoneFor(lon, lat)
  return parseProj(utmProj(zone, lat < 0))
}

async function kmlText(bytes: Uint8Array): Promise<{ text: string; inner?: string; notes: Note[] }> {
  const notes: Note[] = []
  if (isZip(bytes)) {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(bytes)
    const kmls = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name))
    if (!kmls.length) throw new KmlError('This KMZ has no .kml file inside')
    // Google Earth reads the first .kml at the root (doc.kml by convention).
    const main = kmls.find((f) => f.name.toLowerCase() === 'doc.kml') ?? kmls.find((f) => !f.name.includes('/')) ?? kmls[0]
    const others = Object.values(zip.files).filter((f) => !f.dir && f !== main).length
    if (others) notes.push({ level: 'info', text: `Read ${main.name} from the KMZ; ${plural(others, 'other file')} in it (images, models, more KML) were not used.` })
    const inner = await main.async('uint8array')
    return { text: decodeKml(inner), inner: main.name, notes }
  }
  return { text: decodeKml(bytes), notes }
}

function decodeKml(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const label = declaredEncoding(head)
  if (label && !/^utf-?8$/i.test(label)) {
    try { return new TextDecoder(label).decode(bytes) } catch { /* unknown label: fall through to UTF-8 */ }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

export async function kmlToDxf(name: string, bytes: Uint8Array, options: KmlToDxfOptions): Promise<ConvertResult> {
  try {
    const source = await kmlText(bytes)
    const read = readKml(source.text)
    const notes: Note[] = [...source.notes, ...read.notes]
    const crs = resolveCrs(options.crs, read.features)
    if (crs.datumWarning) notes.unshift({ level: 'warn', text: crs.datumWarning })

    // The drawing unit: the CRS's own, or another length the user picked
    // (projected coordinates are then rescaled; degrees stay degrees).
    const outKey = crs.kind === 'geographic' || options.units === 'crs' ? null : options.units
    const outMetres = outKey ? UNITS[outKey].metres : crs.unitMetres
    const scale = crs.kind === 'geographic' ? 1 : crs.unitMetres / outMetres
    const outLabel = crs.kind === 'geographic' ? 'degrees' : outKey ? UNITS[outKey].label : crs.unitLabel
    const insunits = crs.kind === 'geographic' ? 0 : Number(Object.entries(INSUNITS).find(([, u]) => Math.abs(u.metres - outMetres) < 1e-12)?.[0] ?? 0)

    let failed = 0
    const project = (c: number[]) => {
      const out: number[] = []
      for (let i = 0; i < c.length; i += 3) {
        const [x, y] = crs.forward(c[i], c[i + 1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) { failed++; continue }
        out.push(x * scale, y * scale, c[i + 2] / (crs.kind === 'geographic' ? 1 : outMetres))
      }
      return out
    }
    // Transverse Mercator's scale grows away from the central meridian:
    // k ≈ 1 / √(1 − (cos φ · sin Δλ)²) on the sphere, a fair guide here.
    let stretch = 0
    if (crs.centralMeridian !== undefined) {
      const cm = crs.centralMeridian
      eachCoord(read.features, (lon, lat) => {
        const s = Math.cos((lat * Math.PI) / 180) * Math.sin(((lon - cm) * Math.PI) / 180)
        stretch = Math.max(stretch, 1 / Math.sqrt(Math.max(1e-12, 1 - s * s)) - 1)
      })
    }

    const features: Feature[] = []
    for (const f of read.features) {
      const geometry = mapCoords(f.geometry, project)
      if (vertexCount(geometry) === 0 || (geometry.type === 'line' && geometry.coords.length < 6)) continue
      const layer = options.folders ? f.layer : ''
      features.push({ ...f, geometry, layer })
    }
    if (failed) notes.push({ level: 'warn', text: `${plural(failed, 'coordinate')} could not be projected into ${crs.label} and ${failed === 1 ? 'was' : 'were'} left out.` })
    if (!features.length) return { ok: false, error: `Nothing could be projected into ${crs.label}.` }
    if (stretch > 0.0025) notes.push({ level: 'warn', text: `The data reaches far from the projection's central meridian (${crs.centralMeridian}°), where Transverse Mercator stretches distances by up to ${(stretch * 100).toFixed(1)}%. A zone nearer the data, or a coordinate system made for the whole area, draws truer.` })

    const height = labelHeight(features)
    if (options.labels) {
      for (const f of [...features]) {
        if (f.geometry.type === 'point' && f.name.trim()) {
          features.push({ ...f, geometry: { type: 'text', at: [f.geometry.at[0] + height * 0.6, f.geometry.at[1] + height * 0.6, f.geometry.at[2]], text: f.name.trim(), height, rotation: 0 }, source: 'label' })
        }
      }
    }

    const layerOrder = options.folders ? read.layers : ['']
    const written = writeDxf(features, layerOrder, {
      comments: [
        `Converted from ${name} by The Swiss Knife (theswissknife.com/kml)`,
        // Only written when the coordinates are the CRS's own, so reading it back is exact.
        ...(scale === 1 ? [`CRS: ${crs.proj}`] : [`Projection: ${crs.proj}, coordinates rescaled from ${crs.unitLabel} to ${outLabel}`]),
        `Units: ${outLabel}`,
      ],
      precision: crs.kind === 'geographic' ? 9 : 4,
      use3d: options.altitude,
      textHeight: height,
      insunits,
      metric: crs.kind === 'geographic' || outMetres === 1 || outMetres === 0.001 || outMetres === 1000,
    })
    notes.push(...written.notes)
    if (read.hasAltitude && !options.altitude) notes.push({ level: 'info', text: 'The KML has altitudes; they were dropped (every vertex at Z = 0). Tick “Altitude as Z” to keep them as 3D polylines.' })
    if (options.altitude && read.hasAltitude) notes.push({ level: 'info', text: `Z values are the KML altitudes${crs.kind === 'projected' && outMetres !== 1 ? `, converted from metres to ${outLabel}` : ' in metres'} — above sea level or ground, as each placemark's altitude mode says.` })
    if (scale !== 1) notes.push({ level: 'info', text: `Coordinates are ${crs.label} values converted from ${crs.unitLabel} to ${outLabel}, so they no longer match that grid's published eastings and northings — distances and areas are right in ${outLabel}.` })
    if (crs.kind === 'projected' && !insunits) notes.push({ level: 'warn', text: `AutoCAD has no unit code for ${outLabel}, so the file says “unitless”. Set the drawing's units by hand after opening it.` })
    if (read.features.some((f) => f.geometry.type === 'polygon')) notes.push({ level: 'info', text: 'Polygons became closed polylines (one per ring); DXF R12 has no fill.' })

    const b = bounds(features)
    const units = crs.kind === 'geographic' ? '°' : ` ${outLabel}`
    const outName = `${stem(name)}.dxf`
    return {
      ok: true,
      summary: {
        direction: 'kml-to-dxf',
        output: { name: outName, mime: 'application/dxf', data: written.text, size: written.text.length },
        crs: { label: crs.label, proj: crs.proj },
        facts: [
          ['Coordinate system', crs.label],
          ['Area (lat, lon)', lonLatBox(read.features)],
          ['Drawing extents', `${fmtNumber(b.maxX - b.minX, 2)} × ${fmtNumber(b.maxY - b.minY, 2)}${units}`],
          ['Drawing units', crs.kind === 'geographic' ? 'degrees (unitless in CAD)' : `${outLabel}, decimal${insunits ? ` ($INSUNITS ${insunits})` : ''}`],
          ['Layers', String(new Set(features.map((f) => written.layerNames.get(f.layer) ?? f.layer)).size)],
          ...(options.labels && features.some((f) => f.source === 'label') ? [['Label height', `${fmtNumber(height, 4)}${units}`] as [string, string]] : []),
          ['DXF', 'AutoCAD R12 (AC1009), ASCII'],
        ],
        counts: featureCounts(features),
        hasZ: read.hasAltitude,
        notes,
        preview: buildPreview(features),
      },
    }
  } catch (error) {
    return failure(error)
  }
}

function failure(error: unknown): ConvertResult {
  if (error instanceof KmlError || error instanceof DxfError || error instanceof CrsError) return { ok: false, error: error.message }
  return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
}

/** What the bytes are, or why they can't be read here. */
export function sniff(bytes: Uint8Array, name: string): Direction | { error: string } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  if (/^AC10\d\d/.test(head)) return { error: 'This is a DWG file — AutoCAD’s closed binary format, which can’t be read in the browser. In AutoCAD (or the free DWG TrueView / ODA File Converter), save it as DXF and drop that here.' }
  if (head.startsWith('AutoCAD Binary DXF')) return { error: 'This is a binary DXF. Save it from AutoCAD as an ASCII DXF (the default) and drop that here.' }
  if (isZip(bytes)) return 'kml-to-dxf'
  if (/<kml[\s>]|<\?xml|<Document[\s>]|<Placemark[\s>]/.test(head) || /\.kml$/i.test(name)) return 'kml-to-dxf'
  if (/^\s*0\s*\r?\n\s*SECTION/.test(head.replace(/^﻿/, '')) || /^\s*999\s*\r?\n/.test(head) || /\.dxf$/i.test(name)) return 'dxf-to-kml'
  return { error: 'Not a KML, KMZ or DXF file.' }
}

/** Does every coordinate fit in longitude/latitude ranges, with the drawing small enough to be degrees? */
function looksLikeDegrees(features: Feature[]) {
  const b = bounds(features)
  return b.minX >= -180 && b.maxX <= 180 && b.minY >= -90 && b.maxY <= 90 && b.maxX > b.minX
}

function looksLikeUtm(features: Feature[]) {
  const b = bounds(features)
  return b.minX > 100_000 && b.maxX < 900_000 && b.minY > -1 && b.maxY < 10_000_000 && b.maxX - b.minX < 800_000
}

// Parsed DXF is cached between runs: changing the CRS or a checkbox re-uses it.
let cache: { key: string; read: ReturnType<typeof readDxf>; encoding: string } | null = null

export async function dxfToKml(name: string, bytes: Uint8Array, options: DxfToKmlOptions, cacheKey = ''): Promise<ConvertResult> {
  try {
    const key = `${cacheKey}|${options.includeHidden}`
    let entry = cacheKey && cache?.key === key ? cache : null
    if (!entry) {
      const { text, encoding } = decodeDxf(bytes)
      entry = { key, read: readDxf(text, { includeHidden: options.includeHidden }), encoding }
      if (cacheKey) cache = entry
    }
    const { read, encoding } = entry
    const notes: Note[] = [...read.notes]
    const drawn = options.texts ? read.features : read.features.filter((f) => f.geometry.type !== 'text')
    if (!drawn.length) return { ok: false, error: read.features.length ? 'The drawing only has text, and “Text as labels” is off.' : 'No drawable entities were found in the model space of this DXF.' }

    let suggestion: Summary['suggestion']
    if (read.crsComment) suggestion = { proj: read.crsComment, reason: 'The file says it was drawn in this coordinate system (a CRS comment written by this tool).' }
    else if (looksLikeDegrees(drawn)) suggestion = { proj: LONLAT, reason: 'Every coordinate is within longitude/latitude ranges, so the drawing may be in degrees.' }

    const b = bounds(drawn)
    // With no $INSUNITS, architectural or engineering $LUNITS still pin the unit: AutoCAD draws them in inches.
    const inchUnits = !read.insunits && (read.lunits === 3 || read.lunits === 4)
    const unitEntry = options.units === 'auto'
      ? (read.insunits ? INSUNITS[read.insunits] : inchUnits ? INSUNITS[1] : undefined)
      : { key: options.units, metres: UNITS[options.units]?.metres ?? 1 }
    if (options.units === 'auto' && inchUnits) notes.push({ level: 'info', text: `The drawing uses ${read.lunits === 4 ? 'architectural' : 'engineering'} units and sets no $INSUNITS, which AutoCAD reads as inches — so inches were assumed. Pick the drawing units if that's wrong.` })
    const facts: [string, string][] = [
      ['DXF', `${versionName(read.version)}${encoding !== 'UTF-8' ? `, ${encoding} text` : ''}`],
      ['Drawing extents', `${fmtNumber(b.minX, 3)}, ${fmtNumber(b.minY, 3)} → ${fmtNumber(b.maxX, 3)}, ${fmtNumber(b.maxY, 3)}`],
      ['Drawing units', unitEntry ? UNITS[unitEntry.key]?.label ?? unitEntry.key : read.insunits ? `$INSUNITS ${read.insunits} (not a length this tool knows)` : 'not set in the file'],
      ['Layers', String(new Set(drawn.map((f) => f.layer)).size)],
    ]
    const base = {
      direction: 'dxf-to-kml' as const,
      suggestion,
      counts: read.counts,
      hasZ: read.hasZ,
      insunits: read.insunits || (inchUnits ? 1 : undefined),
      preview: buildPreview(drawn),
    }
    if (!options.crs) {
      if (!suggestion && looksLikeUtm(drawn)) notes.unshift({ level: 'info', text: 'The coordinates look like UTM eastings and northings — pick the zone the drawing was made in.' })
      return { ok: true, summary: { ...base, needsCrs: true, facts, notes } }
    }

    const crs = parseProj(options.crs)
    if (crs.datumWarning) notes.unshift({ level: 'warn', text: crs.datumWarning })
    const toCrs = crs.kind === 'geographic' ? 1 : (unitEntry?.metres ?? crs.unitMetres) / crs.unitMetres
    const zMetres = unitEntry?.metres ?? (crs.kind === 'projected' ? crs.unitMetres : 1)
    if (crs.kind === 'projected' && !unitEntry) notes.push({ level: 'info', text: `The DXF doesn't say what its units are, so drawing units were taken as the CRS's ${crs.unitLabel}. Pick the drawing units if that's wrong.` })

    let bad = 0
    // A coordinate is kept only if it is inside the CRS's domain: degrees in
    // range, or projected values that survive the round trip back (outside
    // its valid area a projection's inverse returns plausible-looking garbage).
    const valid = (x: number, y: number, lon: number, lat: number) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return false
      if (crs.kind === 'geographic') return Math.abs(y) <= 90 && Math.abs(x) <= 540
      const [fx, fy] = crs.forward(lon, lat)
      return Math.abs(fx - x) + Math.abs(fy - y) < 0.01 / crs.unitMetres + 1e-9 * (Math.abs(x) + Math.abs(y))
    }
    const unproject = (c: number[]) => {
      const out: number[] = []
      for (let i = 0; i < c.length; i += 3) {
        const x = c[i] * toCrs, y = c[i + 1] * toCrs
        let [lon, lat] = crs.inverse(x, y)
        if (!valid(x, y, lon, lat)) { bad++; continue }
        lon = ((((lon + 180) % 360) + 360) % 360) - 180
        out.push(lon, lat, c[i + 2] * zMetres)
      }
      return out
    }
    const features: Feature[] = []
    for (const f of drawn) {
      const geometry = mapCoords(f.geometry, unproject)
      if (vertexCount(geometry) === 0 || (geometry.type === 'line' && geometry.coords.length < 6)) continue
      features.push({ ...f, geometry })
    }
    if (!features.length) return { ok: false, error: `No coordinate lands on the Earth in ${crs.label}. Check the coordinate system and the drawing units.` }
    if (bad) notes.push({ level: 'warn', text: `${plural(bad, 'vertex', 'vertices')} fell outside the valid range of ${crs.label} and ${bad === 1 ? 'was' : 'were'} left out — check the coordinate system and units.` })

    const geo = bounds(features)
    if (crs.kind === 'projected' && (geo.maxX - geo.minX > 30 || geo.maxY - geo.minY > 30)) {
      notes.push({ level: 'warn', text: `The result spans ${Math.round(geo.maxX - geo.minX)}° of longitude and ${Math.round(geo.maxY - geo.minY)}° of latitude — far more than a site drawing usually covers. The coordinate system or the drawing units may be wrong.` })
    }
    if (read.hasZ && !options.altitude) notes.push({ level: 'info', text: 'The drawing has elevations; the KML is clamped to the ground. Tick “Z as altitude” to place it at absolute heights.' })

    const kml = writeKml(features, { documentName: stem(name), altitude: options.altitude, polygons: options.polygons, layerOrder: read.layers })
    let output: Output
    if (options.kmz) {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      zip.file('doc.kml', kml)
      const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }) as Uint8Array<ArrayBuffer>
      output = { name: `${stem(name)}.kmz`, mime: 'application/vnd.google-earth.kmz', data, size: data.length }
    } else {
      output = { name: `${stem(name)}.kml`, mime: 'application/vnd.google-earth.kml+xml', data: kml, size: new TextEncoder().encode(kml).length }
    }

    return {
      ok: true,
      summary: {
        ...base,
        output,
        crs: { label: crs.label, proj: crs.proj },
        facts: [...facts, ['Area (lat, lon)', lonLatBox(features)]],
        notes,
      },
    }
  } catch (error) {
    return failure(error)
  }
}
