/**
 * Windowing maths for the grid. A CSV viewer has to survive a file with a
 * million rows and two hundred columns, which means painting only what is in
 * front of the reader — in both axes, since wide files are as common as tall
 * ones.
 */

/** Uniform row heights, so the visible band is arithmetic. */
export function rowWindow(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): { first: number; last: number } {
  if (count === 0 || rowHeight <= 0) return { first: 0, last: 0 }
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  return { first, last: Math.max(first, last) }
}

/**
 * Browsers cap an element's height — Firefox near 17.9 million px, Chrome and
 * Safari near 33.5 million — and silently clip anything taller, so 29 px rows
 * run out a little past half a million. The body is never made taller than
 * this; past it, the scrollbar is scaled (see toVirtualTop).
 */
export const MAX_BODY_HEIGHT = 10_000_000

/** How tall the scrollable body is for `count` rows: their real height, capped. */
export function bodyHeightFor(count: number, rowHeight: number, max = MAX_BODY_HEIGHT): number {
  return Math.min(count * rowHeight, max)
}

/**
 * Scroll position → offset into the full-height list. `total` is the real
 * height of every row, `height` the (capped) scrollable height, `viewport`
 * what is visible of it. While the rows fit this is the identity; once they
 * don't, the scroll range maps proportionally onto the row range, so the end
 * of the scrollbar is the end of the file.
 */
export function toVirtualTop(scrollTop: number, total: number, height: number, viewport: number): number {
  if (total <= height) return scrollTop
  const range = height - viewport
  if (range <= 0) return 0
  const clamped = Math.min(Math.max(0, scrollTop), range)
  return (clamped / range) * (total - viewport)
}

/** The inverse of toVirtualTop: where to scroll so `virtualTop` is at the top. */
export function toScrollTop(virtualTop: number, total: number, height: number, viewport: number): number {
  if (total <= height) return virtualTop
  const span = total - viewport
  if (span <= 0) return 0
  const clamped = Math.min(Math.max(0, virtualTop), span)
  return (clamped / span) * (height - viewport)
}

/** Prefix sums of the column widths; length is widths.length + 1. */
export function columnOffsets(widths: number[]): number[] {
  const offsets = new Array<number>(widths.length + 1)
  offsets[0] = 0
  for (let i = 0; i < widths.length; i++) offsets[i + 1] = offsets[i] + widths[i]
  return offsets
}

/** Last index whose offset is <= target. */
function lowerBound(offsets: number[], target: number): number {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (offsets[mid] <= target) low = mid
    else high = mid - 1
  }
  return low
}

/** Variable column widths, so the visible band needs a search. */
export function columnWindow(
  offsets: number[],
  scrollLeft: number,
  viewport: number,
  overscan = 2,
): { first: number; last: number } {
  const count = offsets.length - 1
  if (count <= 0) return { first: 0, last: 0 }
  const first = Math.max(0, lowerBound(offsets, scrollLeft) - overscan)
  const last = Math.min(count, lowerBound(offsets, scrollLeft + viewport) + 1 + overscan)
  return { first, last: Math.max(first, last) }
}
