/**
 * Path-context detection for input-aware field completion.
 *
 * Given the text before the cursor, extract the trailing `.foo[].bar`-style
 * chain and split it into the completed parent path and the partial key being
 * typed. Purely lexical — jq's real parser rejects incomplete input, so an
 * error-tolerant heuristic is the right tool here (see plan).
 */

export interface PathContext {
  /** Signature of the completed segments, e.g. `.repos[]` ('' = root). */
  parentSig: string
  /** The partially typed key after the final dot (may be ''). */
  partial: string
}

// One chain segment: `.ident?`, a bare `.`, or an index/iterate `[…]?`.
const SEGMENT = /\.(?:[A-Za-z_]\w*)?\??|\[\d*\]\??/g
const CHAIN_AT_END = /(?:\.(?:[A-Za-z_]\w*)?\??|\[\d*\]\??)+$/

export function pathContext(before: string): PathContext | null {
  const m = CHAIN_AT_END.exec(before)
  if (!m) return null
  const tokens = m[0].match(SEGMENT) ?? []
  if (tokens.length === 0) return null

  // Field completion only applies while typing after a dot; a chain ending
  // in `]` / `?` (or `.foo?`) is already complete.
  const last = tokens[tokens.length - 1]
  if (!last.startsWith('.') || last.endsWith('?')) return null

  const parentSig = tokens
    .slice(0, -1)
    .map((tok) => (tok.startsWith('.') ? '.' + tok.slice(1).replace(/\?$/, '') : '[]'))
    .join('')
  return { parentSig, partial: last.slice(1) }
}

/** Folded view of the input's structure: parent path → child object keys. */
export interface PathIndex {
  children: Map<string, Set<string>>
  /** Union of keys at every depth — fallback when context can't resolve. */
  allKeys: Set<string>
}

const IDENT = /^[A-Za-z_]\w*$/

/**
 * Fold jq `paths` output (arrays of keys, with numbers already replaced by
 * "[]") into a parent→children lookup. Non-identifier keys are skipped —
 * they can't be typed as `.key` anyway.
 */
export function foldPaths(paths: string[][]): PathIndex {
  const children = new Map<string, Set<string>>()
  const allKeys = new Set<string>()
  for (const path of paths) {
    let sig = ''
    for (const seg of path) {
      if (seg === '[]') {
        sig += '[]'
        continue
      }
      if (IDENT.test(seg)) {
        let set = children.get(sig)
        if (!set) children.set(sig, (set = new Set()))
        set.add(seg)
        allKeys.add(seg)
      }
      sig += '.' + seg
    }
  }
  return { children, allKeys }
}
