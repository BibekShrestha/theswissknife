/**
 * Features (lon/lat/alt) → KML 2.2. One Folder per layer, one shared Style
 * per colour actually used, coordinates to 8 decimals (about 1 mm).
 */

import type { Feature, Rgb } from '../model'

export interface KmlWriteOptions {
  documentName: string
  /** Absolute altitudes from Z; otherwise geometry is clamped to the ground and Z dropped. */
  altitude: boolean
  /** Closed shapes as filled polygons (false: as closed lines). */
  polygons: boolean
  /** Layer order for folders; layers not listed come after, in feature order. */
  layerOrder: string[]
}

export function escapeXml(text: string): string {
  // Characters XML 1.0 forbids are dropped rather than written.
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[<>&"]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'))
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

export function kmlColor(rgb: Rgb, alpha = 1): string {
  return hex2(alpha * 255) + hex2(rgb.b) + hex2(rgb.g) + hex2(rgb.r)
}

function num(n: number, digits: number) {
  const s = n.toFixed(digits)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '').replace(/^-0$/, '0') : s
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }

export function writeKml(features: Feature[], options: KmlWriteOptions): string {
  const coord = (c: number[], i: number) =>
    options.altitude ? `${num(c[i], 8)},${num(c[i + 1], 8)},${num(c[i + 2], 3)}` : `${num(c[i], 8)},${num(c[i + 1], 8)}`
  const coordList = (c: number[], close: boolean) => {
    const parts: string[] = []
    for (let i = 0; i < c.length; i += 3) parts.push(coord(c, i))
    if (close && c.length >= 3) parts.push(coord(c, 0))
    return parts.join(' ')
  }
  const mode = options.altitude ? '<altitudeMode>absolute</altitudeMode>' : ''
  const tess = options.altitude ? '' : '<tessellate>1</tessellate>'

  const styleIds = new Map<string, string>()
  const styleXml: string[] = []
  const styleFor = (feature: Feature) => {
    const rgb = feature.color ?? WHITE
    const kind = feature.geometry.type === 'text' ? 'label' : feature.geometry.type === 'point' ? 'point' : 'line'
    const key = `${kind}:${kmlColor(rgb)}`
    let id = styleIds.get(key)
    if (!id) {
      id = `${kind}-${kmlColor(rgb).slice(2)}`
      styleIds.set(key, id)
      if (kind === 'label') {
        // A label with no pin: the text itself is the placemark.
        styleXml.push(`<Style id="${id}"><IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${kmlColor(rgb)}</color></LabelStyle></Style>`)
      } else if (kind === 'point') {
        styleXml.push(`<Style id="${id}"><IconStyle><color>${kmlColor(rgb)}</color></IconStyle></Style>`)
      } else {
        styleXml.push(`<Style id="${id}"><LineStyle><color>${kmlColor(rgb)}</color><width>2</width></LineStyle><PolyStyle><color>${kmlColor(rgb, 0.25)}</color></PolyStyle></Style>`)
      }
    }
    return id
  }

  const byLayer = new Map<string, string[]>()
  for (const layer of options.layerOrder) byLayer.set(layer, [])
  for (const feature of features) {
    const g = feature.geometry
    let body: string
    switch (g.type) {
      case 'point':
      case 'text':
        body = `<Point>${mode}<coordinates>${coord(g.at, 0)}</coordinates></Point>`
        break
      case 'line':
        if (g.closed && options.polygons && g.coords.length >= 9) {
          body = `<Polygon>${tess}${mode}<outerBoundaryIs><LinearRing><coordinates>${coordList(g.coords, true)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        } else {
          body = `<LineString>${tess}${mode}<coordinates>${coordList(g.coords, g.closed)}</coordinates></LineString>`
        }
        break
      case 'polygon': {
        if (options.polygons) {
          const [outer, ...holes] = g.rings
          body = `<Polygon>${tess}${mode}<outerBoundaryIs><LinearRing><coordinates>${coordList(outer, true)}</coordinates></LinearRing></outerBoundaryIs>${holes.map((h) => `<innerBoundaryIs><LinearRing><coordinates>${coordList(h, true)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`
        } else {
          const lines = g.rings.map((r) => `<LineString>${tess}${mode}<coordinates>${coordList(r, true)}</coordinates></LineString>`)
          body = lines.length === 1 ? lines[0] : `<MultiGeometry>${lines.join('')}</MultiGeometry>`
        }
        break
      }
    }
    const name = g.type === 'text' ? g.text : feature.name
    const placemark = `<Placemark>${name ? `<name>${escapeXml(name)}</name>` : ''}<styleUrl>#${styleFor(feature)}</styleUrl>${body}</Placemark>`
    let list = byLayer.get(feature.layer)
    if (!list) byLayer.set(feature.layer, (list = []))
    list.push(placemark)
  }

  const folders: string[] = []
  for (const [layer, placemarks] of byLayer) {
    if (!placemarks.length) continue
    folders.push(`<Folder><name>${escapeXml(layer || '0')}</name>\n${placemarks.join('\n')}\n</Folder>`)
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    `<name>${escapeXml(options.documentName)}</name>`,
    ...styleXml,
    ...folders,
    '</Document>',
    '</kml>',
    '',
  ].join('\n')
}
