/**
 * Draws the site mark — the three-blade fan from src/shell/BladeMark.tsx, light
 * blades and an accent pivot on a dark tile — as the PNG app icons a
 * webmanifest needs, and writes the favicon in index.html from the same
 * geometry, so the tab icon and the installed icon cannot drift apart.
 *
 * Hand-rolled rather than pulling in an image library: the mark is three
 * polygons, a circle and a rounded rect, and node's zlib is all a PNG encoder
 * needs. One-shot — run `npm run icons` and commit the output (public/icons/
 * and index.html); the build does not depend on it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'

const TILE = '#1b1a18'
const BLADE = '#f7f7f5'
/** The light-theme --accent in src/shell/theme.css. */
const PIVOT = '#d92c20'

/** Supersampling factor per axis — the smallest PNG is 180 px, so 4× is plenty. */
const SS = 4

/** Corner radius of the rounded tiles: 22% of the edge (7 units of the 32-unit favicon). */
const TILE_RADIUS = 0.22

/**
 * The mark in BladeMark.tsx's 32-unit viewBox: each blade is a polygon rotated
 * about the pivot, and the pivot is a circle drawn over the blade roots.
 * FULL is BladeMark's own paths, used wherever the icon is large.
 */
export const FULL = {
  pivot: [16, 20.5],
  radius: 3.1,
  blades: [
    { points: [[13.6, 20.5], [16, 5.2], [18.4, 20.5]], rotate: -42 },
    { points: [[13.2, 20.5], [16, 3.2], [18.8, 20.5]], rotate: 0 },
    { points: [[13.6, 20.5], [16, 5.2], [18.4, 20.5]], rotate: 42 },
  ],
}

/**
 * The favicon variant. At 16 px the full mark's needle tips anti-alias away
 * and what is left reads as a crown; wider roots, blunt tips, a slightly wider
 * spread and a bigger pivot keep three separate blades on a hub.
 */
const SMALL = {
  pivot: [16, 20.5],
  radius: 3.7,
  blades: [
    { points: [[13.1, 20.5], [15.3, 6.4], [16.7, 6.4], [18.9, 20.5]], rotate: -44 },
    { points: [[12.7, 20.5], [15.2, 3.6], [16.8, 3.6], [19.3, 20.5]], rotate: 0 },
    { points: [[13.1, 20.5], [15.3, 6.4], [16.7, 6.4], [18.9, 20.5]], rotate: 44 },
  ],
}

function rotateAbout([x, y], [cx, cy], degrees) {
  const t = (degrees * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)]
}

/** Blade polygons with their rotation applied, in mark units. */
function bladePolygons(mark) {
  return mark.blades.map(({ points, rotate }) => points.map((p) => rotateAbout(p, mark.pivot, rotate)))
}

/** Centre of the mark's bounding box, which is what sits on the tile's centre. */
function markCentre(mark) {
  const points = bladePolygons(mark).flat()
  const [px, py] = mark.pivot
  const xs = [...points.map((p) => p[0]), px - mark.radius, px + mark.radius]
  const ys = [...points.map((p) => p[1]), py - mark.radius, py + mark.radius]
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

/** Farthest the mark reaches from its centre, in mark units — what a mask's safe circle has to hold. */
function markReach(mark) {
  const [cx, cy] = markCentre(mark)
  const [px, py] = mark.pivot
  return Math.max(
    ...bladePolygons(mark).flat().map(([x, y]) => Math.hypot(x - cx, y - cy)),
    Math.hypot(px - cx, py - cy) + mark.radius,
  )
}

/**
 * The icon as shapes in unit coordinates (0..1 across the icon). `span` is how
 * much of the icon edge the mark's 32-unit box covers: 1 keeps BladeMark's own
 * margins, so the mark fills about two thirds of the tile.
 */
export function scene(mark, { span, radius }) {
  const [cx, cy] = markCentre(mark)
  const k = span / 32
  const place = ([x, y]) => [0.5 + (x - cx) * k, 0.5 + (y - cy) * k]
  return {
    radius,
    blades: bladePolygons(mark).map((polygon) => polygon.map(place)),
    pivot: { centre: place(mark.pivot), radius: mark.radius * k },
  }
}

// ---- rasterising ----

/** Rounded-rect hit test in unit coordinates; radius 0 degenerates to the full square. */
function inTile(x, y, radius) {
  if (x < 0 || y < 0 || x > 1 || y > 1) return false
  const cx = Math.min(Math.max(x, radius), 1 - radius)
  const cy = Math.min(Math.max(y, radius), 1 - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

/** Convex polygon hit test: the point is on the same side of every edge. */
function inPolygon(x, y, polygon) {
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % polygon.length]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

const COLOURS = { tile: rgb(TILE), blade: rgb(BLADE), pivot: rgb(PIVOT) }

function colourAt(x, y, shapes) {
  if (!inTile(x, y, shapes.radius)) return null
  const { centre, radius } = shapes.pivot
  if (Math.hypot(x - centre[0], y - centre[1]) <= radius) return COLOURS.pivot
  if (shapes.blades.some((polygon) => inPolygon(x, y, polygon))) return COLOURS.blade
  return COLOURS.tile
}

/**
 * Renders at ss× and box-filters down. Averaging happens in premultiplied
 * alpha so the transparent side of a rounded corner cannot darken the tile.
 */
export function render(size, shapes, ss = SS) {
  const big = size * ss
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const colour = colourAt((x * ss + sx + 0.5) / big, (y * ss + sy + 0.5) / big, shapes)
          if (!colour) continue
          r += colour[0]
          g += colour[1]
          b += colour[2]
          a += 255
        }
      }
      const i = (y * size + x) * 4
      // un-premultiply: the accumulated colour is already weighted by coverage
      out[i] = a ? Math.round(r / (a / 255)) : 0
      out[i + 1] = a ? Math.round(g / (a / 255)) : 0
      out[i + 2] = a ? Math.round(b / (a / 255)) : 0
      out[i + 3] = Math.round(a / (ss * ss))
    }
  }
  return out
}

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

/** 8-bit RGBA, no interlacing, every scanline filtered as "none". Square unless `height` is given. */
export function encodePng(size, rgba, height = size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour with alpha
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
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

// ---- SVG favicon ----

const n = (v) => String(Math.round(v * 3200) / 100)

/** The favicon as an SVG document in a 32-unit viewBox. */
export function faviconSvg(shapes) {
  const blades = shapes.blades
    .map((polygon) => `M${polygon.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`)
    .join('')
  const { centre, radius } = shapes.pivot
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="${n(shapes.radius)}" fill="${TILE}"/>` +
    `<path d="${blades}" fill="${BLADE}"/>` +
    `<circle cx="${n(centre[0])}" cy="${n(centre[1])}" r="${n(radius)}" fill="${PIVOT}"/>` +
    `</svg>`
  )
}

/** Percent-encodes just what a data: URL in an HTML attribute needs, as the old favicon did. */
export function dataUrl(svg) {
  return `data:image/svg+xml,${svg.replaceAll('"', "'").replaceAll('<', '%3C').replaceAll('>', '%3E').replaceAll('#', '%23')}`
}

// ---- output ----

/** The favicon is mostly drawn at 16–32 px, so it gets the small-size mark, a little larger. */
export const FAVICON = scene(SMALL, { span: 1.18, radius: TILE_RADIUS })

export const ICONS = [
  { file: 'icon-192.png', size: 192, shapes: scene(FULL, { span: 1, radius: TILE_RADIUS }) },
  { file: 'icon-512.png', size: 512, shapes: scene(FULL, { span: 1, radius: TILE_RADIUS }) },
  /**
   * Maskable: the platform crops to its own shape, so the tile goes edge to
   * edge and the mark is scaled until its farthest point sits 0.36 of the
   * edge from the centre — inside the 0.4 safe circle with a little air.
   */
  { file: 'maskable-512.png', size: 512, shapes: scene(FULL, { span: (0.36 * 32) / markReach(FULL), radius: 0 }) },
  /** iOS applies its own squircle, so this one is full-bleed too. */
  { file: 'apple-touch-icon.png', size: 180, shapes: scene(FULL, { span: 1, radius: 0 }) },
]

function main() {
  const dir = fileURLToPath(new URL('../public/icons/', import.meta.url))
  mkdirSync(dir, { recursive: true })
  for (const { file, size, shapes } of ICONS) {
    const png = encodePng(size, render(size, shapes))
    writeFileSync(dir + file, png)
    console.log(`${file.padEnd(22)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KiB`)
  }

  const htmlPath = fileURLToPath(new URL('../index.html', import.meta.url))
  const html = readFileSync(htmlPath, 'utf8')
  const link = /<link rel="icon"[^>]*>/
  if (!link.test(html)) throw new Error('gen-icons: no <link rel="icon"> in index.html')
  const svg = faviconSvg(FAVICON)
  writeFileSync(htmlPath, html.replace(link, `<link rel="icon" type="image/svg+xml" href="${dataUrl(svg)}" />`))
  console.log(`${'index.html favicon'.padEnd(22)} svg     ${(svg.length / 1024).toFixed(1)} KiB`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
