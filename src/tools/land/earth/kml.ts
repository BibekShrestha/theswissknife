/**
 * The closed shapes in a Google Earth KML: every Polygon (outer boundary and
 * holes), plus closed LineStrings and LinearRings, inside MultiGeometry and
 * folders. Open paths and points are listed by name as skipped, so a plot
 * drawn with the Path tool instead of the Polygon tool is explained rather
 * than silently missing. Coordinates are kept as lon, lat pairs.
 */

import { child, childText, parseXml, type XmlElement } from './xml'

export interface Shape {
  /** The placemark's name, or "Shape n". */
  name: string
  /** Folder path, outermost first. */
  folder: string
  /** Outer ring first, then holes; flat lon, lat pairs, not closed. */
  rings: number[][]
}

export interface ShapesRead {
  shapes: Shape[]
  /** Names of open paths, which have no area. */
  paths: string[]
  points: number
  badCoordinates: number
}

export class KmlError extends Error {}

/** "lon,lat[,alt]" tuples separated by whitespace; stray spaces around commas tolerated. */
function ring(text: string, bad: { count: number }): number[] {
  const out: number[] = []
  const cleaned = text.replace(/\s*,\s*/g, ',').trim()
  if (!cleaned) return out
  for (const tuple of cleaned.split(/\s+/)) {
    const [lon, lat] = tuple.split(',').map(Number)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 540) { bad.count++; continue }
    const n = out.length
    // Repeated vertices add nothing to an outline.
    if (n && out[n - 2] === lon && out[n - 1] === lat) continue
    out.push(lon, lat)
  }
  // KML closes rings by repeating the first vertex; the area maths doesn't want it.
  if (out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2
  return out
}

export function readShapes(text: string): ShapesRead {
  let doc: XmlElement
  try {
    doc = parseXml(text)
  } catch (error) {
    throw new KmlError(error instanceof Error ? error.message : String(error))
  }
  const root = doc.children.find((c) => c.local === 'kml') ?? doc.children[0]
  if (!root || !['kml', 'Document', 'Folder', 'Placemark'].includes(root.local)) throw new KmlError('This is not a KML file')

  const shapes: Shape[] = []
  const paths: string[] = []
  const bad = { count: 0 }
  let points = 0

  const geometry = (el: XmlElement, name: string, folder: string, depth: number) => {
    if (depth > 32) return
    switch (el.local) {
      case 'Polygon': {
        const outer = child(child(el, 'outerBoundaryIs') ?? el, 'LinearRing')
        const rings = [ring((outer && childText(outer, 'coordinates')) ?? '', bad)]
        if (rings[0].length < 6) return
        for (const inner of el.children) {
          if (inner.local !== 'innerBoundaryIs') continue
          for (const lr of inner.children) {
            if (lr.local !== 'LinearRing') continue
            const r = ring(childText(lr, 'coordinates') ?? '', bad)
            if (r.length >= 6) rings.push(r)
          }
        }
        shapes.push({ name, folder, rings })
        break
      }
      case 'LinearRing':
      case 'LineString': {
        const raw = childText(el, 'coordinates') ?? ''
        const r = ring(raw, bad)
        // A LineString is a plot only if it ends where it starts.
        const tuples = raw.replace(/\s*,\s*/g, ',').trim().split(/\s+/)
        const closed = el.local === 'LinearRing' || (tuples.length > 3 && tuples[0].split(',').slice(0, 2).join() === tuples[tuples.length - 1].split(',').slice(0, 2).join())
        if (closed && r.length >= 6) shapes.push({ name, folder, rings: [r] })
        else if (r.length >= 4) paths.push(name)
        break
      }
      case 'Point':
        points++
        break
      case 'MultiGeometry':
        for (const c of el.children) geometry(c, name, folder, depth + 1)
        break
    }
  }

  const walk = (el: XmlElement, path: string[], depth: number) => {
    if (depth > 64) return
    for (const c of el.children) {
      if (c.local === 'Document' || c.local === 'Folder') {
        const name = childText(c, 'name') ?? ''
        walk(c, depth === 0 && c.local === 'Document' ? path : [...path, name], depth + 1)
      } else if (c.local === 'Placemark') {
        const name = childText(c, 'name') || `Shape ${shapes.length + paths.length + 1}`
        for (const g of c.children) geometry(g, name, path.join(' / '), 0)
      }
    }
  }
  if (root.local === 'Placemark') walk({ ...doc, children: [root] }, [], 1)
  else walk(root.local === 'kml' ? root : doc, [], 0)

  return { shapes, paths, points, badCoordinates: bad.count }
}
