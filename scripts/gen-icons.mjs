/**
 * Draws the site mark — the red rounded square with a white cross from the
 * favicon in index.html — as the PNG app icons a webmanifest needs.
 *
 * Hand-rolled rather than pulling in an image library: the mark is two
 * rectangles and a rounded rect, and node's zlib is all a PNG encoder needs.
 * One-shot — run `npm run icons` and commit the output; the build does not
 * depend on it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const RED = [0xda, 0x29, 0x1c]
const WHITE = [0xff, 0xff, 0xff]

/** Supersampling factor — the mark is all straight edges and four arcs, so 4x is plenty. */
const SS = 4

/**
 * Geometry, as fractions of the icon, taken from the 32-unit favicon path
 * `M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z`: the cross spans 20/32 and its bars are
 * 6/32 thick, and the plate corner radius is 7/32.
 */
const CROSS_SPAN = 20 / 32
const BAR_RATIO = 6 / 20
const PLATE_RADIUS = 7 / 32

// ---- PNG ----

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** 8-bit RGBA, no interlacing, every scanline filtered as "none". */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- the mark ----

/** Rounded-rect hit test in unit coordinates; radius 0 degenerates to the full square. */
function inPlate(x, y, radius) {
  if (x < 0 || y < 0 || x > 1 || y > 1) return false
  const cx = Math.min(Math.max(x, radius), 1 - radius)
  const cy = Math.min(Math.max(y, radius), 1 - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function inCross(x, y, span) {
  const bar = span * BAR_RATIO
  const outer = [0.5 - span / 2, 0.5 + span / 2]
  const inner = [0.5 - bar / 2, 0.5 + bar / 2]
  const vertical = x >= inner[0] && x <= inner[1] && y >= outer[0] && y <= outer[1]
  const horizontal = x >= outer[0] && x <= outer[1] && y >= inner[0] && y <= inner[1]
  return vertical || horizontal
}

/**
 * Renders at SS× and box-filters down. Averaging happens in premultiplied
 * alpha so the transparent side of a rounded corner cannot darken the red.
 */
function render(size, { radius, span }) {
  const big = size * SS
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x * SS + sx + 0.5) / big
          const v = (y * SS + sy + 0.5) / big
          if (!inPlate(u, v, radius)) continue
          const [pr, pg, pb] = inCross(u, v, span) ? WHITE : RED
          r += pr
          g += pg
          b += pb
          a += 255
        }
      }
      const samples = SS * SS
      const i = (y * size + x) * 4
      // un-premultiply: the accumulated colour is already weighted by coverage
      out[i] = a ? Math.round(r / (a / 255)) : 0
      out[i + 1] = a ? Math.round(g / (a / 255)) : 0
      out[i + 2] = a ? Math.round(b / (a / 255)) : 0
      out[i + 3] = Math.round(a / samples)
    }
  }
  return out
}

// ---- output ----

const ICONS = [
  { file: 'icon-192.png', size: 192, radius: PLATE_RADIUS, span: CROSS_SPAN },
  { file: 'icon-512.png', size: 512, radius: PLATE_RADIUS, span: CROSS_SPAN },
  /**
   * Maskable: the platform crops to its own shape, so the plate goes
   * edge to edge and the cross shrinks into the 80% safe circle — a square
   * inscribed in that circle is 0.8/√2 ≈ 0.566 wide, so 0.55 clears it.
   */
  { file: 'maskable-512.png', size: 512, radius: 0, span: 0.55 },
  /** iOS applies its own squircle, so this one is full-bleed too. */
  { file: 'apple-touch-icon.png', size: 180, radius: 0, span: CROSS_SPAN },
]

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url))
mkdirSync(dir, { recursive: true })

for (const { file, size, radius, span } of ICONS) {
  const png = encodePng(size, render(size, { radius, span }))
  writeFileSync(dir + file, png)
  console.log(`${file.padEnd(22)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KiB`)
}
