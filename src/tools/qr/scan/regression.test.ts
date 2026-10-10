import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { encodeQr } from '../render'
import { decodeZxing, type Found, type Pixels } from './engine'
import manifest from './fixtures/manifest.json'
import { shoot, shootMany, type Shot } from './synth'
import { readCodes, readFixture } from './testing'

// WeChat's first call loads ~6 MB of wasm and models.
const SLOW = 60_000

const centre = (f: Found) => ({ x: f.corners.reduce((s, p) => s + p.x, 0) / 4, y: f.corners.reduce((s, p) => s + p.y, 0) / 4 })

function inside({ x, y }: { x: number; y: number }, poly: number[][]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

function decodeJpeg(name: string): Pixels {
  const { data, width, height } = jpeg.decode(readFixture(name), { useTArray: true, formatAsRGBA: true })
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height }
}

// Real phone photos from BoofCV's QR benchmark — see fixtures/README.md.
describe('benchmark photos', () => {
  for (const fx of manifest) {
    it(`${fx.file}: ${fx.why}`, async () => {
      const pixels = decodeJpeg(fx.file)
      const { engine, found, edge } = await readCodes(pixels)
      expect(found.map((f) => f.text).sort()).toEqual(fx.texts)
      // The primary decoder must keep reading what it reads today, not quietly
      // hand it to the slower fallback.
      if (fx.engine === 'zxing') expect(engine).toBe('zxing')
      // These are read only by WeChat's smaller-copy retry; full size misses them.
      if ('retry' in fx) expect(edge).toBeLessThan(Math.max(pixels.width, pixels.height))
      // Every outline lands on a different hand-labelled code.
      const used = new Set<number>()
      for (const f of found) {
        const i = fx.codes.findIndex((poly, k) => !used.has(k) && inside(centre(f), poly))
        expect(i, `outline for "${f.text.slice(0, 30)}" is not on a labelled code`).toBeGreaterThanOrEqual(0)
        used.add(i)
      }
    }, SLOW)
  }
})

const TEXT = 'https://theswissknife.com/qr?case=regression'
const square = (x: number, y: number, s: number): Shot['quad'] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
const turned = (cx: number, cy: number, s: number, deg: number): Shot['quad'] => {
  const a = (deg * Math.PI) / 180
  const h = s / 2
  return ([[-h, -h], [h, -h], [h, h], [-h, h]] as const).map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]) as Shot['quad']
}
const scene = { width: 480, height: 480, noise: 4 }

// Each case sits one step inside the severity where the decoders give up
// (calibrated when they were written), so a regression shows up here first.
const CASES: [string, Shot][] = [
  ['keystone perspective (top edge at half width)', { ...scene, quad: [[165, 60], [315, 80], [400, 420], [80, 400]] }],
  ['rotated 37° and blurred', { ...scene, quad: turned(240, 240, 300, 37), blur: 4 }],
  ['wrapped round a cylinder', { ...scene, quad: square(90, 90, 300), curve: 0.5 }],
  ['glare over the middle', { ...scene, quad: square(90, 90, 300), ecc: 'H', glare: { u: 0.55, v: 0.45, r: 0.22, gain: 450 } }],
  ['a 30% patch scraped off (ECC H)', { ...scene, quad: square(90, 90, 300), ecc: 'H', scrape: { u: 0.35, v: 0.35, w: 0.3, h: 0.3 } }],
  ['2 px per module in a large noisy frame', { width: 900, height: 700, noise: 6, quad: square(300, 250, 74) }],
  // Beyond ZXing: these pass only because the WeChat fallback runs.
  ['ink and paper 20 grey levels apart, with noise', { ...scene, quad: square(90, 90, 300), dark: 118, light: 138, noise: 8 }],
  ['1.6 px per module', { width: 900, height: 700, noise: 6, quad: square(300, 250, 59) }],
]

describe('synthetic hard shots', () => {
  for (const [name, shot] of CASES) {
    it(name, async () => {
      const { found } = await readCodes(shoot(TEXT, shot))
      expect(found.map((f) => f.text)).toContain(TEXT)
    }, SLOW)
  }

  it('the last two really are beyond ZXing, so the fallback is what reads them', async () => {
    for (const [, shot] of CASES.slice(-2)) expect(await decodeZxing(shoot(TEXT, shot))).toEqual([])
  }, SLOW)

  it('reads all nine codes in a 3×3 grid of differently turned codes', async () => {
    const texts = Array.from({ length: 9 }, (_, i) => `code ${i + 1}`)
    const codes = texts.map((text, i) => ({
      text,
      code: encodeQr(text, { ecc: 'M', minVersion: 1, maskPattern: -1, boostEcc: false }).code!.matrix,
      shot: { ...scene, quad: turned(110 + (i % 3) * 230, 110 + Math.floor(i / 3) * 230, 170, i * 23 - 90) },
    }))
    const { engine, found } = await readCodes(shootMany(codes, { width: 700, height: 700, noise: 4, quad: square(0, 0, 700) }))
    expect(engine).toBe('zxing')
    expect(found.map((f) => f.text).sort()).toEqual(texts)
  }, SLOW)
})
