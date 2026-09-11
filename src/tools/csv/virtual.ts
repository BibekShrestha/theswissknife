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
