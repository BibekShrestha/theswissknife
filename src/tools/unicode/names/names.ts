import { CONTROLS, NAMES, NAMES_VERSION, RANGES } from './table'

/**
 * Character names from the generated table (scripts/unicode-names.py).
 * Imported only by the analysis worker, through `import()`, so the ~115 KB gz
 * table is its own chunk: never in the entry graph, fetched the first time
 * someone opens this tool and then runtime-cached by the service worker.
 */

export { NAMES_VERSION }

export interface NameInfo {
  name: string
  /** 'alias': controls have no Name; this is their `control` name alias. */
  kind: 'name' | 'alias'
}

const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0')

let explicit: Map<number, string> | null = null
let controls: Map<number, string> | null = null

function decode(): Map<number, string> {
  const map = new Map<number, string>()
  let cp = -1
  let prev = ''
  let start = 0
  // Hand-rolled split: ~34k lines, decoded once per worker.
  while (start <= NAMES.length) {
    let end = NAMES.indexOf('\n', start)
    if (end < 0) end = NAMES.length
    const a = NAMES.indexOf(';', start)
    const b = NAMES.indexOf(';', a + 1)
    const gap = a > start ? parseInt(NAMES.slice(start, a), 36) : 0
    const shared = b > a + 1 ? parseInt(NAMES.slice(a + 1, b), 36) : 0
    cp += gap + 1
    prev = prev.slice(0, shared) + NAMES.slice(b + 1, end)
    map.set(cp, prev)
    start = end + 1
  }
  return map
}

// Hangul syllables, Unicode §3.12 (rule NR1).
const JAMO_L = ['G', 'GG', 'N', 'D', 'DD', 'R', 'M', 'B', 'BB', 'S', 'SS', '', 'J', 'JJ', 'C', 'K', 'T', 'P', 'H']
const JAMO_V = ['A', 'AE', 'YA', 'YAE', 'EO', 'E', 'YEO', 'YE', 'O', 'WA', 'WAE', 'OE', 'YO', 'U', 'WEO', 'WE', 'WI', 'YU', 'EU', 'YI', 'I']
const JAMO_T = ['', 'G', 'GG', 'GS', 'N', 'NJ', 'NH', 'D', 'L', 'LG', 'LM', 'LB', 'LS', 'LT', 'LP', 'LH', 'M', 'B', 'BS', 'S', 'SS', 'NG', 'J', 'C', 'K', 'T', 'P', 'H']

function hangul(cp: number): string {
  const s = cp - 0xac00
  const l = Math.floor(s / 588)
  const v = Math.floor((s % 588) / 28)
  const t = s % 28
  return `HANGUL SYLLABLE ${JAMO_L[l]}${JAMO_V[v]}${JAMO_T[t]}`
}

/** The character's name in the Unicode 16.0 table, or null (unassigned there, private use, surrogate, noncharacter). */
export function nameOf(cp: number): NameInfo | null {
  if (cp >= 0xac00 && cp <= 0xd7a3) return { name: hangul(cp), kind: 'name' }
  for (const [first, last, prefix] of RANGES) {
    if (cp >= first && cp <= last) return { name: prefix + hex(cp), kind: 'name' }
  }
  if (cp < 0xa0 && (cp < 0x20 || cp >= 0x7f)) {
    controls ??= new Map(CONTROLS.split('\n').map((line) => {
      const [code, alias] = line.split(';')
      return [parseInt(code, 16), alias]
    }))
    const alias = controls.get(cp)
    return alias ? { name: alias, kind: 'alias' } : null
  }
  explicit ??= decode()
  const name = explicit.get(cp)
  return name ? { name, kind: 'name' } : null
}

/** For tests: how many explicit names the table holds. */
export function explicitCount(): number {
  explicit ??= decode()
  return explicit.size
}
