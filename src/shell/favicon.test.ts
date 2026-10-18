import { describe, expect, it } from 'vitest'
import bladeMark from './BladeMark.tsx?raw'
// @ts-expect-error — a plain .mjs script, run by `npm run icons`
import { FAVICON, FULL, dataUrl, faviconSvg } from '../../scripts/gen-icons.mjs'

const html = Object.values(import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true }))[0]

const REGENERATE = 'run `npm run icons` and commit public/icons/ and index.html'

describe('site icons', () => {
  it('draw the same blades as BladeMark.tsx', () => {
    // Each <path> in the component is a triangle, optionally rotated about the pivot.
    const blades = [...bladeMark.matchAll(/<path d="M([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)l([\d.]+) ([\d.]+)Z"(?: transform="rotate\((-?[\d.]+) [\d.]+ [\d.]+\)")?/g)].map(
      ([, x1, y1, x2, y2, dx, dy, rotate]) => {
        const [a, b] = [+x2, +y2]
        return { points: [[+x1, +y1], [a, b], [a + +dx, b + +dy]], rotate: rotate ? +rotate : 0 }
      },
    )
    expect(blades).toHaveLength(3)
    expect(FULL.blades.map((b: { points: number[][]; rotate: number }) => ({ ...b, points: b.points.map((p) => p.map((v) => +v.toFixed(2))) }))).toEqual(
      blades.map((b) => ({ ...b, points: b.points.map((p) => p.map((v) => +v.toFixed(2))) })),
    )
    const pivot = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(bladeMark)
    expect([FULL.pivot[0], FULL.pivot[1], FULL.radius], `BladeMark.tsx changed — update FULL in scripts/gen-icons.mjs, then ${REGENERATE}`).toEqual(
      pivot!.slice(1).map(Number),
    )
  })

  it('put the generated favicon in index.html', () => {
    expect(html, REGENERATE).toContain(`href="${dataUrl(faviconSvg(FAVICON))}"`)
  })
})
