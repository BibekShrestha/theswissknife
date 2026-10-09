/**
 * Test-only: draws a real QR code the way a bad photo would show it —
 * warped (perspective, rotation, a curved surface), then degraded (contrast,
 * glare, blur, sensor noise, damage). Deterministic: noise is seeded.
 */

import { encodeQr, type Ecc } from '../render'
import type { Pixels } from './engine'

type Pt = [number, number]

export interface Shot {
  /** Output size in pixels. */
  width: number
  height: number
  /** Where the code's four corners (quiet zone included) land, clockwise from top-left. */
  quad: [Pt, Pt, Pt, Pt]
  ecc?: Ecc
  /** Bends the code round a vertical cylinder: 0 flat, 1 a half-turn across the code. */
  curve?: number
  /** Ink and paper grey levels (0–255). */
  dark?: number
  light?: number
  /** A bright highlight: centre in the code's unit square, radius and strength. */
  glare?: { u: number; v: number; r: number; gain: number }
  /** A rectangle of the code (unit square) scraped back to paper. */
  scrape?: { u: number; v: number; w: number; h: number }
  blur?: number
  noise?: number
  seed?: number
}

/** Square → quad homography; inverting it maps each output pixel back onto the code. */
function homography([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]: Shot['quad']): number[] {
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / det
  const h = (dx1 * sy - sx * dy1) / det
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

function invert(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det)
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const pass = (s: Float32Array, len: number, lines: number, step: number, lineStep: number) => {
    const out = new Float32Array(s.length)
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => s[line * lineStep + Math.min(len - 1, Math.max(0, i)) * step]
      let sum = 0
      for (let i = -r; i <= r; i++) sum += at(i)
      for (let i = 0; i < len; i++) {
        out[line * lineStep + i * step] = sum / (2 * r + 1)
        sum += at(i + r + 1) - at(i - r)
      }
    }
    return out
  }
  return pass(pass(src, w, h, 1, w), h, w, w, 1)
}

/** Grey background with the code drawn in; returns RGBA pixels. */
export function shoot(text: string, shot: Shot): Pixels {
  const { code } = encodeQr(text, { ecc: shot.ecc ?? 'M', minVersion: 1, maskPattern: -1, boostEcc: false })
  if (!code) throw new Error(`cannot encode ${text}`)
  return shootMany([{ text, code: code.matrix, shot }], shot)
}

/** Several codes in one picture (each with its own quad); scene settings come from `scene`. */
export function shootMany(codes: { text: string; code: boolean[][]; shot: Shot }[], scene: Shot): Pixels {
  const { width, height } = scene
  const dark = scene.dark ?? 20
  const light = scene.light ?? 235
  const grey = new Float32Array(width * height).fill((dark + light) / 2 + 10)
  for (const { code, shot } of codes) {
    const inv = invert(homography(shot.quad))
    const n = code.length + 8
    // 2×2 supersampling so module edges are anti-aliased like a real camera's.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0, hits = 0
        for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const X = x + ox, Y = y + oy
          const wq = inv[6] * X + inv[7] * Y + inv[8]
          let u = (inv[0] * X + inv[1] * Y + inv[2]) / wq
          const v = (inv[3] * X + inv[4] * Y + inv[5]) / wq
          if (u < 0 || u > 1 || v < 0 || v > 1) continue
          // A cylinder seen head-on: equal steps on the page squeeze towards its edges.
          if (shot.curve) u = 0.5 + Math.asin((u - 0.5) * 2 * Math.sin((shot.curve * Math.PI) / 2)) / (shot.curve * Math.PI)
          const s = shot.scrape
          const scraped = s && u >= s.u && u <= s.u + s.w && v >= s.v && v <= s.v + s.h
          const col = Math.floor(u * n) - 4, row = Math.floor(v * n) - 4
          acc += !scraped && code[row]?.[col] ? dark : light
          hits++
        }
        if (hits) grey[y * width + x] = (grey[y * width + x] * (4 - hits) + acc) / 4
      }
    }
  }
  if (scene.glare) {
    const { u, v, r, gain } = scene.glare
    const H = homography(scene.quad)
    const wq = H[6] * u + H[7] * v + H[8]
    const cx = (H[0] * u + H[1] * v + H[2]) / wq
    const cy = (H[3] * u + H[4] * v + H[5]) / wq
    const rad = r * Math.hypot(scene.quad[1][0] - scene.quad[0][0], scene.quad[1][1] - scene.quad[0][1])
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (rad * rad)
        grey[y * width + x] += gain * Math.exp(-d2)
      }
    }
  }
  const soft = scene.blur ? boxBlur(grey, width, height, scene.blur) : grey
  const rand = mulberry32(scene.seed ?? 1)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < soft.length; i++) {
    // Box–Muller gives the bell-shaped noise of a sensor at high ISO.
    const n = scene.noise ? scene.noise * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()) : 0
    const g = soft[i] + n
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}
