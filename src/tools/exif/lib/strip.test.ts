import { describe, expect, it } from 'vitest'
import { analyze, processImage } from './analyze'
import { ascii, concat, crc32, indexOf, u32be, u32le } from './bytes'
import { orientationTiff } from './exif'
import { scanPng } from './png'
import type { Block, StripOptions } from './types'
import { FLAG_ALPHA, FLAG_EXIF, FLAG_ICC, FLAG_XMP, scanWebp } from './webp'
import {
  CAMERA_TIFF,
  GIF_IMAGE,
  GPS_ENTRIES,
  IDAT,
  IEND,
  JFIF,
  NETSCAPE,
  VP8L,
  XMP_PACKET,
  deflate,
  enc,
  exifSegment,
  extendedXmpSegments,
  gif,
  gifApp,
  gifComment,
  gifXmp,
  heif,
  icc,
  iccSegments,
  ihdr,
  jpeg,
  jpegImage,
  photoshopIptc,
  png,
  pngChunk,
  riffChunk,
  segment,
  tiff,
  vp8x,
  webp,
  xmpSegment,
} from './testkit'

const STRIP_ALL: StripOptions = { keepOrientation: false, keepIcc: false }
const KEEP_ICC: StripOptions = { keepOrientation: false, keepIcc: true }
const KEEP_BOTH: StripOptions = { keepOrientation: true, keepIcc: true }

/** Every block, including those nested in thumbnails and appended images. */
const flat = (blocks: Block[]): Block[] => blocks.flatMap((b) => [b, ...flat(b.nested ?? [])])
const kinds = (blocks: Block[]) => flat(blocks).map((b) => b.kind)
const has = (b: Uint8Array, s: string) => indexOf(b, s) >= 0

function containsBytes(hay: Uint8Array, needle: Uint8Array) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

const sha = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('JPEG', () => {
  const thumbnail = jpeg([exifSegment(tiff({ ifd0: [{ tag: 0x010f, type: 2, value: 'Thumb' }], gps: GPS_ENTRIES }))])
  const photo = () =>
    jpeg(
      [
        JFIF,
        exifSegment(tiff({ ...CAMERA_TIFF, ifd1: [{ tag: 0x0103, type: 3, value: [6] }], thumbnail })),
        xmpSegment(XMP_PACKET),
        ...extendedXmpSegments(XMP_PACKET.replace('FixtureWare', 'Extended')),
        ...iccSegments(icc('Test RGB'), 2),
        segment(0xe2, concat([enc('MPF\0'), tiff({ ifd0: [{ tag: 0xb001, type: 4, value: [2] }] })])),
        segment(0xed, concat([enc('Photoshop 3.0\0'), photoshopIptc()])),
        segment(0xfe, enc('a comment')),
        segment(0xee, concat([enc('Adobe'), new Uint8Array(7)])),
      ],
      jpeg([exifSegment(tiff({ ifd0: [{ tag: 0x010f, type: 2, value: 'Appended' }], gps: GPS_ENTRIES }))]),
    )

  it('finds every block, the thumbnail’s own GPS and the appended image’s', async () => {
    const a = await analyze(photo())
    expect(a.formatLabel).toBe('JPEG')
    expect([a.width, a.height]).toEqual([64, 48])
    expect(a.blocks.map((b) => b.label)).toEqual([
      'EXIF',
      'XMP',
      'XMP (extended)',
      'ICC colour profile',
      'MPF (multi-picture index)',
      'IPTC (Photoshop APP13)',
      'JPEG comment',
      'Data after end of image',
    ])
    const exif = a.blocks[0]
    expect(exif.nested?.[0].where).toMatch(/inside the IFD1 thumbnail/)
    expect(exif.nested?.[0].sections.some((s) => s.title.startsWith('GPS'))).toBe(true)
    expect(a.blocks[7].nested?.[0].where).toMatch(/appended image 1/)
    expect(a.blocks[3].sections[0].rows.find((r) => r.key === 'Description')?.value).toBe('Test RGB')
    expect(a.blocks[2].sections[0].rows.find((r) => r.key === 'xmp:CreatorTool')?.value).toBe('Extended & Co')
    const summary = Object.fromEntries(a.summary.map((r) => [r.key, r.value]))
    expect(summary.Location).toBe('37.774900, -122.419400')
    expect(summary['Location (DMS)']).toBe('37°46′29.64″ N  122°25′09.84″ W')
    expect(summary.Place).toBe('Testville')
    expect(summary['Colour profile']).toBe('Test RGB')
  })

  it('strips everything, keeps the image bytes, and the re-parse agrees', async () => {
    const input = photo()
    const r = await processImage(input.slice(), STRIP_ALL)
    expect(r.remaining).toEqual([])
    expect(r.after.blocks).toEqual([])
    expect(r.identical).toBe(true)
    expect(r.after.imageDigest).toBe(r.before.imageDigest)
    // Independent of our own digest: the frame through EOI is the last thing in the file, byte for byte.
    const image = jpegImage()
    expect(await sha(r.bytes.subarray(r.bytes.length - image.length))).toBe(await sha(image))
    // JFIF and Adobe stay (they steer decoding); nothing identifying does.
    expect(has(r.bytes, 'JFIF\0')).toBe(true)
    expect(has(r.bytes, 'Adobe')).toBe(true)
    for (const s of ['Exif', 'Testmaker', 'Thumb', 'Appended', 'xap/1.0', 'ICC_PROFILE', 'MPF', 'Photoshop', 'a comment']) expect(has(r.bytes, s), s).toBe(false)
    expect(r.removed).toContain('APP2 ICC profile ×2')
    expect(r.removed.some((x) => /after end of image/.test(x))).toBe(true)
  })

  it('removes the IFD1 thumbnail together with its own GPS', async () => {
    const r = await processImage(photo(), KEEP_BOTH)
    expect(kinds(r.before.blocks).filter((k) => k === 'exif').length).toBe(3)
    expect(flat(r.after.blocks).some((b) => b.sections.some((s) => s.title.startsWith('GPS')))).toBe(false)
    expect(containsBytes(r.bytes, thumbnail)).toBe(false)
  })

  it('keeps the ICC profile when asked and says so', async () => {
    const r = await processImage(photo(), KEEP_ICC)
    expect(r.after.blocks.map((b) => b.kind)).toEqual(['icc'])
    expect(r.remaining).toEqual([])
    expect(r.kept).toEqual(['ICC colour profile'])
    expect(r.identical).toBe(true)
  })

  it('keep orientation writes an EXIF with Orientation only, right after JFIF', async () => {
    const r = await processImage(photo(), KEEP_BOTH)
    const exif = r.after.blocks.filter((b) => b.kind === 'exif')
    expect(exif).toHaveLength(1)
    expect(exif[0].orientationOnly).toBe(true)
    expect(r.after.orientation).toBe(6)
    expect(r.remaining).toEqual([])
    expect(r.identical).toBe(true)
    // SOI, APP0 JFIF (18 bytes), then the new APP1
    expect([r.bytes[20], r.bytes[21]]).toEqual([0xff, 0xe1])
    expect(containsBytes(r.bytes, orientationTiff(6))).toBe(true)
    expect(r.kept.some((k) => /^Orientation 6/.test(k))).toBe(true)
  })

  it('writes no orientation EXIF when the photo was upright', async () => {
    const upright = jpeg([exifSegment(tiff({ ifd0: [{ tag: 0x0112, type: 3, value: [1] }, { tag: 0x010f, type: 2, value: 'X' }] }))])
    const r = await processImage(upright, KEEP_BOTH)
    expect(r.after.blocks).toEqual([])
  })

  it('handles little-endian EXIF the same way', async () => {
    const r = await processImage(jpeg([exifSegment(tiff({ ...CAMERA_TIFF, le: true }))]), KEEP_BOTH)
    expect(r.before.orientation).toBe(6)
    expect(r.before.gps?.lat).toBeCloseTo(37.7749, 4)
    expect(r.after.blocks.map((b) => b.orientationOnly)).toEqual([true])
  })

  it('drops APPn/COM segments that sit between progressive scans', async () => {
    const image = jpegImage()
    const sos = indexOf(image, '\xff\xda')
    const mid = image.length - 2
    const progressive = concat([new Uint8Array([0xff, 0xd8]), image.subarray(0, mid), segment(0xfe, enc('between scans')), image.subarray(sos, mid), new Uint8Array([0xff, 0xd9])])
    const a = await analyze(progressive)
    expect(a.blocks.map((b) => b.label)).toEqual(['JPEG comment'])
    const r = await processImage(progressive, STRIP_ALL)
    expect(has(r.bytes, 'between scans')).toBe(false)
    expect(r.identical).toBe(true)
  })

  it('survives malformed segments without hanging', async () => {
    const zeroLength = concat([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]), jpegImage()])
    expect((await analyze(zeroLength)).warnings.join()).toMatch(/impossible length/)
    const truncated = jpeg([exifSegment(tiff(CAMERA_TIFF))]).subarray(0, 60)
    const a = await analyze(truncated)
    expect(a.warnings.join()).toMatch(/runs past the end|no end-of-image/)
    const badExif = jpeg([segment(0xe1, concat([enc('Exif\0\0'), new Uint8Array([0x4d, 0x4d, 0, 42, 0xff, 0xff, 0xff, 0xff])]))])
    const b = await analyze(badExif)
    expect(b.blocks[0].kind).toBe('exif')
    const r = await processImage(badExif, STRIP_ALL)
    expect(r.remaining).toEqual([])
  })
})

describe('PNG', () => {
  const build = async () =>
    png(
      [
        pngChunk('iCCP', concat([enc('Test\0\0'), await deflate(icc('PNG RGB'))])),
        pngChunk('eXIf', tiff(CAMERA_TIFF)),
        pngChunk('tEXt', enc('Author\0A. Photographer')),
        pngChunk('zTXt', concat([enc('Comment\0\0'), await deflate(enc('compressed comment'))])),
        pngChunk('iTXt', concat([enc('XML:com.adobe.xmp\0\0\0\0\0'), enc(XMP_PACKET)])),
        pngChunk('tIME', new Uint8Array([0x07, 0xe8, 5, 6, 7, 8, 9])),
      ],
      [pngChunk('tEXt', enc('Software\0after the image'))],
    )

  it('reads every chunk, compressed ones included', async () => {
    const a = await analyze(await build())
    expect(a.blocks.map((b) => b.label)).toEqual(['ICC colour profile', 'EXIF', 'Text “Author”', 'Text “Comment”', 'XMP', 'Last-modified time', 'Text “Software”'])
    expect(a.blocks[3].sections[0].rows[0].value).toBe('compressed comment')
    expect(a.blocks[5].sections[0].rows[0].value).toBe('2024-05-06 07:08:09 UTC')
    expect(a.summary.find((r) => r.key === 'Colour profile')?.value).toBe('PNG RGB')
    expect([a.width, a.height]).toEqual([4, 3])
    expect(a.warnings).toEqual([])
  })

  it('drops eXIf/tEXt/zTXt/iTXt/tIME, keeps iCCP, and leaves IHDR/IDAT/IEND byte-identical', async () => {
    const r = await processImage(await build(), KEEP_ICC)
    expect(r.after.blocks.map((b) => b.kind)).toEqual(['icc'])
    expect(r.remaining).toEqual([])
    expect(r.identical).toBe(true)
    const types = scanPng(r.bytes).chunks.map((c) => c.type)
    expect(types).toEqual(['IHDR', 'iCCP', 'IDAT', 'IEND'])
    for (const chunk of [ihdr(), IDAT, IEND]) expect(containsBytes(r.bytes, chunk)).toBe(true)
    // every chunk left still has a valid CRC
    for (const c of scanPng(r.bytes).chunks) expect(crc32(r.bytes, c.start + 4, c.data + c.length)).toBe(u32be(r.bytes, c.data + c.length))
  })

  it('drops iCCP too when not kept; writes eXIf with Orientation before IDAT when asked', async () => {
    const all = await processImage(await build(), STRIP_ALL)
    expect(scanPng(all.bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const kept = await processImage(await build(), { keepOrientation: true, keepIcc: false })
    expect(scanPng(kept.bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND'])
    expect(kept.after.blocks[0].orientationOnly).toBe(true)
    expect(kept.remaining).toEqual([])
    expect(kept.identical).toBe(true)
  })

  it('reads ImageMagick raw-profile EXIF and reports a bad CRC', async () => {
    const t = tiff(CAMERA_TIFF)
    const hexText = [...concat([enc('Exif\0\0'), t])].map((x) => x.toString(16).padStart(2, '0')).join('')
    const raw = pngChunk('zTXt', concat([enc('Raw profile type exif\0\0'), await deflate(enc(`\nexif\n${t.length + 6}\n${hexText}\n`))]))
    const bad = pngChunk('tEXt', enc('Title\0x'))
    bad[bad.length - 1] ^= 1
    const a = await analyze(png([raw, bad]))
    expect(a.blocks[0].kind).toBe('exif')
    expect(a.gps?.lat).toBeCloseTo(37.7749, 4)
    expect(a.warnings.join()).toMatch(/bad CRC/)
  })
})

describe('WebP', () => {
  const build = () =>
    webp([
      vp8x(FLAG_ICC | FLAG_ALPHA | FLAG_EXIF | FLAG_XMP),
      riffChunk('ICCP', icc('WebP RGB')),
      VP8L,
      riffChunk('EXIF', tiff(CAMERA_TIFF)),
      riffChunk('XMP ', enc(XMP_PACKET)),
    ])

  const checkContainer = (b: Uint8Array) => {
    const { chunks, riffEnd } = scanWebp(b)
    expect(u32le(b, 4)).toBe(b.length - 8)
    expect(riffEnd).toBe(b.length)
    const last = chunks[chunks.length - 1]
    expect(last.end).toBe(b.length)
    const flags = b[chunks[0].data]
    const present = new Set(chunks.map((c) => c.fourcc))
    expect(!!(flags & FLAG_EXIF)).toBe(present.has('EXIF'))
    expect(!!(flags & FLAG_XMP)).toBe(present.has('XMP '))
    expect(!!(flags & FLAG_ICC)).toBe(present.has('ICCP'))
    return { chunks: chunks.map((c) => c.fourcc), flags }
  }

  it('reads EXIF, XMP and ICCP', async () => {
    const a = await analyze(build())
    expect(a.blocks.map((b) => b.label)).toEqual(['ICC colour profile', 'EXIF', 'XMP'])
    expect([a.width, a.height]).toEqual([64, 48])
  })

  it('drops EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size', async () => {
    const r = await processImage(build(), KEEP_ICC)
    const { chunks, flags } = checkContainer(r.bytes)
    expect(chunks).toEqual(['VP8X', 'ICCP', 'VP8L'])
    expect(flags).toBe(FLAG_ICC | FLAG_ALPHA)
    expect(containsBytes(r.bytes, VP8L)).toBe(true)
    expect(r.identical).toBe(true)
    expect(r.remaining).toEqual([])
  })

  it('clears the ICC flag with the ICCP chunk, and sets EXIF again for kept orientation', async () => {
    const all = await processImage(build(), STRIP_ALL)
    expect(checkContainer(all.bytes)).toEqual({ chunks: ['VP8X', 'VP8L'], flags: FLAG_ALPHA })
    const oriented = await processImage(build(), { keepOrientation: true, keepIcc: false })
    expect(checkContainer(oriented.bytes)).toEqual({ chunks: ['VP8X', 'VP8L', 'EXIF'], flags: FLAG_ALPHA | FLAG_EXIF })
    expect(oriented.after.blocks[0].orientationOnly).toBe(true)
    expect(oriented.remaining).toEqual([])
    expect(oriented.identical).toBe(true)
  })

  it('drops bytes after the RIFF data', async () => {
    const r = await processImage(concat([build(), enc('trailing junk')]), STRIP_ALL)
    expect(r.before.blocks.at(-1)?.kind).toBe('trailing')
    checkContainer(r.bytes)
    expect(has(r.bytes, 'junk')).toBe(false)
  })
})

describe('GIF', () => {
  const build = () =>
    gif([
      NETSCAPE,
      gifComment('made by a fixture'),
      gifXmp(XMP_PACKET),
      gifApp('ICCRGBG1012', icc('GIF RGB')),
      gifApp('MGK8BIM0000', photoshopIptc()),
      GIF_IMAGE,
    ])

  it('reads the comment, XMP, ICC and 8BIM extensions', async () => {
    const a = await analyze(build())
    expect(a.blocks.map((b) => b.label)).toEqual(['GIF comment', 'XMP', 'ICC colour profile', 'Photoshop resources'])
    expect(a.blocks[1].sections[0].rows.find((r) => r.key === 'dc:creator')?.value).toBe('A. Photographer')
    expect(a.warnings).toEqual([])
  })

  it('drops them, keeps NETSCAPE looping and the image blocks byte for byte', async () => {
    const r = await processImage(build(), STRIP_ALL)
    expect(r.after.blocks).toEqual([])
    expect(r.remaining).toEqual([])
    expect(r.identical).toBe(true)
    expect(containsBytes(r.bytes, NETSCAPE)).toBe(true)
    expect(containsBytes(r.bytes, GIF_IMAGE)).toBe(true)
    expect(ascii(r.bytes, 0, 6)).toBe('GIF89a')
    expect(r.bytes[r.bytes.length - 1]).toBe(0x3b)
  })

  it('stops on a truncated extension', async () => {
    const cut = build().subarray(0, 40)
    expect((await analyze(cut)).warnings.join()).toMatch(/runs past the end/)
  })
})

describe('HEIF / AVIF', () => {
  const image = enc('pretend HEVC bitstream bytes')
  const build = (brand = 'heic') => heif({ brand, image, exif: tiff(CAMERA_TIFF), xmp: XMP_PACKET, profile: icc('Display P3') })

  it('finds the Exif and XMP items through iloc, and the colr profile', async () => {
    const a = await analyze(build())
    expect(a.formatLabel).toBe('HEIF (heic)')
    expect(a.blocks.map((b) => [b.kind, b.where])).toEqual([
      ['exif', 'Exif item 2'],
      ['xmp', 'XMP (mime) item 3'],
      ['icc', expect.stringMatching(/^colr property box/)],
    ])
    expect(a.gps?.lat).toBeCloseTo(37.7749, 4)
    expect([a.width, a.height]).toEqual([640, 480])
    expect((await analyze(build('avif'))).mime).toBe('image/avif')
  })

  it('zeroes the payloads in place: same length, same offsets, image bytes untouched', async () => {
    const input = build()
    const r = await processImage(input.slice(), STRIP_ALL)
    expect(r.bytes.length).toBe(input.length)
    expect(r.remaining).toEqual([])
    expect(r.identical).toBe(true)
    expect(r.after.blocks.filter((b) => b.kind !== 'icc').every((b) => b.empty)).toBe(true)
    expect(has(r.bytes, 'Testmaker')).toBe(false)
    expect(has(r.bytes, 'xmpmeta')).toBe(false)
    const at = indexOf(input, 'pretend HEVC')
    expect(r.bytes.subarray(at, at + image.length)).toEqual(image)
    // Everything outside the two payloads is byte-identical, iloc included.
    let differing = 0
    for (let i = 0; i < input.length; i++) if (input[i] !== r.bytes[i]) differing++
    expect(differing).toBeGreaterThan(0)
    expect(r.kept.some((k) => /kept anyway/.test(k))).toBe(true)
    expect(r.kept.some((k) => /irot/.test(k))).toBe(true)
  })

  it('rejects video', async () => {
    const mp4 = concat([new Uint8Array([0, 0, 0, 16]), enc('ftypisom'), new Uint8Array(4)])
    await expect(analyze(mp4)).rejects.toThrow(/video/)
  })
})

describe('format detection', () => {
  it('rejects TIFF and unknown data with a clear message', async () => {
    await expect(analyze(tiff(CAMERA_TIFF))).rejects.toThrow(/TIFF and camera raw/)
    await expect(analyze(enc('hello'))).rejects.toThrow(/Not a supported image/)
  })
})
