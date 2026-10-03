import { encode } from 'uqr'

/**
 * QR encoding (via uqr) plus our own drawing. The matrix is turned into SVG
 * path data once; the same strings feed the SVG export and — through
 * `Path2D` — the canvas, so the PNG and the SVG can never disagree.
 */

export type Ecc = 'L' | 'M' | 'Q' | 'H'
export type ModuleStyle = 'square' | 'rounded' | 'dots'
export type EyeStyle = 'square' | 'rounded' | 'circle'

export const ECC_LEVELS: { id: Ecc; label: string; recovery: number }[] = [
  { id: 'L', label: 'L 7%', recovery: 0.07 },
  { id: 'M', label: 'M 15%', recovery: 0.15 },
  { id: 'Q', label: 'Q 25%', recovery: 0.25 },
  { id: 'H', label: 'H 30%', recovery: 0.30 },
]

/** Byte-mode capacity of a version-40 symbol — the absolute ceiling per level. */
export const MAX_BYTES: Record<Ecc, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 }

export interface EncodeOptions {
  ecc: Ecc
  /** 1–40; forces at least this symbol size. */
  minVersion: number
  /** -1 picks the mask with the lowest penalty (the spec's way). */
  maskPattern: number
  /** Raise ECC as far as it goes without growing the symbol. */
  boostEcc: boolean
}

export interface QrCode {
  version: number
  size: number
  mask: number
  /** The level actually encoded — differs from the request when boosted. */
  ecc: Ecc
  matrix: boolean[][]
}

export interface EncodeResult {
  code?: QrCode
  error?: string
}

const ORDER: Ecc[] = ['L', 'M', 'Q', 'H']

export function encodeQr(payload: string, opts: EncodeOptions): EncodeResult {
  if (!payload) return { error: 'Nothing to encode' }
  const run = (ecc: Ecc, min: number, max = 40) => encode(payload, {
    ecc, minVersion: min, maxVersion: max, maskPattern: opts.maskPattern, border: 0,
  })
  let result
  try {
    result = run(opts.ecc, clamp(Math.round(opts.minVersion), 1, 40))
  } catch {
    const bytes = utf8Length(payload)
    return { error: `Too much data: ${bytes.toLocaleString()} bytes is over the ${MAX_BYTES[opts.ecc].toLocaleString()}-byte limit at ECC ${opts.ecc}${opts.ecc !== 'L' ? ' — try a lower level' : ''}` }
  }
  let ecc = opts.ecc
  if (opts.boostEcc) {
    for (const level of ORDER.slice(ORDER.indexOf(opts.ecc) + 1)) {
      try {
        result = run(level, result.version, result.version)
        ecc = level
      } catch {
        break
      }
    }
  }
  return { code: { version: result.version, size: result.size, mask: result.maskPattern, ecc, matrix: result.data } }
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Mirrors uqr's single-segment mode choice so the stats tell the truth. */
export function dataMode(text: string): 'Numeric' | 'Alphanumeric' | 'Byte' {
  if (/^\d*$/.test(text)) return 'Numeric'
  if (/^[A-Z0-9 $%*+./:-]*$/.test(text)) return 'Alphanumeric'
  return 'Byte'
}

// ---- drawing -------------------------------------------------------------

export interface Style {
  margin: number
  moduleStyle: ModuleStyle
  eyeStyle: EyeStyle
  fg: string
  bg: string
  /** Empty means "same as fg". */
  eyeColor: string
  transparent: boolean
}

export interface Logo {
  src: string
  width: number
  height: number
  /** The decoded image, for canvas drawing. */
  img: HTMLImageElement
}

export interface LogoOptions {
  /** Logo box side as a fraction of the symbol (without the quiet zone). */
  scale: number
  /** Clear modules behind the logo and draw a background plate. */
  plate: boolean
}

export interface Drawing {
  /** Width/height in modules, quiet zone included. */
  dim: number
  modules: string
  eyes: string
  logoBox?: Box
  plateBox?: Box
}

interface Box { x: number; y: number; w: number; h: number }

const n = (v: number) => +v.toFixed(3)

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`
  return `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}v${n(h - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}`
    + `h${n(2 * r - w)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}v${n(2 * r - h)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}z`
}

/** True for cells inside one of the three 7×7 finder patterns. */
export function isFinder(row: number, col: number, size: number): boolean {
  const top = row < 7
  const left = col < 7
  return (top && left) || (top && col >= size - 7) || (left && row >= size - 7)
}

function eyePath(x: number, y: number, style: EyeStyle): string {
  const [outer, hole, inner] = style === 'circle' ? [3.5, 2.5, 1.5] : style === 'rounded' ? [2, 1.4, 1] : [0, 0, 0]
  // evenodd: the 5×5 hole punches the ring out of the 7×7 square.
  return roundedRect(x, y, 7, 7, outer) + roundedRect(x + 1, y + 1, 5, 5, hole) + roundedRect(x + 2, y + 2, 3, 3, inner)
}

function moduleShape(style: ModuleStyle, x: number, y: number, at: (dr: number, dc: number) => boolean): string {
  if (style === 'dots') {
    const r = 0.42
    return `M${n(x + 0.5 - r)} ${n(y + 0.5)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`
  }
  // rounded: a corner rounds only when both of its edges are exposed,
  // so runs of modules stay joined and only the outline gets soft.
  const up = at(-1, 0), down = at(1, 0), left = at(0, -1), right = at(0, 1)
  const R = 0.5
  const tl = !up && !left ? R : 0
  const tr = !up && !right ? R : 0
  const br = !down && !right ? R : 0
  const bl = !down && !left ? R : 0
  let d = `M${x + tl} ${y}H${x + 1 - tr}`
  if (tr) d += `a${R} ${R} 0 0 1 ${R} ${R}`
  d += `V${y + 1 - br}`
  if (br) d += `a${R} ${R} 0 0 1 ${-R} ${R}`
  d += `H${x + bl}`
  if (bl) d += `a${R} ${R} 0 0 1 ${-R} ${-R}`
  d += `V${y + tl}`
  if (tl) d += `a${R} ${R} 0 0 1 ${R} ${-R}`
  return `${d}z`
}

export function drawQr(code: QrCode, style: Style, logo?: Logo | null, logoOpts?: LogoOptions): Drawing {
  const { size, matrix } = code
  const m = Math.max(0, Math.round(style.margin))
  const dim = size + 2 * m

  let logoBox: Box | undefined
  let plateBox: Box | undefined
  let clear: Box | undefined
  if (logo && logoOpts) {
    const side = size * clamp(logoOpts.scale, 0.05, 0.4)
    const aspect = logo.width / logo.height || 1
    const w = aspect >= 1 ? side : side * aspect
    const h = aspect >= 1 ? side / aspect : side
    logoBox = { x: m + (size - w) / 2, y: m + (size - h) / 2, w, h }
    if (logoOpts.plate) {
      const pad = 0.6
      plateBox = { x: logoBox.x - pad, y: logoBox.y - pad, w: w + 2 * pad, h: h + 2 * pad }
      clear = plateBox
    }
  }

  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && matrix[r][c]
    && !isFinder(r, c, size) && !(clear && overlaps(clear, c + m, r + m))

  let modules = ''
  for (let r = 0; r < size; r++) {
    if (style.moduleStyle === 'square') {
      // Merge horizontal runs: a version-40 code drops from ~15k rects to ~4k.
      let c = 0
      while (c < size) {
        if (!dark(r, c)) { c++; continue }
        const start = c
        while (c < size && dark(r, c)) c++
        modules += `M${start + m} ${r + m}h${c - start}v1h${start - c}z`
      }
    } else {
      for (let c = 0; c < size; c++) {
        if (dark(r, c)) modules += moduleShape(style.moduleStyle, c + m, r + m, (dr, dc) => dark(r + dr, c + dc))
      }
    }
  }

  const eyes = eyePath(m, m, style.eyeStyle) + eyePath(m + size - 7, m, style.eyeStyle) + eyePath(m, m + size - 7, style.eyeStyle)
  return { dim, modules, eyes, logoBox, plateBox }
}

function overlaps(b: Box, x: number, y: number): boolean {
  return x + 1 > b.x && x < b.x + b.w && y + 1 > b.y && y < b.y + b.h
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function toSvg(d: Drawing, style: Style, px: number, logo?: Logo | null): string {
  const eye = style.eyeColor || style.fg
  const crisp = style.moduleStyle === 'square' && style.eyeStyle === 'square' ? ' shape-rendering="crispEdges"' : ''
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.dim} ${d.dim}" width="${px}" height="${px}"${crisp}>`,
    style.transparent ? '' : `<rect width="${d.dim}" height="${d.dim}" fill="${esc(style.bg)}"/>`,
    d.modules ? `<path d="${d.modules}" fill="${esc(style.fg)}"/>` : '',
    `<path d="${d.eyes}" fill="${esc(eye)}" fill-rule="evenodd"/>`,
  ]
  if (d.plateBox) {
    const p = d.plateBox
    parts.push(`<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" rx="0.6" fill="${esc(style.bg)}"/>`)
  }
  if (logo && d.logoBox) {
    const b = d.logoBox
    parts.push(`<image href="${esc(logo.src)}" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" preserveAspectRatio="xMidYMid meet"/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

export function drawCanvas(canvas: HTMLCanvasElement, d: Drawing, style: Style, px: number, logo?: Logo | null): void {
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, px, px)
  ctx.save()
  ctx.scale(px / d.dim, px / d.dim)
  if (!style.transparent) {
    ctx.fillStyle = style.bg
    ctx.fillRect(0, 0, d.dim, d.dim)
  }
  ctx.fillStyle = style.fg
  if (d.modules) ctx.fill(new Path2D(d.modules))
  ctx.fillStyle = style.eyeColor || style.fg
  ctx.fill(new Path2D(d.eyes), 'evenodd')
  if (d.plateBox) {
    const p = d.plateBox
    ctx.fillStyle = style.bg
    ctx.fill(new Path2D(roundedRect(p.x, p.y, p.w, p.h, 0.6)))
  }
  if (logo && d.logoBox) {
    const b = d.logoBox
    ctx.drawImage(logo.img, b.x, b.y, b.w, b.h)
  }
  ctx.restore()
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode image')), type, quality)
  })
}

// ---- colour checks -------------------------------------------------------

function luminance(hex: string): number {
  const v = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1]
  if (!v) return 0
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Scanner-facing warnings about the colours, most serious first. */
export function colorWarnings(style: Style): string[] {
  const out: string[] = []
  if (style.transparent) {
    out.push('Transparent background — make sure whatever it sits on is much lighter than the modules')
    return out
  }
  const ratio = contrastRatio(style.fg, style.bg)
  if (ratio < 3) out.push(`Low contrast (${ratio.toFixed(1)}:1) — many scanners need at least 3:1, ideally 7:1`)
  if (luminance(style.fg) > luminance(style.bg)) out.push('Light modules on a dark background — some older scanners only read dark-on-light')
  const eye = style.eyeColor || style.fg
  if (eye !== style.fg && contrastRatio(eye, style.bg) < 3) out.push('The corner eyes blend into the background — scanners locate the code by them')
  return out
}

/** Rough guide: covering more than ~half of what the ECC can recover is risky. */
export function logoRisk(scale: number, ecc: Ecc): 'ok' | 'tight' | 'risky' {
  const area = scale * scale
  const budget = ECC_LEVELS.find((l) => l.id === ecc)!.recovery
  if (area > budget * 0.75) return 'risky'
  if (area > budget * 0.5) return 'tight'
  return 'ok'
}
