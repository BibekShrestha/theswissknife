/**
 * The stripper keeps only what an image needs to display and drops
 * everything else — so anything it does not recognise must be both reported
 * by the analysis and gone from the re-parse.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper
import { readText } from '../../../../scripts/read-text.mjs'
import { analyze, processImage } from './analyze'
import { concat, indexOf, putU32be, u16be, u32le } from './bytes'
import { parseIcc } from './icc'
import { assembleExtendedXmp } from './jpeg'
import { scanPng } from './png'
import type { Processed, StripOptions } from './types'
import { FLAG_ALPHA, FLAG_ANIMATION, FLAG_EXIF, scanWebp } from './webp'
import {
  CAMERA_TIFF,
  GIF_IMAGE,
  JFIF,
  NETSCAPE,
  VP8L,
  XMP_PACKET,
  enc,
  extendedXmpSegments,
  gif,
  heif,
  icc,
  jpegImage,
  png,
  pngChunk,
  riffChunk,
  segment,
  tiff,
  vp8x,
  webp,
} from './testkit'

const STRIP_ALL: StripOptions = { keepOrientation: false, keepIcc: false }
const latin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const has = (b: Uint8Array, s: string) => indexOf(b, s) >= 0
const SOI = new Uint8Array([0xff, 0xd8])
const clean = (r: Processed) => r.remaining.length === 0 && r.identical

describe('JPEG allow-list', () => {
  it('EXIF-1: rewrites APP0 JFIF to 16 bytes, dropping its thumbnail and extra bytes, and reports them', async () => {
    const core = concat([latin('JFIF\0'), new Uint8Array([1, 2, 1, 0, 72, 0, 72])])
    const fat = segment(0xe0, concat([core, new Uint8Array([2, 1]), enc('PIXELS'), enc('SECRET-TAIL')]))
    const input = concat([SOI, fat, jpegImage()])
    const a = await analyze(input)
    expect(a.blocks.map((b) => b.kind)).toEqual(['thumbnail'])
    expect(a.blocks[0].label).toMatch(/JFIF thumbnail/)
    expect(a.blocks[0].note).toMatch(/2×1/)
    const r = await processImage(input, STRIP_ALL)
    expect(clean(r)).toBe(true)
    expect(has(r.bytes, 'PIXELS')).toBe(false)
    expect(has(r.bytes, 'SECRET-TAIL')).toBe(false)
    // SOI, then FF E0 00 10, the 12 core bytes unchanged, no thumbnail.
    expect([...r.bytes.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0])
    expect(u16be(r.bytes, 4)).toBe(16)
    expect(r.bytes.subarray(6, 18)).toEqual(core)
    expect([r.bytes[18], r.bytes[19]]).toEqual([0, 0])
    expect(r.bytes.length).toBe(2 + 18 + jpegImage().length)
    expect(r.removed.some((x) => /JFIF thumbnail/.test(x))).toBe(true)
  })

  it('EXIF-1: reports extra bytes in an APP0 JFIF that has no thumbnail', async () => {
    const extra = segment(0xe0, concat([latin('JFIF\0'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]), enc('hidden')]))
    const r = await processImage(concat([SOI, extra, jpegImage()]), STRIP_ALL)
    expect(r.before.blocks.map((b) => b.kind)).toEqual(['other'])
    expect(r.before.blocks[0].size).toBe(6)
    expect(has(r.bytes, 'hidden')).toBe(false)
    expect(clean(r)).toBe(true)
  })

  it('EXIF-1: drops a JFXX extension thumbnail and a second JFIF', async () => {
    const jfxx = segment(0xe0, concat([latin('JFXX\0'), new Uint8Array([0x10]), enc('thumbjpeg')]))
    const r = await processImage(concat([SOI, JFIF, jfxx, JFIF, jpegImage()]), STRIP_ALL)
    expect(r.before.blocks.map((b) => b.kind)).toEqual(['thumbnail', 'other'])
    expect(has(r.bytes, 'JFXX')).toBe(false)
    expect(indexOf(r.bytes, 'JFIF', 8)).toBe(-1)
    expect(clean(r)).toBe(true)
  })

  it('EXIF-1: keeps APP14 Adobe at its 12 meaningful bytes and reports anything after them', async () => {
    const adobe = segment(0xee, concat([latin('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, 1]), enc('adobe-extra')]))
    const r = await processImage(concat([SOI, JFIF, adobe, jpegImage()]), STRIP_ALL)
    expect(r.before.blocks).toHaveLength(1)
    expect(has(r.bytes, 'adobe-extra')).toBe(false)
    const at = indexOf(r.bytes, 'Adobe')
    expect(u16be(r.bytes, at - 2)).toBe(14)
    expect(r.bytes[at + 11]).toBe(1)
    expect(clean(r)).toBe(true)
  })

  it('EXIF-2: drops stray and fill bytes between segments and counts them as found', async () => {
    const input = concat([SOI, new Uint8Array([0xff, 0xff, 0xff]), JFIF, enc('stray note'), jpegImage()])
    const a = await analyze(input)
    const stray = a.blocks.find((b) => /between segments/.test(b.label))
    // three fill bytes before JFIF's own FF E0, then the ten stray bytes
    expect(stray?.size).toBe(13)
    const r = await processImage(input, STRIP_ALL)
    expect(has(r.bytes, 'stray note')).toBe(false)
    expect([...r.bytes.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0])
    expect(r.bytes.length).toBe(2 + JFIF.length + jpegImage().length)
    expect(clean(r)).toBe(true)
  })

  it('EXIF-2: drops unknown markers (JPGn, TEM) instead of copying them', async () => {
    const input = concat([SOI, JFIF, segment(0xf1, enc('jpg1 payload')), new Uint8Array([0xff, 0x01]), jpegImage()])
    const r = await processImage(input, STRIP_ALL)
    expect(r.before.blocks.length).toBe(2)
    expect(has(r.bytes, 'jpg1 payload')).toBe(false)
    expect(r.bytes.length).toBe(2 + JFIF.length + jpegImage().length)
    expect(clean(r)).toBe(true)
  })
})

describe('PNG allow-list', () => {
  const chunk = (type: string, size = 4) => pngChunk(type, new Uint8Array(size).fill(1))
  const build = () =>
    png(
      [
        chunk('gAMA'),
        chunk('cHRM', 32),
        chunk('sRGB', 1),
        chunk('pHYs', 9),
        chunk('sBIT', 3),
        chunk('tRNS', 6),
        chunk('acTL', 8),
        chunk('fcTL', 26),
        pngChunk('caBX', enc('c2pa jumbf manifest')),
        pngChunk('exIf', tiff(CAMERA_TIFF)),
        pngChunk('prVW', enc('preview pixels')),
        pngChunk('zzZz', enc('private stuff')),
        chunk('bKGD', 6),
      ],
      [chunk('fdAT', 12), pngChunk('vpAg', enc('after idat'))],
    )

  it('EXIF-3: reports C2PA, pre-standard exIf, prVW and unknown ancillary chunks', async () => {
    const a = await analyze(build())
    expect(a.blocks.map((b) => b.label)).toEqual([
      'C2PA content credentials',
      'EXIF',
      'Preview image (prVW)',
      'Chunk “zzZz”',
      'Background colour (bKGD)',
      'Chunk “vpAg”',
    ])
    expect(a.gps?.lat).toBeCloseTo(37.7749, 4)
  })

  it('EXIF-3: keeps only the chunks needed to display the image, APNG included', async () => {
    const r = await processImage(build(), STRIP_ALL)
    expect(scanPng(r.bytes).chunks.map((c) => c.type)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'sBIT', 'tRNS', 'acTL', 'fcTL', 'IDAT', 'fdAT', 'IEND'])
    for (const s of ['c2pa', 'Testmaker', 'preview', 'private', 'after idat']) expect(has(r.bytes, s), s).toBe(false)
    expect(clean(r)).toBe(true)
    expect(r.removed).toContain('caBX chunk')
  })
})

describe('WebP allow-list', () => {
  const frame = (inner: Uint8Array[]) => riffChunk('ANMF', concat([new Uint8Array(16), ...inner]))
  const build = () =>
    webp([
      vp8x(FLAG_ANIMATION | FLAG_ALPHA | FLAG_EXIF),
      riffChunk('ANIM', new Uint8Array(6)),
      frame([VP8L, riffChunk('ZZZZ', enc('frame secret'))]),
      riffChunk('C2PA', enc('c2pa claim')),
      riffChunk('UNKN', enc('mystery')),
      riffChunk('EXIF', tiff(CAMERA_TIFF)),
    ])

  it('EXIF-3: reports C2PA and unknown chunks, inside animation frames too', async () => {
    const a = await analyze(build())
    expect(a.blocks.map((b) => b.label)).toEqual(['Chunk “ZZZZ”', 'C2PA content credentials', 'Chunk “UNKN”', 'EXIF'])
    expect(a.blocks[0].where).toMatch(/animation frame 1/)
  })

  it('EXIF-3: drops them, rebuilds the frame, fixes the VP8X flags and the RIFF size', async () => {
    const r = await processImage(build(), STRIP_ALL)
    const { chunks, riffEnd } = scanWebp(r.bytes)
    expect(chunks.map((c) => c.fourcc)).toEqual(['VP8X', 'ANIM', 'ANMF'])
    expect(riffEnd).toBe(r.bytes.length)
    expect(u32le(r.bytes, 4)).toBe(r.bytes.length - 8)
    expect(chunks[2].size).toBe(16 + VP8L.length)
    expect(r.bytes[chunks[0].data]).toBe(FLAG_ANIMATION | FLAG_ALPHA)
    for (const s of ['frame secret', 'c2pa', 'mystery', 'Testmaker']) expect(has(r.bytes, s), s).toBe(false)
    expect(clean(r)).toBe(true)
  })

  it('EXIF-3: writes RIFF pad bytes as zero', async () => {
    const vp8l = VP8L.slice()
    vp8l[vp8l.length - 1] = 0x55
    const r = await processImage(webp([vp8l]), STRIP_ALL)
    expect(r.bytes[r.bytes.length - 1]).toBe(0)
    expect(clean(r)).toBe(true)
  })
})

describe('GIF allow-list', () => {
  const sub = (s: string) => concat([new Uint8Array([s.length]), latin(s), new Uint8Array([0])])
  const plainText = concat([new Uint8Array([0x21, 0x01, 12]), new Uint8Array(12), sub('hello text')])
  const unknownExt = concat([new Uint8Array([0x21, 0x99]), sub('weird')])
  const badApp = concat([new Uint8Array([0x21, 0xff, 5]), latin('ABCDE'), sub('bad app data')])
  const loopExtra = concat([new Uint8Array([0x21, 0xff, 11]), latin('NETSCAPE2.0'), new Uint8Array([3, 1, 0, 0]), sub('extra')])

  it('EXIF-5: reports plain-text, unknown and malformed application extensions', async () => {
    const a = await analyze(gif([loopExtra, plainText, unknownExt, badApp, GIF_IMAGE]))
    expect(a.blocks.map((b) => b.label)).toEqual(['Extra data in the looping extension', 'GIF plain text', 'Extension 0x99', 'Malformed application extension'])
    expect(a.blocks[1].sections[0].rows[0].value).toBe('hello text')
  })

  it('EXIF-5: keeps only image blocks, graphic control and a minimal looping extension', async () => {
    const r = await processImage(gif([loopExtra, plainText, unknownExt, badApp, GIF_IMAGE]), STRIP_ALL)
    for (const s of ['hello text', 'weird', 'bad app data', 'extra']) expect(has(r.bytes, s), s).toBe(false)
    expect(indexOf(r.bytes, 'NETSCAPE2.0')).toBeGreaterThan(0)
    expect(r.bytes.length).toBe(gif([NETSCAPE, GIF_IMAGE]).length)
    expect(clean(r)).toBe(true)
  })
})

describe('HEIF items that cannot be overwritten', () => {
  const image = enc('pretend HEVC bitstream bytes')

  it('EXIF-4: an Exif item with no iloc entry is not "emptied" and the result is not clean', async () => {
    const input = heif({ image, exif: tiff(CAMERA_TIFF), omitFromIloc: [2] })
    const a = await analyze(input)
    const exif = a.blocks.find((b) => b.kind === 'exif')!
    expect(exif.empty).toBeFalsy()
    expect(exif.unremovable).toMatch(/iloc/)
    const r = await processImage(input, STRIP_ALL)
    expect(r.remaining.map((b) => b.kind)).toEqual(['exif'])
    expect(clean(r)).toBe(false)
    expect(r.removed.some((x) => /overwritten/.test(x))).toBe(false)
  })

  it('EXIF-4: construction method 2 (item offset) is not clean either', async () => {
    const r = await processImage(heif({ image, xmp: XMP_PACKET, constructionMethod: { 3: 2 } }), STRIP_ALL)
    expect(r.remaining.map((b) => b.unremovable)).toEqual([expect.stringMatching(/construction method 2/)])
    expect(clean(r)).toBe(false)
  })

  it('EXIF-4: an extent running past the end is zeroed as far as the file goes, and flagged', async () => {
    const full = heif({ image, exif: tiff(CAMERA_TIFF), xmp: XMP_PACKET })
    // Cut inside the Exif payload: Testmaker is in the file, the XMP item is entirely past the end.
    const cut = full.slice(0, indexOf(full, 'Testmaker') + 20)
    const a = await analyze(cut)
    const exif = a.blocks.find((b) => b.kind === 'exif')!
    expect(exif.size).toBeGreaterThan(0)
    expect(exif.note).toMatch(/past the end/)
    const r = await processImage(cut, STRIP_ALL)
    expect(has(r.bytes, 'Testmaker')).toBe(false)
    const after = r.after.blocks.find((b) => b.kind === 'exif')!
    expect(after.empty).toBe(true)
    expect(after.note).toMatch(/past the end/)
    // The XMP item has no bytes in the file at all: it cannot be shown to be gone.
    expect(r.remaining.map((b) => b.kind)).toEqual(['xmp'])
    expect(clean(r)).toBe(false)
  })
})

describe('extended XMP', () => {
  it('EXIF-6: assembles only the bytes that are present, and stops at a total budget', () => {
    const budget = { left: 100 }
    const one = assembleExtendedXmp([{ offset: 0, data: enc('a'.repeat(40)) }], 16 * 1024 * 1024, budget)
    expect(one.bytes.length).toBe(40)
    expect(one.incomplete).toBe(true)
    const far = assembleExtendedXmp([{ offset: 15 * 1024 * 1024, data: enc('b'.repeat(40)) }], 16 * 1024 * 1024, budget)
    expect(far.bytes.length).toBeLessThanOrEqual(40)
    const over = assembleExtendedXmp([{ offset: 0, data: enc('c'.repeat(80)) }], 80, budget)
    expect(over.bytes.length).toBeLessThanOrEqual(20)
    expect(over.capped).toBe(true)
    expect(budget.left).toBe(0)
  })

  it('EXIF-6: says when an extended XMP packet is incomplete', async () => {
    const segs = extendedXmpSegments(XMP_PACKET)
    // Claim a 16 MB packet: the reader must not allocate it, and must say it is incomplete.
    for (const s of segs) putU32be(s, 4 + 35 + 32, 16 * 1024 * 1024)
    const a = await analyze(concat([SOI, JFIF, ...segs, jpegImage()]))
    const block = a.blocks.find((b) => b.label === 'XMP (extended)')!
    expect(block.note).toMatch(/incomplete/i)
    expect(block.sections[0].rows.length).toBeGreaterThan(0)
  })
})

describe('ICC device text', () => {
  it('EXIF-7: shows the device maker and model a profile names, flagged as identifying', () => {
    const p = icc('Camera RGB', { manufacturer: 'TMKR', model: 'TM01', makerText: 'Testmaker Inc.', modelText: 'TM-1 Mark II' })
    const rows = parseIcc(p, 0, p.length).rows
    const get = (key: string) => rows.find((r) => r.key === key)
    expect(get('Device maker')?.value).toBe('Testmaker Inc. (TMKR)')
    expect(get('Device model')?.value).toBe('TM-1 Mark II (TM01)')
    expect(get('Device model')?.sensitive).toBe(true)
    expect(get('Description')?.value).toBe('Camera RGB')
  })

  it('EXIF-7: the keep-profile option no longer says a profile cannot describe you', () => {
    const page: string = readText('src/tools/exif/index.tsx')
    expect(page).not.toMatch(/describe colour, not you/)
    expect(page).toMatch(/can name the device, maker or software/)
  })
})
