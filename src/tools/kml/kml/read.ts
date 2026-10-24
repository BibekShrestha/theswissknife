/**
 * KML → features. Folders become layers (their path, outermost first);
 * styles are resolved through styleUrl and StyleMap's "normal" pair, with an
 * inline Style overriding a shared one. Geometry: Point, LineString,
 * LinearRing, Polygon (with holes), MultiGeometry, gx:Track / gx:MultiTrack
 * and Model (its location). Overlays and network links are counted, not read.
 */

import { Tally, type Feature, type Geometry, type Note, type Rgb } from '../model'
import { child, childText, parseXml, type XmlElement } from './xml'

export interface KmlRead {
  features: Feature[]
  /** Layer paths in document order. */
  layers: string[]
  documentName: string
  /** True when any coordinate carries a non-zero altitude. */
  hasAltitude: boolean
  notes: Note[]
}

interface Style {
  line?: Rgb
  lineWidth?: number
  icon?: Rgb
  fill?: { color: Rgb; alpha: number } | null
}

export class KmlError extends Error {}

/** KML colours are aabbggrr hex. */
export function parseKmlColor(text: string | undefined): { rgb: Rgb; alpha: number } | undefined {
  const hex = text?.trim().replace(/^#/, '')
  if (!hex || !/^[0-9a-fA-F]{8}$/.test(hex)) return undefined
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return { rgb: { r: n(6), g: n(4), b: n(2) }, alpha: n(0) / 255 }
}

function readStyle(el: XmlElement): Style {
  const style: Style = {}
  const line = child(el, 'LineStyle')
  if (line) {
    const color = parseKmlColor(childText(line, 'color'))
    if (color) style.line = color.rgb
    const width = Number(childText(line, 'width'))
    if (width > 0) style.lineWidth = width
  }
  const icon = child(el, 'IconStyle')
  if (icon) {
    const color = parseKmlColor(childText(icon, 'color'))
    if (color) style.icon = color.rgb
  }
  const poly = child(el, 'PolyStyle')
  if (poly) {
    const color = parseKmlColor(childText(poly, 'color'))
    const fill = childText(poly, 'fill')
    if (fill === '0' || fill === 'false') style.fill = null
    else if (color) style.fill = { color: color.rgb, alpha: color.alpha }
  }
  return style
}

function merge(base: Style | undefined, over: Style | undefined): Style {
  return { ...base, ...over }
}

/** Tuples split on whitespace, values on commas; "lon, lat" with stray spaces is tolerated. */
export function parseCoordinates(text: string, bad: { count: number }): number[] {
  const out: number[] = []
  const cleaned = text.replace(/\s*,\s*/g, ',').trim()
  if (!cleaned) return out
  for (const tuple of cleaned.split(/\s+/)) {
    const parts = tuple.split(',')
    const lon = Number(parts[0]), lat = Number(parts[1])
    const alt = parts.length > 2 && parts[2] !== '' ? Number(parts[2]) : 0
    if (parts.length < 2 || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 540 || !Number.isFinite(alt)) {
      bad.count++
      continue
    }
    out.push(lon, lat, alt)
  }
  return out
}

/** Drops a closing vertex that repeats the first; returns whether it did. */
function unclose(coords: number[]): boolean {
  const n = coords.length
  if (n < 6) return false
  if (coords[0] === coords[n - 3] && coords[1] === coords[n - 2] && coords[2] === coords[n - 1]) {
    coords.length = n - 3
    return true
  }
  return false
}

export function readKml(text: string): KmlRead {
  let doc: XmlElement
  try {
    doc = parseXml(text)
  } catch (error) {
    throw new KmlError(error instanceof Error ? error.message : String(error))
  }
  const root = doc.children.find((c) => c.local === 'kml') ?? doc.children[0]
  if (!root) throw new KmlError('No XML elements found — this is not a KML file')
  if (root.local !== 'kml' && !['Document', 'Folder', 'Placemark'].includes(root.local)) {
    throw new KmlError(`The root element is <${root.name}>, not <kml>`)
  }

  const styles = new Map<string, Style>()
  const styleMaps = new Map<string, string>()
  const collectStyles = (el: XmlElement, depth: number) => {
    if (depth > 64) return
    for (const c of el.children) {
      const id = c.attrs.id
      if (c.local === 'Style' && id) styles.set(id, readStyle(c))
      else if (c.local === 'StyleMap' && id) {
        const normal = c.children.find((pair) => pair.local === 'Pair' && childText(pair, 'key') === 'normal')
        const url = normal && childText(normal, 'styleUrl')
        if (url) styleMaps.set(id, url)
        const inline = normal && child(normal, 'Style')
        if (inline) styles.set(id, readStyle(inline))
      } else if (c.local === 'Document' || c.local === 'Folder' || c.local === 'kml') collectStyles(c, depth + 1)
    }
  }
  collectStyles(root.local === 'kml' ? root : doc, 0)

  const resolve = (url: string | undefined, hops = 0): Style | undefined => {
    if (!url || !url.startsWith('#') || hops > 4) return undefined
    const id = url.slice(1)
    if (styles.has(id)) return styles.get(id)
    const mapped = styleMaps.get(id)
    return mapped ? resolve(mapped, hops + 1) : undefined
  }

  const features: Feature[] = []
  const layers: string[] = []
  const layerSeen = new Set<string>()
  const skipped = new Tally()
  const bad = { count: 0 }
  let hasAltitude = false
  let documentName = ''

  const addLayer = (path: string) => {
    if (!layerSeen.has(path)) { layerSeen.add(path); layers.push(path) }
  }

  const geometries = (el: XmlElement, out: Geometry[], depth: number) => {
    if (depth > 32) return
    switch (el.local) {
      case 'Point': {
        const coords = parseCoordinates(childText(el, 'coordinates') ?? '', bad)
        if (coords.length >= 3) out.push({ type: 'point', at: coords.slice(0, 3) })
        break
      }
      case 'LineString': {
        const coords = parseCoordinates(childText(el, 'coordinates') ?? '', bad)
        const closed = unclose(coords)
        if (coords.length >= 6) out.push({ type: 'line', coords, closed })
        else if (coords.length) skipped.add('line with fewer than two points')
        break
      }
      case 'LinearRing': {
        const coords = parseCoordinates(childText(el, 'coordinates') ?? '', bad)
        unclose(coords)
        if (coords.length >= 6) out.push({ type: 'line', coords, closed: true })
        break
      }
      case 'Polygon': {
        const rings: number[][] = []
        const ringsOf = (boundary: XmlElement | undefined) => {
          for (const ring of boundary?.children ?? []) {
            if (ring.local !== 'LinearRing') continue
            const coords = parseCoordinates(childText(ring, 'coordinates') ?? '', bad)
            unclose(coords)
            if (coords.length >= 9) rings.push(coords)
          }
        }
        ringsOf(child(el, 'outerBoundaryIs'))
        if (!rings.length) { skipped.add('polygon without an outer boundary'); break }
        for (const inner of el.children) if (inner.local === 'innerBoundaryIs') ringsOf(inner)
        out.push({ type: 'polygon', rings })
        break
      }
      case 'MultiGeometry':
        for (const c of el.children) geometries(c, out, depth + 1)
        break
      case 'MultiTrack':
        for (const c of el.children) if (c.local === 'Track') geometries(c, out, depth + 1)
        break
      case 'Track': {
        const coords: number[] = []
        for (const c of el.children) {
          if (c.local !== 'coord') continue
          const parts = c.text.trim().split(/\s+/).map(Number)
          if (parts.length >= 2 && parts.every(Number.isFinite)) coords.push(parts[0], parts[1], parts[2] ?? 0)
          else bad.count++
        }
        if (coords.length >= 6) out.push({ type: 'line', coords, closed: false })
        else if (coords.length === 3) out.push({ type: 'point', at: coords })
        break
      }
      case 'Model': {
        const location = child(el, 'Location')
        const lon = Number(location && childText(location, 'longitude'))
        const lat = Number(location && childText(location, 'latitude'))
        if (location && Number.isFinite(lon) && Number.isFinite(lat)) {
          out.push({ type: 'point', at: [lon, lat, Number(childText(location, 'altitude')) || 0] })
        }
        skipped.add('3D model (placed as a point)')
        break
      }
    }
  }

  const placemark = (el: XmlElement, layer: string) => {
    const name = childText(el, 'name') ?? ''
    const inline = child(el, 'Style')
    const style = merge(resolve(childText(el, 'styleUrl')), inline ? readStyle(inline) : undefined)
    const parts: Geometry[] = []
    for (const c of el.children) geometries(c, parts, 0)
    if (!parts.length) { skipped.add('placemark without geometry'); return }
    addLayer(layer)
    for (const geometry of parts) {
      const isPoint = geometry.type === 'point'
      features.push({
        geometry,
        name,
        layer,
        color: (isPoint ? style.icon : style.line) ?? null,
        fill: geometry.type === 'polygon' ? style.fill : undefined,
        source: 'Placemark',
      })
      const coords = geometry.type === 'point' ? geometry.at : geometry.type === 'line' ? geometry.coords : geometry.type === 'polygon' ? geometry.rings.flat() : []
      if (!hasAltitude) for (let i = 2; i < coords.length; i += 3) if (coords[i] !== 0) { hasAltitude = true; break }
    }
  }

  const walk = (el: XmlElement, path: string[], depth: number) => {
    if (depth > 64) { skipped.add('folder nested more than 64 deep'); return }
    for (const c of el.children) {
      switch (c.local) {
        case 'Document':
        case 'Folder': {
          const name = childText(c, 'name') ?? ''
          // The outermost Document names the file, not a layer.
          if (c.local === 'Document' && depth === 0 && !path.length) {
            documentName ||= name
            walk(c, path, depth + 1)
          } else {
            walk(c, [...path, name || 'Untitled folder'], depth + 1)
          }
          break
        }
        case 'Placemark':
          placemark(c, path.join(' / '))
          break
        case 'NetworkLink': skipped.add('network link (not fetched)'); break
        case 'GroundOverlay': skipped.add('ground overlay image'); break
        case 'ScreenOverlay': skipped.add('screen overlay'); break
        case 'PhotoOverlay': skipped.add('photo overlay'); break
      }
    }
  }
  if (root.local === 'Placemark') placemark(root, '')
  else walk(root.local === 'kml' ? root : doc, [], 0)

  const notes: Note[] = []
  if (bad.count) notes.push({ level: 'warn', text: `${bad.count.toLocaleString('en-US')} coordinate tuples could not be read (not "lon,lat[,alt]" numbers in range) and were left out.` })
  for (const [what, n] of skipped.entries()) {
    notes.push({ level: what.startsWith('3D model') ? 'info' : 'warn', text: `${n.toLocaleString('en-US')} × ${what}${what.startsWith('3D model') ? '' : ' — skipped'}.` })
  }
  if (!features.length) throw new KmlError('No placemarks with geometry were found in this KML')
  return { features, layers, documentName, hasAltitude, notes }
}
