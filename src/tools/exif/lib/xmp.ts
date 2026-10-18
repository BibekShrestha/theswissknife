/**
 * XMP is RDF/XML. Workers have no DOMParser, and this only needs the
 * property/value pairs, so this is a small tolerant tag scanner: attributes on
 * any element become properties, element text becomes the value of the nearest
 * non-RDF ancestor, and rdf:li items are joined.
 */
import { setFact, type Facts } from './exif'
import type { Row } from './types'

const MAX_PROPS = 800
const MAX_VALUE = 300

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

const STRUCTURAL = /^(rdf:|x:xmpmeta$|x:xapmeta$|xmlns)/

export function parseXmp(xml: string): Row[] {
  const props = new Map<string, string[]>()
  const add = (key: string, value: string) => {
    const v = value.trim()
    if (!v) return
    const list = props.get(key)
    if (list) list.push(v)
    else if (props.size < MAX_PROPS) props.set(key, [v])
  }
  const stack: string[] = []
  const owner = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (!STRUCTURAL.test(stack[i])) return stack[i]
    return null
  }
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>/g
  const attr = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tag.exec(xml))) {
    const between = xml.slice(last, m.index)
    last = tag.lastIndex
    const o = owner()
    if (o && between.trim()) add(o, decode(between))
    if (m[5] !== undefined) {
      if (o) add(o, m[5])
      continue
    }
    if (!m[2]) continue
    const [, closing, name, attrs, selfClosing] = m
    if (closing) {
      const at = stack.lastIndexOf(name)
      if (at >= 0) stack.length = at
      continue
    }
    for (const a of attrs.matchAll(attr)) {
      const key = a[1]
      if (STRUCTURAL.test(key) || key === 'xml:lang') continue
      // rdf:resource on a property element is that property's value.
      add(key, decode(a[2] ?? a[3] ?? ''))
    }
    const resource = /rdf:resource\s*=\s*"([^"]*)"/.exec(attrs)
    if (resource && !STRUCTURAL.test(name)) add(name, decode(resource[1]))
    if (!selfClosing) stack.push(name)
  }
  const rows: Row[] = []
  for (const [key, values] of props) {
    let value = values.join('; ')
    if (value.length > MAX_VALUE) value = `${value.slice(0, MAX_VALUE)}… (${value.length.toLocaleString()} characters)`
    rows.push({ key, value, sensitive: SENSITIVE.test(key) })
  }
  return rows
}

const SENSITIVE = /GPS|Latitude|Longitude|Location|City|State|Country|creator|Creator|Author|Owner|SerialNumber|rights|Rights|Contact|DocumentID|InstanceID|personInImage|PersonInImage|Region/

const pick = (rows: Row[], ...keys: string[]) => {
  for (const k of keys) {
    const row = rows.find((r) => r.key === k)
    if (row) return row.value
  }
  return undefined
}

/** Adds the XMP properties people care about to the summary when EXIF did not already give them. */
export function xmpFacts(rows: Row[], facts: Facts | undefined) {
  if (!facts) return
  const camera = [pick(rows, 'tiff:Make'), pick(rows, 'tiff:Model')].filter(Boolean).join(' ')
  setFact(facts, 'Camera', camera || undefined)
  setFact(facts, 'Lens', pick(rows, 'exifEX:LensModel', 'aux:Lens'))
  setFact(facts, 'Taken', pick(rows, 'exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate'))
  setFact(facts, 'Modified', pick(rows, 'xmp:ModifyDate'))
  setFact(facts, 'Software', pick(rows, 'xmp:CreatorTool'))
  setFact(facts, 'Artist', pick(rows, 'dc:creator'), true)
  setFact(facts, 'Copyright', pick(rows, 'dc:rights'), true)
  setFact(facts, 'Camera serial', pick(rows, 'exifEX:BodySerialNumber', 'aux:SerialNumber'), true)
  setFact(facts, 'Description', pick(rows, 'dc:description', 'dc:title'))
  const place = [pick(rows, 'Iptc4xmpCore:Location'), pick(rows, 'photoshop:City'), pick(rows, 'photoshop:State'), pick(rows, 'photoshop:Country')].filter(Boolean)
  setFact(facts, 'Place', place.length ? place.join(', ') : undefined, true)
  if (!facts.gps) {
    const lat = xmpCoordinate(pick(rows, 'exif:GPSLatitude'))
    const lon = xmpCoordinate(pick(rows, 'exif:GPSLongitude'))
    if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) facts.gps = { lat, lon }
  }
}

/** XMP writes GPS as "37,46.494N" or "37,46,29.6N". */
export function xmpCoordinate(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = /^\s*(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?\s*([NSEW])\s*$/i.exec(value)
  if (!m) return undefined
  const deg = Number(m[1]) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600
  return /[SW]/i.test(m[4]) ? -deg : deg
}
