/**
 * Draws the link-preview image (public/og.png, 1200×630), which index.html and
 * every tool page name as og:image / twitter:image.
 *
 * The brand, nothing else: the landing hero's "ONE TOOLBOX." in the display
 * face, the site's promise, the domain, and the blade mark on its tile — in
 * the light theme's colours from src/shell/theme.css, square corners, on the
 * landing page's 40 px grid. No tool names or counts, so it never goes stale.
 *
 * Text is Inter Tight from scripts/fonts/inter-tight/ (OFL), laid out and
 * flattened by scripts/fonts/outline.py — fontTools is what can instance the
 * variable font at a weight — and filled here with a small nonzero-winding
 * scanline rasteriser. The mark comes from scripts/gen-icons.mjs, so it is the
 * same geometry as BladeMark.tsx and the app icons.
 *
 * One-shot — `npm run og-image`, then commit public/og.png. Needs Python 3 with
 * fontTools and brotli (as `npm run display-font` does); set PYTHON to pick
 * the interpreter. The image is a public/ file outside the Rollup bundle, so
 * the service worker never precaches it (scripts/check-bundle.mjs checks).
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FULL, encodePng, scene } from './gen-icons.mjs'

export const WIDTH = 1200
export const HEIGHT = 630

/** Light-theme tokens from src/shell/theme.css. */
const C = {
  bg: '#f7f7f5',
  border: '#e0ded8',
  borderStrong: '#aaa69f',
  text: '#1b1a18',
  muted: '#6b6862',
  accent: '#d92c20',
}

/** Vertical subsamples per pixel; horizontal coverage is computed exactly. */
const SS = 5

const at = (relative) => fileURLToPath(new URL(relative, import.meta.url))
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function canvas() {
  const px = new Float32Array(WIDTH * HEIGHT * 3)
  const [r, g, b] = rgb(C.bg)
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    px[i * 3] = r
    px[i * 3 + 1] = g
    px[i * 3 + 2] = b
  }
  return px
}

function blend(px, i, [r, g, b], a) {
  px[i * 3] += (r - px[i * 3]) * a
  px[i * 3 + 1] += (g - px[i * 3 + 1]) * a
  px[i * 3 + 2] += (b - px[i * 3 + 2]) * a
}

/** Fills polygons (pixel coordinates, y down) with the nonzero rule, anti-aliased. */
function fill(px, contours, hex, alpha = 1) {
  const colour = rgb(hex)
  const edges = []
  let top = Infinity
  let bottom = -Infinity
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const [x0, y0] = contour[i]
      const [x1, y1] = contour[(i + 1) % contour.length]
      top = Math.min(top, y0)
      bottom = Math.max(bottom, y0)
      if (y0 === y1) continue
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1])
    }
  }
  const cover = new Float32Array(WIDTH + 1)
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(HEIGHT, Math.ceil(bottom)); y++) {
    cover.fill(0)
    let lo = WIDTH
    let hi = 0
    for (let s = 0; s < SS; s++) {
      const sy = y + (s + 0.5) / SS
      const hits = []
      for (const [x0, y0, x1, y1, dir] of edges) {
        if (sy < y0 || sy >= y1) continue
        hits.push([x0 + ((sy - y0) * (x1 - x0)) / (y1 - y0), dir])
      }
      hits.sort((a, b) => a[0] - b[0])
      let winding = 0
      for (let h = 0; h < hits.length - 1; h++) {
        winding += hits[h][1]
        if (winding === 0) continue
        const a = Math.max(0, hits[h][0])
        const b = Math.min(WIDTH, hits[h + 1][0])
        for (let x = Math.floor(a); x < b; x++) {
          cover[x] += (Math.min(b, x + 1) - Math.max(a, x)) / SS
        }
        lo = Math.min(lo, Math.floor(a))
        hi = Math.max(hi, Math.ceil(b))
      }
    }
    for (let x = lo; x < hi; x++) {
      if (cover[x] > 0) blend(px, y * WIDTH + x, colour, Math.min(1, cover[x]) * alpha)
    }
  }
}

const rect = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]

function circle(cx, cy, r, steps = 96) {
  return [Array.from({ length: steps }, (_, i) => [cx + r * Math.cos((i / steps) * 2 * Math.PI), cy + r * Math.sin((i / steps) * 2 * Math.PI)])]
}

/** Outlines for each run, from outline.py, in font units with y up. */
function outlines(runs) {
  const python = process.env.PYTHON || 'python3'
  const out = execFileSync(python, ['-I', at('./fonts/outline.py'), JSON.stringify(runs)], {
    cwd: at('..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(out)
}

/** A run placed with its baseline's left end at (x, y), `size` px per em. */
function place(run, upem, x, y, size) {
  const k = size / upem
  return {
    width: run.advance * k,
    contours: run.contours.map((contour) => contour.map(([gx, gy]) => [x + gx * k, y - gy * k])),
  }
}

/** The layout: [text, weight, tracking (em), size (px), x, baseline y, colour]. */
const LEFT = 80
const TEXT_MAX = 690
const LINES = [
  ['THE SWISS KNIFE', 700, 0.08, 20, LEFT, 118, C.muted],
  ['ONE', 850, -0.055, 132, LEFT, 248, C.text],
  ['TOOLBOX', 850, -0.055, 132, LEFT, 367, C.text],
  ['Free developer tools that run entirely', 600, -0.01, 32, LEFT, 438, C.text],
  ['in your browser. Nothing you paste', 600, -0.01, 32, LEFT, 479, C.text],
  ['leaves your machine.', 600, -0.01, 32, LEFT, 520, C.text],
  ['theswissknife.com', 700, -0.01, 24, LEFT, 597, C.text],
]

export function draw() {
  const px = canvas()

  // The landing page's 40 px grid, fading out towards the bottom like its mask.
  const grid = rgb(C.border)
  for (let y = 0; y < HEIGHT; y++) {
    const a = 0.7 * Math.max(0, 1 - y / 600)
    if (a === 0) continue
    for (let x = 0; x < WIDTH; x++) {
      if (x % 40 === 0 || y % 40 === 0) blend(px, y * WIDTH + x, grid, a)
    }
  }
  // Footer rule, as on the landing page.
  fill(px, rect(0, 552, WIDTH, 1), C.border)

  // Text runs; "TOOLBOX." is laid out whole so the period sits where kerning puts it.
  const runs = [...LINES.map(([text, wght, tracking]) => ({ text, wght, tracking })), { text: 'TOOLBOX.', wght: 850, tracking: -0.055 }]
  const { upem, runs: shaped } = outlines(runs)
  LINES.forEach(([text, , , size, x, y, colour], i) => {
    const run = place(shaped[i], upem, x, y, size)
    if (run.width > TEXT_MAX) throw new Error(`gen-og: "${text}" is ${Math.round(run.width)} px, over the ${TEXT_MAX} px column`)
    fill(px, run.contours, colour)
  })
  const toolbox = shaped[LINES.findIndex(([text]) => text === 'TOOLBOX')]
  const withDot = shaped[LINES.length]
  const dot = place({ advance: 0, contours: withDot.contours.slice(toolbox.contours.length) }, upem, LEFT, 367, 132)
  fill(px, dot.contours, C.accent)

  // The mark on its tile: BladeMark's geometry via gen-icons.mjs, square corners.
  const TILE = 330
  const tx = 790
  const ty = 140
  fill(px, rect(tx, ty, TILE, TILE), C.text)
  const mark = scene(FULL, { span: 1, radius: 0 })
  const toPx = ([u, v]) => [tx + u * TILE, ty + v * TILE]
  fill(px, mark.blades.map((polygon) => polygon.map(toPx)), C.bg)
  const [cx, cy] = toPx(mark.pivot.centre)
  fill(px, circle(cx, cy, mark.pivot.radius * TILE), C.accent)

  const rgba = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    rgba[i * 4] = Math.round(px[i * 3])
    rgba[i * 4 + 1] = Math.round(px[i * 3 + 1])
    rgba[i * 4 + 2] = Math.round(px[i * 3 + 2])
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

const png = encodePng(WIDTH, draw(), HEIGHT)
writeFileSync(at('../public/og.png'), png)
console.log(`public/og.png ${WIDTH}×${HEIGHT}  ${(png.length / 1024).toFixed(1)} KiB`)
