/**
 * Myers' O(ND) difference algorithm, linear-space variant ("An O(ND)
 * Difference Algorithm and Its Variations", 1986, §4b). Sequences are arrays
 * of small integers — callers intern lines or words first so comparison is
 * one `===`.
 *
 * The result is the list of matching runs, in order. Everything between two
 * runs is a deletion from `a` and/or an insertion into `b`. The edit script is
 * minimal: deletions + insertions equal len(a) + len(b) − 2·LCS.
 */

/** A run of `length` equal elements starting at a[aStart] and b[bStart]. */
export interface Match {
  aStart: number
  bStart: number
  length: number
}

type Seq = ArrayLike<number>

export function diffSequences(a: Seq, b: Seq): Match[] {
  const matches: Match[] = []
  const size = Math.ceil((a.length + b.length) / 2) * 2 + 3
  const forward = new Int32Array(size)
  const backward = new Int32Array(size)

  const push = (aStart: number, bStart: number, length: number) => {
    if (length <= 0) return
    const last = matches[matches.length - 1]
    if (last && last.aStart + last.length === aStart && last.bStart + last.length === bStart) last.length += length
    else matches.push({ aStart, bStart, length })
  }

  const solve = (aLo: number, aHi: number, bLo: number, bHi: number) => {
    // Common prefix and suffix are free, and trimming them is most of the win
    // on real files.
    let prefix = 0
    while (aLo + prefix < aHi && bLo + prefix < bHi && a[aLo + prefix] === b[bLo + prefix]) prefix++
    push(aLo, bLo, prefix)
    aLo += prefix
    bLo += prefix
    let suffix = 0
    while (aLo < aHi - suffix && bLo < bHi - suffix && a[aHi - suffix - 1] === b[bHi - suffix - 1]) suffix++
    aHi -= suffix
    bHi -= suffix

    if (aLo < aHi && bLo < bHi) {
      const [x, y, u, v] = middleSnake(a, aLo, aHi, b, bLo, bHi, forward, backward)
      solve(aLo, aLo + x, bLo, bLo + y)
      push(aLo + x, bLo + y, u - x)
      solve(aLo + u, aHi, bLo + v, bHi)
    }
    push(aHi, bHi, suffix)
  }

  solve(0, a.length, 0, b.length)
  return matches
}

/**
 * Finds the middle snake of the optimal path through a[aLo..aHi) × b[bLo..bHi)
 * by running the greedy search from both corners until they overlap. Returns
 * the snake's start and end, relative to (aLo, bLo).
 */
function middleSnake(a: Seq, aLo: number, aHi: number, b: Seq, bLo: number, bHi: number, vf: Int32Array, vb: Int32Array): [number, number, number, number] {
  const n = aHi - aLo
  const m = bHi - bLo
  const delta = n - m
  const odd = (delta & 1) !== 0
  const max = Math.ceil((n + m) / 2)
  const offset = max + 1
  vf[offset + 1] = 0
  vb[offset + 1] = 0

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && vf[offset + k - 1] < vf[offset + k + 1]) ? vf[offset + k + 1] : vf[offset + k - 1] + 1
      let y = x - k
      const x0 = x
      const y0 = y
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++ }
      vf[offset + k] = x
      // Reverse diagonal for forward diagonal k is delta − k.
      const r = delta - k
      if (odd && r >= -(d - 1) && r <= d - 1 && x + vb[offset + r] >= n) return [x0, y0, x, y]
    }
    for (let k = -d; k <= d; k += 2) {
      // Here x and y count from the bottom-right corner.
      let x = k === -d || (k !== d && vb[offset + k - 1] < vb[offset + k + 1]) ? vb[offset + k + 1] : vb[offset + k - 1] + 1
      let y = x - k
      const x0 = x
      const y0 = y
      while (x < n && y < m && a[aHi - x - 1] === b[bHi - y - 1]) { x++; y++ }
      vb[offset + k] = x
      const f = delta - k
      if (!odd && f >= -d && f <= d && x + vf[offset + f] >= n) return [n - x, m - y, n - x0, m - y0]
    }
  }
  // Unreachable: the searches always meet by d = max.
  throw new Error('diff: no middle snake')
}

/** Interns strings into integers so sequences compare with `===`. */
export function createInterner() {
  const ids = new Map<string, number>()
  return (key: string) => {
    let id = ids.get(key)
    if (id === undefined) ids.set(key, (id = ids.size))
    return id
  }
}
