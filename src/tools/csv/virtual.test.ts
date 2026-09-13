import { describe, expect, it } from 'vitest'
import { columnOffsets, columnWindow, rowWindow } from './virtual'

describe('rowWindow', () => {
  it('covers the visible band plus an overscan on each side', () => {
    const { first, last } = rowWindow(1000, 300, 30, 100_000, 5)
    expect(first).toBe(Math.floor(1000 / 30) - 5)
    expect(last).toBe(Math.ceil(1300 / 30) + 5)
  })

  it('never runs past either end', () => {
    expect(rowWindow(0, 300, 30, 4)).toEqual({ first: 0, last: 4 })
    expect(rowWindow(-50, 300, 30, 4).first).toBe(0)
  })

  /** A million rows must not mean a million nodes. */
  it('renders a constant number of rows however tall the file is', () => {
    const small = rowWindow(0, 600, 30, 1_000)
    const huge = rowWindow(0, 600, 30, 1_000_000)
    expect(huge.last - huge.first).toBe(small.last - small.first)
  })

  it('says nothing is visible when there is nothing', () => {
    expect(rowWindow(0, 300, 30, 0)).toEqual({ first: 0, last: 0 })
  })
})

describe('columnOffsets', () => {
  it('is a prefix sum one longer than the widths', () => {
    expect(columnOffsets([100, 50, 25])).toEqual([0, 100, 150, 175])
    expect(columnOffsets([])).toEqual([0])
  })
})

describe('columnWindow', () => {
  const widths = Array.from({ length: 200 }, (_, i) => 50 + (i % 5) * 20)
  const offsets = columnOffsets(widths)

  it('finds the columns a scroll position puts on screen', () => {
    const { first, last } = columnWindow(offsets, 0, 300, 0)
    expect(first).toBe(0)
    expect(offsets[last]).toBeGreaterThanOrEqual(300)
    expect(offsets[last - 1]).toBeLessThan(300)
  })

  it('covers the whole viewport after scrolling right', () => {
    const scrollLeft = offsets[120] + 10
    const { first, last } = columnWindow(offsets, scrollLeft, 400, 0)
    expect(first).toBeLessThanOrEqual(120)
    expect(offsets[last]).toBeGreaterThanOrEqual(scrollLeft + 400)
  })

  /** Wide files are as common as tall ones; both axes have to window. */
  it('renders a handful of columns out of two hundred', () => {
    const { first, last } = columnWindow(offsets, 0, 800)
    expect(last - first).toBeLessThan(30)
  })

  it('clamps at both edges', () => {
    expect(columnWindow(offsets, -100, 200).first).toBe(0)
    expect(columnWindow(offsets, 1e9, 800).last).toBe(widths.length)
    expect(columnWindow([0], 0, 500)).toEqual({ first: 0, last: 0 })
  })
})
