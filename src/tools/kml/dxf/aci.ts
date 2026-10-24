/**
 * The AutoCAD Color Index. 10–249 follow a fixed pattern — 24 hues in 15°
 * steps, each at five brightnesses (255, 165, 127, 76, 38) in full and
 * half-saturated form — so the table is generated rather than pasted.
 */

import type { Rgb } from '../model'

const BRIGHTNESS = [255, 165, 127, 76, 38]

function build(): Rgb[] {
  const table: Rgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 255 },
    { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 255, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 }, { r: 192, g: 192, b: 192 },
  ]
  for (let h = 0; h < 24; h++) {
    const f = (h % 4) / 4
    const rise = Math.floor(255 * f), fall = Math.floor(255 * (1 - f))
    const hue = [
      [255, rise, 0], [fall, 255, 0], [0, 255, rise], [0, fall, 255], [rise, 0, 255], [255, 0, fall],
    ][Math.floor(h / 4)]
    for (const max of BRIGHTNESS) {
      const full = hue.map((c) => Math.round((c * max) / 255))
      const half = full.map((c) => Math.floor(c + (max - c) / 2))
      table.push({ r: full[0], g: full[1], b: full[2] }, { r: half[0], g: half[1], b: half[2] })
    }
  }
  for (const v of [51, 91, 132, 173, 214, 255]) table.push({ r: v, g: v, b: v })
  return table
}

export const ACI: readonly Rgb[] = build()

/** Nearest colour index (1–255). Black and white map to 7, which CAD draws in the contrasting one. */
export function nearestAci(rgb: Rgb): number {
  const { r, g, b } = rgb
  if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) return 7
  let best = 7, bestDistance = Infinity
  for (let i = 1; i < 256; i++) {
    const c = ACI[i]
    // Weighted RGB distance ("redmean"), closer to what the eye sees than plain RGB.
    const mean = (r + c.r) / 2
    const dr = r - c.r, dg = g - c.g, db = b - c.b
    const d = (2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db
    if (d < bestDistance) { bestDistance = d; best = i }
    if (d === 0) break
  }
  return best
}

export function aciToRgb(index: number): Rgb | null {
  const i = Math.abs(index)
  return i >= 1 && i <= 255 ? ACI[i] : null
}
