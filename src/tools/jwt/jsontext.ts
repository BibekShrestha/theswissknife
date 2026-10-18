/**
 * JSON text helpers that never go through JSON.parse → JSON.stringify, so a
 * token's values survive display and re-signing byte for byte: integers past
 * 2^53, `1.0`, `A` escapes and duplicate keys all stay as written.
 * Input is validated with JSON.parse first; the tokenizer assumes valid JSON.
 */

type Token = { punct: true; v: string } | { punct: false; v: string; str: boolean }

function tokens(text: string): Token[] {
  JSON.parse(text) // throws on invalid JSON
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
    } else if ('{}[]:,'.includes(c)) {
      out.push({ punct: true, v: c })
      i++
    } else if (c === '"') {
      let j = i + 1
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out.push({ punct: false, v: text.slice(i, j + 1), str: true })
      i = j + 1
    } else {
      let j = i
      while (j < text.length && !' \t\n\r{}[]:,"'.includes(text[j])) j++
      out.push({ punct: false, v: text.slice(i, j), str: false })
      i = j
    }
  }
  return out
}

function format(toks: Token[]): string {
  let out = ''
  let depth = 0
  const indent = () => '\n' + '  '.repeat(depth)
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]
    if (!t.punct) {
      out += t.v
    } else if (t.v === '{' || t.v === '[') {
      const next = toks[k + 1]
      if (next?.punct && (next.v === '}' || next.v === ']')) {
        out += t.v + next.v
        k++
      } else {
        depth++
        out += t.v + indent()
      }
    } else if (t.v === '}' || t.v === ']') {
      depth--
      out += indent() + t.v
    } else if (t.v === ',') {
      out += ',' + indent()
    } else {
      out += ': '
    }
  }
  return out
}

/** Two-space pretty print, values copied verbatim. */
export function prettyJson(text: string): string {
  return format(tokens(text))
}

/** Whitespace-free form, values copied verbatim. */
export function minifyJson(text: string): string {
  return tokens(text).map((t) => t.v).join('')
}

/** Keys that appear more than once in the same object (JSON.parse keeps the last). */
export function duplicateKeys(text: string): string[] {
  const stack: ({ keys: Set<string>; expectKey: boolean } | null)[] = []
  const dups: string[] = []
  for (const t of tokens(text)) {
    const top = stack[stack.length - 1]
    if (t.punct) {
      if (t.v === '{') stack.push({ keys: new Set(), expectKey: true })
      else if (t.v === '[') stack.push(null)
      else if (t.v === '}' || t.v === ']') stack.pop()
      else if (t.v === ',' && top) top.expectKey = true
    } else if (top?.expectKey && t.str) {
      const key = JSON.parse(t.v) as string
      if (top.keys.has(key)) {
        if (!dups.includes(key)) dups.push(key)
      } else top.keys.add(key)
      top.expectKey = false
    }
  }
  return dups
}

/**
 * Set a top-level member of a JSON object to `valueJson` (compact JSON),
 * replacing every occurrence of the key or appending it, and pretty-print.
 * Everything else is left exactly as written.
 */
export function setTopLevel(text: string, key: string, valueJson: string): string {
  const toks = tokens(text)
  if (!toks[0]?.punct || toks[0].v !== '{') throw new Error('Not a JSON object.')
  const value: Token = { punct: false, v: valueJson, str: false }
  const out: Token[] = [toks[0]]
  let found = false
  let k = 1
  while (k < toks.length - 1) {
    const t = toks[k]
    const isKey = !t.punct && t.str && (toks[k - 1].v === '{' || toks[k - 1].v === ',') && toks[k + 1]?.v === ':'
    if (isKey && JSON.parse(t.v) === key) {
      found = true
      out.push(t, toks[k + 1], value)
      // skip the old value, however deep
      let depth = 0
      k += 2
      while (k < toks.length - 1) {
        const v = toks[k]
        if (v.punct && (v.v === '{' || v.v === '[')) depth++
        if (v.punct && (v.v === '}' || v.v === ']')) depth--
        if (depth === 0 && v.punct && v.v === ',') break
        k++
      }
      continue
    }
    // descend through nested values without treating their keys as top-level
    if (t.punct && (t.v === '{' || t.v === '[')) {
      let depth = 0
      while (k < toks.length - 1) {
        const v = toks[k]
        out.push(v)
        if (v.punct && (v.v === '{' || v.v === '[')) depth++
        if (v.punct && (v.v === '}' || v.v === ']')) depth--
        k++
        if (depth === 0) break
      }
      continue
    }
    out.push(t)
    k++
  }
  if (!found) {
    if (out.length > 1) out.push({ punct: true, v: ',' })
    out.push({ punct: false, v: JSON.stringify(key), str: true }, { punct: true, v: ':' }, value)
  }
  out.push(toks[toks.length - 1])
  return format(out)
}
