import { describe, expect, it } from 'vitest'
import { concat } from './bytes'
import { dms, exifBlock, isOrientationOnly, newFacts, orientationTiff, parseTiff } from './exif'
import { CAMERA_TIFF, tiff } from './testkit'

const rows = (block: ReturnType<typeof exifBlock>, title: string) =>
  Object.fromEntries((block.sections.find((s) => s.title.startsWith(title))?.rows ?? []).map((r) => [r.key, r.value]))

describe('TIFF/EXIF parsing', () => {
  it.each([
    ['big-endian (MM)', false],
    ['little-endian (II)', true],
  ])('reads the same values in %s byte order', (_, le) => {
    const t = tiff({ ...CAMERA_TIFF, le })
    const facts = newFacts()
    const block = exifBlock(t, 0, t.length, 'test', { facts, warnings: [] })
    expect(rows(block, 'Byte order')['TIFF header']).toMatch(le ? /^II/ : /^MM/)
    const ifd0 = rows(block, 'IFD0')
    expect(ifd0.Make).toBe('Testmaker')
    expect(ifd0.Orientation).toBe('Rotated 90° clockwise (6)')
    const exif = rows(block, 'Exif IFD')
    expect(exif.ExposureTime).toBe('1/250 s')
    expect(exif.FNumber).toBe('f/2.8')
    expect(exif.ISO).toBe('200')
    expect(exif.FocalLength).toBe('50 mm')
    expect(exif.Flash).toBe('Did not fire, suppressed')
    const gps = rows(block, 'GPS')
    expect(gps.GPSLatitude).toBe('37°46′29.64″ N (37.774900)')
    expect(gps.GPSLongitude).toBe('122°25′09.84″ W (-122.419400)')
    expect(gps.GPSAltitude).toBe('12.5 m')
    expect(facts.gps?.lat).toBeCloseTo(37.7749, 4)
    expect(facts.gps?.lon).toBeCloseTo(-122.4194, 4)
    expect(facts.gps?.alt).toBe(12.5)
    expect(facts.orientation).toBe(6)
    expect(facts.rows.get('Camera')?.value).toBe('Testmaker TM-1 Mark II')
    expect(facts.rows.get('Taken')?.value).toBe('2024:05:06 07:08:09 +02:00')
    expect(facts.rows.get('Camera serial')).toMatchObject({ value: 'SN-0001', sensitive: true })
  })

  it('formats degrees as DMS without rounding to 60 seconds', () => {
    expect(dms(10.5, 'N', 'S')).toBe('10°30′00.00″ N')
    expect(dms(-0.9999999, 'E', 'W')).toBe('1°00′00.00″ W')
  })

  it('rejects data without a TIFF header', () => {
    expect(() => parseTiff(new Uint8Array(10), 0)).toThrow(/byte-order/)
    const block = exifBlock(new Uint8Array([0x4d, 0x4d, 0, 41, 0, 0, 0, 8]), 0, 8, 'x', { warnings: [] })
    expect(block.note).toMatch(/magic/)
    expect(block.kind).toBe('exif')
  })

  it('stops on an IFD that points back to itself', () => {
    const t = tiff({ ifd0: [{ tag: 0x0112, type: 3, value: [1] }] })
    // next-IFD pointer of IFD0 → IFD0 (offset 8)
    new DataView(t.buffer).setUint32(8 + 2 + 12, 8)
    const parsed = parseTiff(t, 0)
    expect(parsed.ifds).toHaveLength(1)
    expect(parsed.warnings.join()).toMatch(/loop/)
  })

  it('stops on a two-IFD cycle and on a sub-IFD pointing at IFD0', () => {
    const t = tiff({ ifd0: [{ tag: 0x010f, type: 2, value: 'A' }], exif: [{ tag: 0x829a, type: 5, value: [[1, 2]] }], ifd1: [{ tag: 0x0103, type: 3, value: [6] }] })
    const v = new DataView(t.buffer)
    const p = parseTiff(t, 0)
    const ifd1 = p.ifds.find((i) => i.name === 'IFD1')!.offset
    const exifAt = p.ifds.find((i) => i.name === 'ExifIFD')!.offset
    v.setUint32(ifd1 + 2 + 12, 8) // IFD1 → IFD0
    // point the Exif IFD's (missing) interop at IFD0 by rewriting its only entry into an interop pointer
    v.setUint16(exifAt + 2, 0xa005)
    v.setUint16(exifAt + 4, 4)
    v.setUint32(exifAt + 6, 1)
    v.setUint32(exifAt + 10, 8)
    const again = parseTiff(t, 0)
    expect(again.ifds.map((i) => i.name)).toEqual(['IFD0', 'ExifIFD', 'IFD1'])
    expect(again.warnings.filter((w) => /loop/.test(w))).toHaveLength(2)
  })

  it('skips entries and IFDs whose offsets fall outside the data', () => {
    const t = tiff({ ifd0: [{ tag: 0x010f, type: 2, value: 'A long make string' }, { tag: 0x0110, type: 2, value: 'ok' }], gps: [{ tag: 1, type: 2, value: 'N' }] })
    const v = new DataView(t.buffer)
    // Make's value offset → far past the end; GPS pointer → past the end
    const entries = parseTiff(t, 0).ifds[0]
    expect(entries.entries.get(0x010f)).toBeDefined()
    // entry 0 is Make (sorted by tag), its value offset lives at 8+2+8
    v.setUint32(8 + 2 + 8, 0xfffffff0)
    // GPS pointer is entry index 2 (0x010f, 0x0110, 0x8825)
    v.setUint32(8 + 2 + 2 * 12 + 8, 0x7fffffff)
    const p = parseTiff(t, 0)
    expect(p.ifds[0].entries.has(0x010f)).toBe(false)
    expect(p.ifds[0].entries.get(0x0110)?.value).toBe('ok')
    expect(p.ifds.some((i) => i.name === 'GPS')).toBe(false)
    expect(p.warnings.join('\n')).toMatch(/Make points outside/)
    expect(p.warnings.join('\n')).toMatch(/GPS offset .* outside/)
  })

  it('caps an entry count that cannot fit', () => {
    const t = tiff({ ifd0: [{ tag: 0x0112, type: 3, value: [1] }] })
    new DataView(t.buffer).setUint16(8, 60000)
    const p = parseTiff(t, 0)
    expect(p.warnings[0]).toMatch(/claims 60000 entries but only 1 fit/)
  })

  it('counts a huge count×size that would overflow the block as out of range, not as a read', () => {
    const t = tiff({ ifd0: [{ tag: 0x0111, type: 4, value: [1, 2, 3] }] })
    new DataView(t.buffer).setUint32(8 + 2 + 4, 0x40000000)
    const p = parseTiff(t, 0)
    expect(p.ifds[0].entries.size).toBe(0)
  })

  it('locates the IFD1 thumbnail, and refuses one that runs past the data', () => {
    const thumb = concat([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])])
    const t = tiff({ ifd0: [], ifd1: [{ tag: 0x0103, type: 3, value: [6] }], thumbnail: thumb })
    const p = parseTiff(t, 0)
    expect(t.subarray(p.thumbnail!.start, p.thumbnail!.end)).toEqual(thumb)
    const short = parseTiff(t, 0, t.length - 2)
    expect(short.thumbnail).toBeUndefined()
    expect(short.warnings.join()).toMatch(/thumbnail runs past/)
  })

  it('writes a minimal Orientation-only TIFF', () => {
    const t = orientationTiff(8)
    const p = parseTiff(t, 0)
    expect(t.length).toBe(26)
    expect(isOrientationOnly(p)).toBe(true)
    expect(p.ifds[0].entries.get(0x0112)?.value).toEqual([8])
  })
})
