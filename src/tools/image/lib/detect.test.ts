import { describe, expect, it } from 'vitest'
import { sniff } from './detect'

const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))
const bytes = (...parts: (number | number[])[]): Uint8Array =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'number' ? [p] : p)))

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** header + logical screen descriptor with a 2-colour global colour table */
const GIF_HEAD = [...text('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff]
/** image descriptor + LZW min code size + one empty sub-block chain */
const GIF_FRAME = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x02, 0x01, 0x00, 0x00]

describe('sniff', () => {
  it('reads PNG and spots APNG animation', () => {
    expect(sniff(bytes(PNG_MAGIC, text('IHDR')))).toEqual({ format: 'png', frames: 'single' })
    expect(sniff(bytes(PNG_MAGIC, text('acTL')))).toEqual({ format: 'png', frames: 'animated' })
  })

  it('reads JPEG', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ format: 'jpeg', frames: 'single' })
  })

  it('reads a single-frame GIF by walking its blocks', () => {
    expect(sniff(bytes(GIF_HEAD, GIF_FRAME, 0x3b))).toEqual({ format: 'gif', frames: 'single' })
  })

  it('calls a GIF animated when it holds more than one frame', () => {
    expect(sniff(bytes(GIF_HEAD, GIF_FRAME, GIF_FRAME, 0x3b))).toEqual({
      format: 'gif',
      frames: 'animated',
    })
  })

  it('trusts the Netscape loop block, which sits inside the sniff window', () => {
    const loop = [0x21, 0xff, 0x0b, ...text('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0x00]
    expect(sniff(bytes(GIF_HEAD, loop, GIF_FRAME, 0x3b))).toEqual({
      format: 'gif',
      frames: 'animated',
    })
  })

  it('admits it does not know when a GIF is cut off mid-stream', () => {
    expect(sniff(bytes(GIF_HEAD, 0x2c, 0, 0, 0, 0))).toEqual({ format: 'gif', frames: 'unknown' })
  })

  it('reads WebP and spots the ANIM chunk', () => {
    const riff = (...rest: number[][]) => bytes(text('RIFF'), [0, 0, 0, 0], text('WEBP'), ...rest)
    expect(sniff(riff(text('VP8 ')))).toEqual({ format: 'webp', frames: 'single' })
    expect(sniff(riff(text('VP8X'), [0, 0, 0, 0], text('ANIM')))).toEqual({
      format: 'webp',
      frames: 'animated',
    })
  })

  it('reads BMP and AVIF', () => {
    expect(sniff(bytes(0x42, 0x4d, 0, 0))).toEqual({ format: 'bmp', frames: 'single' })
    expect(sniff(bytes([0, 0, 0, 0x18], text('ftyp'), text('avif')))).toEqual({
      format: 'avif',
      frames: 'single',
    })
  })

  it('reads SVG with or without a prolog or BOM', () => {
    expect(sniff(bytes(text('<svg viewBox="0 0 8 8"/>')))).toEqual({
      format: 'svg',
      frames: 'single',
    })
    expect(sniff(bytes(text('  \n<?xml version="1.0"?><svg/>')))).toEqual({
      format: 'svg',
      frames: 'single',
    })
    expect(sniff(bytes([0xef, 0xbb, 0xbf], text('<SVG xmlns="x"/>')))).toEqual({
      format: 'svg',
      frames: 'single',
    })
  })

  it('does not mistake arbitrary XML or text for an image', () => {
    expect(sniff(bytes(text('<?xml version="1.0"?><rss/>')))).toEqual({
      format: 'unknown',
      frames: 'unknown',
    })
    expect(sniff(bytes(text('hello')))).toEqual({ format: 'unknown', frames: 'unknown' })
    expect(sniff(new Uint8Array(0))).toEqual({ format: 'unknown', frames: 'unknown' })
  })
})
