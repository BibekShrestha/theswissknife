/**
 * Builders for synthetic test images — used only by the *.test.ts files.
 * They are structurally valid containers with made-up image data: enough for
 * every parser and stripper path, and nothing copyrighted or personal.
 */
import { concat, crc32, putU16be, putU32be, putU32le } from './bytes'

export const enc = (s: string) => new TextEncoder().encode(s)
const latin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

// ---- TIFF / EXIF ------------------------------------------------------------

export type TiffValue = number[] | string | Uint8Array | [number, number][]
export interface TiffEntry {
  tag: number
  type: number
  value: TiffValue
}

const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function encodeValue(e: TiffEntry, le: boolean): Uint8Array {
  if (typeof e.value === 'string') return concat([latin(e.value), new Uint8Array([0])])
  if (e.value instanceof Uint8Array) return e.value
  const size = SIZES[e.type]
  const out = new Uint8Array(size * e.value.length)
  const v = new DataView(out.buffer)
  e.value.forEach((x, i) => {
    const o = i * size
    if (e.type === 5 || e.type === 10) {
      const [n, d] = x as [number, number]
      if (e.type === 5) {
        v.setUint32(o, n, le)
        v.setUint32(o + 4, d, le)
      } else {
        v.setInt32(o, n, le)
        v.setInt32(o + 4, d, le)
      }
    } else if (e.type === 3) v.setUint16(o, x as number, le)
    else if (e.type === 4) v.setUint32(o, x as number, le)
    else if (e.type === 9) v.setInt32(o, x as number, le)
    else out[o] = x as number
  })
  return out
}

const count = (e: TiffEntry) =>
  typeof e.value === 'string' ? e.value.length + 1 : e.value instanceof Uint8Array ? e.value.length : e.value.length

function ifdSize(entries: TiffEntry[]): number {
  let data = 0
  for (const e of entries) {
    const n = count(e) * SIZES[e.type]
    if (n > 4) data += n + (n & 1)
  }
  return 2 + entries.length * 12 + 4 + data
}

function writeIfd(out: Uint8Array, at: number, entries: TiffEntry[], next: number, le: boolean) {
  const v = new DataView(out.buffer, out.byteOffset)
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  v.setUint16(at, sorted.length, le)
  let data = at + 2 + sorted.length * 12 + 4
  sorted.forEach((e, i) => {
    const o = at + 2 + i * 12
    const bytes = encodeValue(e, le)
    v.setUint16(o, e.tag, le)
    v.setUint16(o + 2, e.type, le)
    v.setUint32(o + 4, count(e), le)
    if (bytes.length <= 4) out.set(bytes, o + 8)
    else {
      v.setUint32(o + 8, data, le)
      out.set(bytes, data)
      data += bytes.length + (bytes.length & 1)
    }
  })
  v.setUint32(at + 2 + sorted.length * 12, next, le)
}

export interface TiffSpec {
  le?: boolean
  ifd0: TiffEntry[]
  exif?: TiffEntry[]
  gps?: TiffEntry[]
  ifd1?: TiffEntry[]
  thumbnail?: Uint8Array
}

/** A TIFF structure: header, IFD0, Exif IFD, GPS IFD, IFD1 and the thumbnail, in that order. */
export function tiff(spec: TiffSpec): Uint8Array<ArrayBuffer> {
  const le = spec.le ?? false
  const ptr = (tag: number) => ({ tag, type: 4, value: [0] })
  const ifd0 = [...spec.ifd0, ...(spec.exif ? [ptr(0x8769)] : []), ...(spec.gps ? [ptr(0x8825)] : [])]
  const ifd1 = spec.ifd1 ? [...spec.ifd1, ...(spec.thumbnail ? [ptr(0x0201), ptr(0x0202)] : [])] : undefined
  const off0 = 8
  const offE = off0 + ifdSize(ifd0)
  const offG = offE + (spec.exif ? ifdSize(spec.exif) : 0)
  const off1 = offG + (spec.gps ? ifdSize(spec.gps) : 0)
  const offT = off1 + (ifd1 ? ifdSize(ifd1) : 0)
  const total = offT + (spec.thumbnail?.length ?? 0)
  const set = (list: TiffEntry[], tag: number, value: number) => {
    const e = list.find((x) => x.tag === tag)
    if (e) e.value = [value]
  }
  set(ifd0, 0x8769, offE)
  set(ifd0, 0x8825, offG)
  if (ifd1 && spec.thumbnail) {
    set(ifd1, 0x0201, offT)
    set(ifd1, 0x0202, spec.thumbnail.length)
  }
  const out = new Uint8Array(total)
  out.set(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42], 0)
  new DataView(out.buffer).setUint32(4, off0, le)
  writeIfd(out, off0, ifd0, ifd1 ? off1 : 0, le)
  if (spec.exif) writeIfd(out, offE, spec.exif, 0, le)
  if (spec.gps) writeIfd(out, offG, spec.gps, 0, le)
  if (ifd1) writeIfd(out, off1, ifd1, 0, le)
  if (spec.thumbnail) out.set(spec.thumbnail, offT)
  return out
}

/** San Francisco-ish: 37°46′29.64″ N, 122°25′09.84″ W, 12.5 m. */
export const GPS_ENTRIES: TiffEntry[] = [
  { tag: 0x00, type: 1, value: new Uint8Array([2, 3, 0, 0]) },
  { tag: 0x01, type: 2, value: 'N' },
  { tag: 0x02, type: 5, value: [[37, 1], [46, 1], [2964, 100]] },
  { tag: 0x03, type: 2, value: 'W' },
  { tag: 0x04, type: 5, value: [[122, 1], [25, 1], [984, 100]] },
  { tag: 0x05, type: 1, value: new Uint8Array([0]) },
  { tag: 0x06, type: 5, value: [[125, 10]] },
]

export const CAMERA_TIFF: TiffSpec = {
  ifd0: [
    { tag: 0x010f, type: 2, value: 'Testmaker' },
    { tag: 0x0110, type: 2, value: 'TM-1 Mark II' },
    { tag: 0x0112, type: 3, value: [6] },
    { tag: 0x0131, type: 2, value: 'FixtureWare 1.0' },
    { tag: 0x0132, type: 2, value: '2024:05:06 07:08:09' },
    { tag: 0x013b, type: 2, value: 'A. Photographer' },
  ],
  exif: [
    { tag: 0x829a, type: 5, value: [[1, 250]] },
    { tag: 0x829d, type: 5, value: [[28, 10]] },
    { tag: 0x8827, type: 3, value: [200] },
    { tag: 0x9003, type: 2, value: '2024:05:06 07:08:09' },
    { tag: 0x9011, type: 2, value: '+02:00' },
    { tag: 0x920a, type: 5, value: [[50, 1]] },
    { tag: 0x9209, type: 3, value: [0x10] },
    { tag: 0xa431, type: 2, value: 'SN-0001' },
    { tag: 0xa434, type: 2, value: 'TM 50mm F2.8' },
  ],
  gps: GPS_ENTRIES,
}

// ---- ICC --------------------------------------------------------------------

/** A tiny ICC v2 header with a desc tag. */
export function icc(description = 'Test RGB'): Uint8Array<ArrayBuffer> {
  const descData = concat([latin('desc'), new Uint8Array(4), (() => {
    const n = new Uint8Array(4)
    putU32be(n, 0, description.length + 1)
    return n
  })(), latin(description), new Uint8Array(1)])
  const size = 128 + 4 + 12 + descData.length
  const out = new Uint8Array(size)
  putU32be(out, 0, size)
  out.set(latin('test'), 4)
  out[8] = 2
  out[9] = 0x10
  out.set(latin('mntrRGB XYZ '), 12)
  putU16be(out, 24, 2024)
  putU16be(out, 26, 1)
  putU16be(out, 28, 2)
  out.set(latin('acsp'), 36)
  putU32be(out, 128, 1)
  out.set(latin('desc'), 132)
  putU32be(out, 136, 144)
  putU32be(out, 140, descData.length)
  out.set(descData, 144)
  return out
}

export const XMP_PACKET = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmp:CreatorTool="FixtureWare &amp; Co" exif:GPSLatitude="37,46.494N" exif:GPSLongitude="122,25.164W">
<dc:creator><rdf:Seq><rdf:li>A. Photographer</rdf:li></rdf:Seq></dc:creator>
<dc:subject><rdf:Bag><rdf:li>test</rdf:li><rdf:li>fixture</rdf:li></rdf:Bag></dc:subject>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`

/** IPTC-IIM By-line and City inside a Photoshop 8BIM 0x0404 resource. */
export function photoshopIptc(): Uint8Array<ArrayBuffer> {
  const ds = (n: number, v: string) => {
    const t = enc(v)
    const h = new Uint8Array([0x1c, 2, n, 0, 0])
    putU16be(h, 3, t.length)
    return concat([h, t])
  }
  const iim = concat([ds(80, 'A. Photographer'), ds(90, 'Testville'), ds(25, 'one'), ds(25, 'two')])
  const head = concat([latin('8BIM'), new Uint8Array([0x04, 0x04, 0, 0]), new Uint8Array(4)])
  putU32be(head, 8, iim.length)
  return concat([head, iim, new Uint8Array(iim.length & 1)])
}

// ---- JPEG -------------------------------------------------------------------

export function segment(marker: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4 + payload.length)
  out[0] = 0xff
  out[1] = marker
  putU16be(out, 2, payload.length + 2)
  out.set(payload, 4)
  return out
}

export const exifSegment = (t: Uint8Array) => segment(0xe1, concat([latin('Exif\0\0'), t]))
export const xmpSegment = (xml: string) => segment(0xe1, concat([latin('http://ns.adobe.com/xap/1.0/\0'), enc(xml)]))
export const iccSegments = (profile: Uint8Array, parts = 1) => {
  const size = Math.ceil(profile.length / parts)
  return Array.from({ length: parts }, (_, i) =>
    segment(0xe2, concat([latin('ICC_PROFILE\0'), new Uint8Array([i + 1, parts]), profile.subarray(i * size, (i + 1) * size)])),
  )
}

export function extendedXmpSegments(xml: string, guid = '0123456789ABCDEF0123456789ABCDEF', chunk = 40): Uint8Array<ArrayBuffer>[] {
  const data = enc(xml)
  const out: Uint8Array<ArrayBuffer>[] = []
  for (let off = 0; off < data.length; off += chunk) {
    const head = new Uint8Array(8)
    putU32be(head, 0, data.length)
    putU32be(head, 4, off)
    out.push(segment(0xe1, concat([latin('http://ns.adobe.com/xmp/extension/\0'), latin(guid), head, data.subarray(off, off + chunk)])))
  }
  return out
}

/**
 * The image part of a JPEG: DQT, SOF0, DHT, SOS and "entropy data" that
 * contains byte stuffing (FF00) and a restart marker (FFD0), then EOI.
 * Not decodable — it only has to be byte-exact through a strip.
 */
export function jpegImage(width = 64, height = 48): Uint8Array<ArrayBuffer> {
  const dqt = segment(0xdb, concat([new Uint8Array([0]), new Uint8Array(64).fill(1)]))
  const sofPayload = new Uint8Array([8, 0, 0, 0, 0, 1, 1, 0x11, 0])
  putU16be(sofPayload, 1, height)
  putU16be(sofPayload, 3, width)
  const sof = segment(0xc0, sofPayload)
  const dht = segment(0xc4, concat([new Uint8Array([0]), new Uint8Array(16).fill(0), new Uint8Array(0)]))
  const sos = segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0]))
  const entropy = new Uint8Array([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a, 0xff, 0x00, 0xbc])
  return concat([dqt, sof, dht, sos, entropy, new Uint8Array([0xff, 0xd9])])
}

export const JFIF = segment(0xe0, concat([latin('JFIF\0'), new Uint8Array([1, 2, 0, 0, 1, 0, 1, 0, 0])]))

export function jpeg(segments: Uint8Array[], trailing?: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat([new Uint8Array([0xff, 0xd8]), ...segments, jpegImage(), ...(trailing ? [trailing] : [])])
}

// ---- PNG --------------------------------------------------------------------

export function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  putU32be(out, 0, data.length)
  out.set(latin(type), 4)
  out.set(data, 8)
  putU32be(out, 8 + data.length, crc32(out, 4, 8 + data.length))
  return out
}

export async function deflate(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function ihdr(width = 4, height = 3) {
  const d = new Uint8Array(13)
  putU32be(d, 0, width)
  putU32be(d, 4, height)
  d.set([8, 2, 0, 0, 0], 8)
  return pngChunk('IHDR', d)
}

export const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
export const IDAT = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 1, 2, 3, 4, 5, 6, 7, 8]))
export const IEND = pngChunk('IEND', new Uint8Array(0))

export function png(chunksBeforeIdat: Uint8Array[], chunksAfterIdat: Uint8Array[] = []): Uint8Array<ArrayBuffer> {
  return concat([PNG_SIG, ihdr(), ...chunksBeforeIdat, IDAT, ...chunksAfterIdat, IEND])
}

// ---- WebP -------------------------------------------------------------------

export function riffChunk(fourcc: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(latin(fourcc), 0)
  putU32le(out, 4, data.length)
  out.set(data, 8)
  return out
}

export function vp8x(flags: number, width = 64, height = 48) {
  const d = new Uint8Array(10)
  d[0] = flags
  const w = width - 1
  const h = height - 1
  d.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4)
  return riffChunk('VP8X', d)
}

/** A VP8L header for 64×48 plus a few made-up bytes (odd length, so the pad byte is exercised). */
export const VP8L = riffChunk('VP8L', new Uint8Array([0x2f, 63, 0xc0, 0x0b, 0x00, 9, 8, 7, 6, 5, 4]))

export function webp(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat([latin('WEBP'), ...chunks])
  const head = new Uint8Array(8)
  head.set(latin('RIFF'), 0)
  putU32le(head, 4, body.length)
  return concat([head, body])
}

// ---- GIF --------------------------------------------------------------------

const subBlocks = (data: Uint8Array) => {
  const parts: Uint8Array[] = []
  for (let i = 0; i < data.length; i += 255) {
    const piece = data.subarray(i, i + 255)
    parts.push(new Uint8Array([piece.length]), piece)
  }
  parts.push(new Uint8Array([0]))
  return concat(parts)
}

export const gifComment = (s: string) => concat([new Uint8Array([0x21, 0xfe]), subBlocks(latin(s))])
export const gifApp = (ident: string, data: Uint8Array) => concat([new Uint8Array([0x21, 0xff, 11]), latin(ident), subBlocks(data)])
export const NETSCAPE = concat([new Uint8Array([0x21, 0xff, 11]), latin('NETSCAPE2.0'), new Uint8Array([3, 1, 0, 0, 0])])

/** XMP the GIF way: raw packet bytes, then the 257-byte magic trailer and a terminator. */
export function gifXmp(xml: string) {
  const trailer = new Uint8Array(258)
  trailer[0] = 1
  for (let i = 0; i < 256; i++) trailer[1 + i] = 255 - i
  trailer[257] = 0
  return concat([new Uint8Array([0x21, 0xff, 11]), latin('XMP DataXMP'), enc(xml), trailer])
}

export const GIF_IMAGE = concat([
  new Uint8Array([0x21, 0xf9, 4, 0, 10, 0, 0, 0]),
  new Uint8Array([0x2c, 0, 0, 0, 0, 2, 0, 2, 0, 0]),
  new Uint8Array([2, 2, 0x4c, 0x01, 0]),
])

export function gif(blocks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const head = concat([latin('GIF89a'), new Uint8Array([2, 0, 2, 0, 0x80, 0, 0]), new Uint8Array([0, 0, 0, 255, 255, 255])])
  return concat([head, ...blocks, new Uint8Array([0x3b])])
}

// ---- HEIF -------------------------------------------------------------------

export function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const body = concat(parts)
  const out = new Uint8Array(8 + body.length)
  putU32be(out, 0, out.length)
  out.set(latin(type), 4)
  out.set(body, 8)
  return out
}
const full = (version: number, flags = 0) => new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff])
const u16 = (v: number) => new Uint8Array([(v >> 8) & 0xff, v & 0xff])
const u32 = (v: number) => {
  const o = new Uint8Array(4)
  putU32be(o, 0, v)
  return o
}

function infe(id: number, type: string, name: string, contentType?: string) {
  return box('infe', full(2), u16(id), u16(0), latin(type), latin(`${name}\0`), contentType ? latin(`${contentType}\0`) : new Uint8Array(0))
}

export interface HeifSpec {
  brand?: string
  image: Uint8Array
  exif?: Uint8Array
  xmp?: string
  profile?: Uint8Array
}

/** ftyp + meta (iinf, iloc v1, iprp/ipco with colr, ispe, irot) + mdat holding the image, Exif and XMP payloads. */
export function heif(spec: HeifSpec): Uint8Array<ArrayBuffer> {
  const brand = spec.brand ?? 'heic'
  const exifPayload = spec.exif ? concat([u32(6), latin('Exif\0\0'), spec.exif]) : null
  const xmpPayload = spec.xmp ? enc(spec.xmp) : null
  const payloads: [number, Uint8Array][] = [[1, spec.image]]
  if (exifPayload) payloads.push([2, exifPayload])
  if (xmpPayload) payloads.push([3, xmpPayload])

  const build = (mdatStart: number) => {
    const entries: Uint8Array[] = []
    let at = mdatStart + 8
    for (const [id, data] of payloads) {
      entries.push(u16(id), u16(0), u16(0), u16(1), u32(at), u32(data.length))
      at += data.length
    }
    const iloc = box('iloc', full(1), new Uint8Array([0x44, 0x00]), u16(payloads.length), ...entries)
    const items = [infe(1, brand === 'avif' ? 'av01' : 'hvc1', 'image')]
    if (exifPayload) items.push(infe(2, 'Exif', 'Exif'))
    if (xmpPayload) items.push(infe(3, 'mime', 'XMP', 'application/rdf+xml'))
    const iinf = box('iinf', full(0), u16(items.length), ...items)
    const props = [box('ispe', full(0), u32(640), u32(480)), box('irot', new Uint8Array([1]))]
    if (spec.profile) props.unshift(box('colr', latin('prof'), spec.profile))
    const iprp = box('iprp', box('ipco', ...props))
    return box('meta', full(0), box('hdlr', full(0), u32(0), latin('pict'), new Uint8Array(13)), box('pitm', full(0), u16(1)), iinf, iloc, iprp)
  }
  const ftyp = box('ftyp', latin(brand), u32(0), latin('mif1'), latin(brand))
  const probe = build(0)
  const mdatStart = ftyp.length + probe.length
  const meta = build(mdatStart)
  const mdat = box('mdat', ...payloads.map(([, d]) => d))
  return concat([ftyp, meta, mdat])
}
