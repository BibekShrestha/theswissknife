/** Photoshop image resources (8BIM) and the IPTC-IIM records inside them. */
import { ascii, formatBytes, hex, text, u16be, u32be } from './bytes'
import { setFact, type Facts } from './exif'
import type { Row, Section } from './types'

const IIM: Record<number, string> = {
  0: 'Record version',
  3: 'Object type',
  5: 'Object name',
  7: 'Edit status',
  10: 'Urgency',
  12: 'Subject reference',
  15: 'Category',
  20: 'Supplemental categories',
  22: 'Fixture ID',
  25: 'Keywords',
  26: 'Location code',
  27: 'Location name',
  30: 'Release date',
  35: 'Release time',
  37: 'Expiration date',
  40: 'Special instructions',
  55: 'Date created',
  60: 'Time created',
  62: 'Digital creation date',
  63: 'Digital creation time',
  65: 'Originating program',
  70: 'Program version',
  75: 'Object cycle',
  80: 'By-line',
  85: 'By-line title',
  90: 'City',
  92: 'Sub-location',
  95: 'Province/State',
  100: 'Country code',
  101: 'Country',
  103: 'Original transmission reference',
  105: 'Headline',
  110: 'Credit',
  115: 'Source',
  116: 'Copyright notice',
  118: 'Contact',
  120: 'Caption/Abstract',
  121: 'Local caption',
  122: 'Writer/Editor',
  130: 'Image type',
  131: 'Image orientation',
  135: 'Language',
  184: 'Job ID',
  221: 'Prefs',
  228: 'Classify state',
  230: 'Document notes',
  231: 'Document history',
  232: 'Exif camera info',
}

const SENSITIVE_IIM = new Set([80, 85, 90, 92, 95, 100, 101, 116, 118, 122, 26, 27])

const MAX_RECORDS = 2000

/** IPTC-IIM datasets from b[start, end). */
export function parseIim(b: Uint8Array, start: number, end: number, warnings: string[]): Row[] {
  const values = new Map<string, { values: string[]; sensitive: boolean }>()
  let o = start
  let records = 0
  while (o + 5 <= end && b[o] === 0x1c && records++ < MAX_RECORDS) {
    const record = b[o + 1]
    const dataset = b[o + 2]
    let length = u16be(b, o + 3)
    let data = o + 5
    if (length & 0x8000) {
      // Extended dataset: the low bits give how many bytes hold the real length.
      const n = length & 0x7fff
      if (n > 4 || data + n > end) break
      length = 0
      for (let i = 0; i < n; i++) length = length * 256 + b[data + i]
      data += n
    }
    if (data + length > end) {
      warnings.push('IPTC: a dataset runs past the end of its block — stopped reading')
      break
    }
    if (record === 2) {
      const name = IIM[dataset] ?? `Dataset 2:${dataset}`
      const value = dataset === 0 && length === 2 ? String(u16be(b, data)) : text(b.subarray(data, data + length)).trim()
      const entry = values.get(name) ?? { values: [], sensitive: SENSITIVE_IIM.has(dataset) }
      if (value) entry.values.push(value)
      values.set(name, entry)
    } else if (record === 1 && dataset === 90) {
      const esc = ascii(b, data, data + length)
      values.set('Coded character set', { values: [esc === '\x1b%G' ? 'UTF-8' : esc.replace('\x1b', 'ESC ')], sensitive: false })
    }
    o = data + length
  }
  return [...values].map(([key, { values: v, sensitive }]) => ({ key, value: v.join('; '), sensitive }))
}

export function iptcFacts(rows: Row[], facts: Facts | undefined) {
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  setFact(facts, 'Artist', get('By-line'), true)
  setFact(facts, 'Copyright', get('Copyright notice'), true)
  setFact(facts, 'Description', get('Caption/Abstract') ?? get('Headline'))
  const place = [get('Sub-location'), get('City'), get('Province/State'), get('Country')].filter(Boolean)
  setFact(facts, 'Place', place.length ? place.join(', ') : undefined, true)
  setFact(facts, 'Keywords', get('Keywords'))
}

const RESOURCES: Record<number, string> = {
  0x03ed: 'Resolution info',
  0x03f3: 'Print flags',
  0x0404: 'IPTC-NAA record',
  0x0406: 'JPEG quality',
  0x0408: 'Grid and guides',
  0x0409: 'Thumbnail (Photoshop 4)',
  0x040a: 'Copyright flag',
  0x040b: 'URL',
  0x040c: 'Thumbnail',
  0x040d: 'Global angle',
  0x040f: 'ICC profile',
  0x0414: 'Document-specific IDs',
  0x0419: 'Global altitude',
  0x041a: 'Slices',
  0x041e: 'URL list',
  0x0421: 'Version info',
  0x0422: 'EXIF data 1',
  0x0423: 'EXIF data 3',
  0x0424: 'XMP metadata',
  0x0425: 'Caption digest',
  0x0426: 'Print scale',
  0x043a: 'Print information',
  0x043b: 'Print style',
  0x2710: 'Print flags info',
}

export interface Irb {
  sections: Section[]
  hasIptc: boolean
}

/** Walks 8BIM resources in b[start, end). */
export function parseIrb(b: Uint8Array, start: number, end: number, warnings: string[], facts?: Facts): Irb {
  const resources: Row[] = []
  const sections: Section[] = []
  let iptcRows: Row[] = []
  let o = start
  let count = 0
  while (o + 12 <= end && count++ < 1000) {
    const sig = ascii(b, o, o + 4)
    if (sig !== '8BIM' && sig !== 'MeSa' && sig !== 'PHUT' && sig !== 'AgHg' && sig !== 'DCSR') break
    const id = u16be(b, o + 4)
    const nameLen = b[o + 6]
    let p = o + 6 + 1 + nameLen
    if ((1 + nameLen) % 2) p++
    if (p + 4 > end) break
    const size = u32be(b, p)
    const data = p + 4
    if (data + size > end) {
      warnings.push(`Photoshop: resource ${hex(id, 4)} runs past the end of its block — stopped reading`)
      break
    }
    const name = RESOURCES[id] ?? `Resource ${hex(id, 4)}`
    if (id === 0x0404) iptcRows = parseIim(b, data, data + size, warnings)
    resources.push({ key: name, value: formatBytes(size), sensitive: id === 0x040c || id === 0x0409 })
    o = data + size + (size % 2)
  }
  if (iptcRows.length) {
    sections.push({ title: 'IPTC-IIM', rows: iptcRows })
    iptcFacts(iptcRows, facts)
  }
  sections.push({ title: 'Photoshop resources', rows: resources })
  return { sections, hasIptc: iptcRows.length > 0 }
}
