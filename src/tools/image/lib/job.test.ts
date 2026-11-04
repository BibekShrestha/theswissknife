import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_CROP, type CropSpec } from './crop'
import { DEFAULT_RESIZE, type ResizeSpec } from './dimensions'
import { runJob, type JobOptions } from './job'

/**
 * A stand-in OffscreenCanvas that records every draw, so the crop can be
 * checked where it matters: the source rectangle handed to drawImage.
 */
interface Draw {
  from: number[]
  to: number[]
}
let draws: Draw[] = []

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      fillStyle: '',
      fillRect() {},
      drawImage(source: { width: number; height: number }, ...args: number[]) {
        draws.push(
          args.length === 8
            ? { from: args.slice(0, 4), to: args.slice(4) }
            : { from: [0, 0, source.width, source.height], to: args },
        )
      },
    }
  }
  async convertToBlob({ type }: { type: string }) {
    return new Blob([new Uint8Array(this.width * this.height % 997 + 1)], { type })
  }
}

const original = globalThis.OffscreenCanvas
beforeEach(() => {
  draws = []
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas
})
afterEach(() => {
  ;(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = original
})

const bitmap = { width: 4000, height: 3000 } as ImageBitmap
const options = (crop: CropSpec, resize: Partial<ResizeSpec> = {}): JobOptions => ({
  format: 'png',
  crop,
  resize: { ...DEFAULT_RESIZE, ...resize },
  quality: 0.8,
  targetBytes: null,
  matte: null,
  gif: { maxColors: 256, dither: false },
})

describe('runJob crop', () => {
  it('draws the whole bitmap and reports no crop by default', async () => {
    const out = await runJob(bitmap, options(NO_CROP))
    expect(out.crop).toBeNull()
    expect([out.width, out.height]).toEqual([4000, 3000])
    expect(draws).toEqual([{ from: [0, 0, 4000, 3000], to: [0, 0, 4000, 3000] }])
  })

  it('cuts the crop out in the first draw and outputs its size', async () => {
    const rect = { x: 100, y: 200, width: 1200, height: 900 }
    const out = await runJob(bitmap, options({ aspect: 'free', entry: { rect, ref: bitmap } }))
    expect(out.crop).toEqual(rect)
    expect([out.sourceWidth, out.sourceHeight]).toEqual([4000, 3000])
    expect([out.width, out.height]).toEqual([1200, 900])
    expect(draws).toEqual([{ from: [100, 200, 1200, 900], to: [0, 0, 1200, 900] }])
  })

  it('resizes the kept area, not the original, and only crops once', async () => {
    const rect = { x: 0, y: 0, width: 2000, height: 2000 }
    const out = await runJob(
      bitmap,
      options({ aspect: '1:1', entry: { rect, ref: bitmap } }, { mode: 'exact', width: 250, height: null }),
    )
    expect([out.width, out.height]).toEqual([250, 250])
    expect(out.upscaled).toBe(false)
    // 2000 → 1000 → 500 halvings, then the final draw; only the first has a source rect
    expect(draws[0]).toEqual({ from: [0, 0, 2000, 2000], to: [0, 0, 1000, 1000] })
    expect(draws.slice(1).map((d) => d.from.slice(0, 2))).toEqual([
      [0, 0],
      [0, 0],
    ])
    expect(draws.at(-1)!.to).toEqual([0, 0, 250, 250])
  })

  it('gives an untouched file the centred box of the ratio', async () => {
    const out = await runJob(bitmap, options({ aspect: '1:1', entry: null }))
    expect(out.crop).toEqual({ x: 500, y: 0, width: 3000, height: 3000 })
  })

  it('flags enlarging past the crop as upscaling', async () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 }
    const out = await runJob(
      bitmap,
      options({ aspect: 'free', entry: { rect, ref: bitmap } }, { mode: 'percent', percent: 200 }),
    )
    expect([out.width, out.height]).toEqual([200, 200])
    expect(out.upscaled).toBe(true)
  })
})
