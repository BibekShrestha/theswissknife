/**
 * Magic-byte sniffing. The browser decodes by content, not by extension, so
 * the tool should too — a .jpg that is really a PNG must still work, and an
 * animated GIF has to be recognised before we silently keep only frame one.
 */

import type { InFormat } from './formats'

export type Frames = 'single' | 'animated' | 'unknown'

export interface Sniffed {
  format: InFormat
  frames: Frames
}

/** Enough bytes to see a WebP ANIM chunk or an APNG acTL, cheap to slice. */
export const SNIFF_BYTES = 4096

export function sniff(bytes: Uint8Array): Sniffed {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // APNG announces itself with an acTL chunk before the first IDAT
    return { format: 'png', frames: hasAscii(bytes, 'acTL') ? 'animated' : 'single' }
  }
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { format: 'jpeg', frames: 'single' }
  if (hasAsciiAt(bytes, 0, 'GIF87a') || hasAsciiAt(bytes, 0, 'GIF89a')) {
    // The Netscape loop block sits near the top of every animated GIF, so it
    // is visible inside the sniff window even when frame one is not.
    if (hasAscii(bytes, 'NETSCAPE')) return { format: 'gif', frames: 'animated' }
    return { format: 'gif', frames: gifFrames(bytes) }
  }
  if (hasAsciiAt(bytes, 0, 'RIFF') && hasAsciiAt(bytes, 8, 'WEBP')) {
    // VP8X extended format flags animation, and the ANIM chunk carries it
    return { format: 'webp', frames: hasAscii(bytes, 'ANIM') ? 'animated' : 'single' }
  }
  if (starts(bytes, [0x42, 0x4d])) return { format: 'bmp', frames: 'single' }
  if (hasAsciiAt(bytes, 4, 'ftyp') && (hasAscii(bytes, 'avif') || hasAscii(bytes, 'avis'))) {
    return { format: 'avif', frames: hasAscii(bytes, 'avis') ? 'animated' : 'single' }
  }
  if (looksLikeSvg(bytes)) return { format: 'svg', frames: 'single' }
  return { format: 'unknown', frames: 'unknown' }
}

/**
 * A GIF is animated when it holds more than one image descriptor (0x2C). The
 * blocks before it are variable-length, so this walks the stream properly
 * rather than counting bytes that could appear inside pixel data.
 */
function gifFrames(bytes: Uint8Array): Frames {
  let p = 13 // header (6) + logical screen descriptor (7)
  if (bytes.length <= p) return 'unknown'
  const packed = bytes[10]
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1)) // global colour table
  let images = 0
  while (p < bytes.length) {
    const block = bytes[p]
    if (block === 0x3b) return images > 1 ? 'animated' : 'single' // trailer
    if (block === 0x21) {
      // extension: label byte, then sub-blocks
      p = skipSubBlocks(bytes, p + 2)
    } else if (block === 0x2c) {
      if (++images > 1) return 'animated'
      const local = bytes[p + 9]
      p += 10
      if (local & 0x80) p += 3 * (1 << ((local & 0x07) + 1))
      p += 1 // LZW minimum code size
      p = skipSubBlocks(bytes, p)
    } else {
      return 'unknown' // not a shape we understand; do not guess
    }
    if (p <= 0) return 'unknown' // truncated inside the sniff window
  }
  return 'unknown'
}

/** Returns the offset after a chain of sub-blocks, or -1 if it runs off the end. */
function skipSubBlocks(bytes: Uint8Array, start: number): number {
  let p = start
  while (p < bytes.length) {
    const len = bytes[p]
    if (len === 0) return p + 1
    p += len + 1
  }
  return -1
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  // a UTF-8 BOM ahead of the root element is common from design tools
  const from = starts(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  const head = ascii(bytes.subarray(from, from + 1024)).trimStart().toLowerCase()
  if (head.startsWith('<svg')) return true
  return (head.startsWith('<?xml') || head.startsWith('<!doctype')) && head.includes('<svg')
}

function starts(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((byte, i) => bytes[i] === byte)
}

function hasAsciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function hasAscii(bytes: Uint8Array, text: string): boolean {
  const limit = Math.min(bytes.length, SNIFF_BYTES)
  for (let i = 0; i + text.length <= limit; i++) {
    if (hasAsciiAt(bytes, i, text)) return true
  }
  return false
}

function ascii(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}
