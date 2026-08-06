import { describe, expect, it } from 'vitest'
import { searchForTarget, type SearchParams } from './target'

/**
 * Stands in for a real encoder: bytes fall with area and with quality, which
 * is how JPEG and WebP behave closely enough to test the strategy.
 */
function model(fullSize: number) {
  const calls: SearchParams[] = []
  const encode = async ({ quality, scale }: SearchParams) => {
    calls.push({ quality, scale })
    return { size: Math.round(fullSize * scale * scale * (0.2 + 0.8 * quality)) }
  }
  return { encode, calls }
}

const KB = 1024

describe('searchForTarget', () => {
  it('stops after one encode when the requested quality already fits', async () => {
    const { encode, calls } = model(50 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 100 * KB,
      searchQuality: true,
      quality: 0.9,
    })

    expect(out.met).toBe(true)
    expect(out.attempts).toBe(1)
    expect(calls).toEqual([{ quality: 0.9, scale: 1 }])
    expect(out.params).toEqual({ quality: 0.9, scale: 1 })
  })

  it('trades quality before pixels', async () => {
    const { encode } = model(1000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 500 * KB,
      searchQuality: true,
      quality: 0.92,
    })

    expect(out.met).toBe(true)
    expect(out.best.size).toBeLessThanOrEqual(500 * KB)
    expect(out.params.scale).toBe(1) // full resolution kept
    expect(out.params.quality).toBeGreaterThan(0.3)
    expect(out.params.quality).toBeLessThan(0.92)
  })

  it('keeps the largest result that still fits, not the first one it finds', async () => {
    const { encode } = model(1000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 400 * KB,
      searchQuality: true,
      quality: 1,
    })

    expect(out.best.size).toBeLessThanOrEqual(400 * KB)
    // within 15% of the target: it is not settling for something tiny
    expect(out.best.size).toBeGreaterThan(0.85 * 400 * KB)
  })

  it('scales down once the quality floor is not enough', async () => {
    const { encode } = model(4000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 200 * KB,
      searchQuality: true,
      quality: 0.9,
    })

    expect(out.met).toBe(true)
    expect(out.best.size).toBeLessThanOrEqual(200 * KB)
    expect(out.params.scale).toBeLessThan(1)
    expect(out.attempts).toBeLessThanOrEqual(12)
  })

  it('moves only the scale for formats without a quality dial', async () => {
    const { encode, calls } = model(4000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 500 * KB,
      searchQuality: false,
      quality: 1,
    })

    expect(out.met).toBe(true)
    expect(out.best.size).toBeLessThanOrEqual(500 * KB)
    expect(calls.every((c) => c.quality === 1)).toBe(true)
    expect(out.params.scale).toBeLessThan(1)
  })

  it('reports an unreachable target and hands back the smallest attempt', async () => {
    const { encode } = model(10_000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 1 * KB,
      searchQuality: true,
      quality: 0.9,
      minScale: 0.25,
    })

    expect(out.met).toBe(false)
    expect(out.best.size).toBeGreaterThan(1 * KB)
    expect(out.params.scale).toBeGreaterThanOrEqual(0.25)
    // the smallest thing it produced, so the UI can still offer a download
    expect(out.best.size).toBeLessThan(10_000 * KB)
  })

  it('never encodes the same parameters twice', async () => {
    const { encode, calls } = model(3000 * KB)
    const out = await searchForTarget(encode, {
      targetBytes: 150 * KB,
      searchQuality: true,
      quality: 0.85,
    })

    const keys = calls.map((c) => `${c.quality}@${c.scale}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(calls.length).toBe(out.attempts)
  })
})
