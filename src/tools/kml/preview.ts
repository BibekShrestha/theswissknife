/**
 * A light outline of the drawing for the page: coordinates fitted into a
 * 1000-unit box (y up), vertices closer than half a unit to the last kept one
 * dropped, one SVG path per colour. Capped, so a huge drawing still renders.
 */

import type { Feature, Rgb } from './model'

export interface Preview {
  width: number
  height: number
  paths: { color: string; d: string; kind: 'line' | 'fill' | 'point' }[]
  /** True when the cap was reached and the outline is incomplete. */
  partial: boolean
}

const SIZE = 1000
const CAP = 250_000

const hex = (c: Rgb | null) => (c ? `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : '')

export function buildPreview(features: Feature[]): Preview {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const grow = (c: number[]) => {
    for (let i = 0; i < c.length; i += 3) {
      if (c[i] < minX) minX = c[i]
      if (c[i] > maxX) maxX = c[i]
      if (c[i + 1] < minY) minY = c[i + 1]
      if (c[i + 1] > maxY) maxY = c[i + 1]
    }
  }
  for (const f of features) {
    const g = f.geometry
    if (g.type === 'point' || g.type === 'text') grow(g.at)
    else if (g.type === 'line') grow(g.coords)
    else g.rings.forEach(grow)
  }
  if (!(maxX >= minX)) return { width: SIZE, height: SIZE, paths: [], partial: false }
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const k = SIZE / span
  const width = Math.max(1, Math.round((maxX - minX) * k)) || SIZE
  const height = Math.max(1, Math.round((maxY - minY) * k)) || SIZE
  const sx = (x: number) => Math.round((x - minX) * k * 10) / 10
  const sy = (y: number) => Math.round((maxY - y) * k * 10) / 10

  const parts = new Map<string, string[]>()
  let budget = CAP
  let partial = false
  const push = (key: string, d: string) => {
    let list = parts.get(key)
    if (!list) parts.set(key, (list = []))
    list.push(d)
  }
  const path = (c: number[], close: boolean) => {
    let d = ''
    let lx = NaN, ly = NaN
    for (let i = 0; i < c.length; i += 3) {
      const x = sx(c[i]), y = sy(c[i + 1])
      if (i && i < c.length - 3 && Math.abs(x - lx) < 0.5 && Math.abs(y - ly) < 0.5) continue
      d += `${i ? 'L' : 'M'}${x} ${y}`
      lx = x; ly = y
      budget--
    }
    return close ? `${d}Z` : d
  }

  for (const f of features) {
    if (budget <= 0) { partial = true; break }
    const g = f.geometry
    const color = hex(f.color)
    switch (g.type) {
      case 'point':
      case 'text':
        push(`point|${color}`, `M${sx(g.at[0])} ${sy(g.at[1])}h0`)
        budget--
        break
      case 'line':
        push(`line|${color}`, path(g.coords, g.closed))
        break
      case 'polygon':
        push(`fill|${color}`, g.rings.map((r) => path(r, true)).join(''))
        break
    }
  }
  return {
    width,
    height,
    paths: [...parts.entries()].map(([key, list]) => {
      const [kind, color] = key.split('|')
      return { kind: kind as Preview['paths'][number]['kind'], color, d: list.join('') }
    }),
    partial,
  }
}
