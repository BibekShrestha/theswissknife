/**
 * "Copy as JS": the pattern as source code that builds the same RegExp.
 *
 * A literal needs three things a pattern string may not have: an escaped `/`
 * outside classes (unescaped it ends the literal; inside a class it may stay,
 * and v-flag classes require it escaped already), no raw line
 * terminators (a literal cannot span lines; \n, \r, \u2028 and \u2029 mean
 * the same characters), and something between the slashes (`//` starts a
 * comment, so the empty pattern is written `(?:)`, as RegExp#source does).
 */

const LINE_ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

export function literalSource(pattern: string, flags = ''): string {
  if (pattern === '') return '(?:)'
  const nested = flags.includes('v')
  let out = ''
  let classDepth = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '[') classDepth = nested ? classDepth + 1 : 1
    else if (c === ']' && classDepth > 0) classDepth--
    if (c === '\\' && i + 1 < pattern.length) {
      const next = pattern[i + 1]
      // A backslash before a line terminator escapes that character; the
      // escape sequence for it says the same thing on one line.
      out += LINE_ESCAPES[next] ?? `\\${next}`
      i++
    } else if (c === '/' && classDepth === 0) out += '\\/'
    else out += LINE_ESCAPES[c] ?? c
  }
  return out
}

export function toLiteral(pattern: string, flags: string): string {
  return `/${literalSource(pattern, flags)}/${flags}`
}

/** JSON string syntax is valid JavaScript (ES2019 made U+2028/U+2029 legal in strings). */
export function toConstructor(pattern: string, flags: string): string {
  return flags ? `new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(flags)})` : `new RegExp(${JSON.stringify(pattern)})`
}

/** A replace call using the literal, for the Code tab in replace mode. */
export function toReplaceCall(pattern: string, flags: string, replacement: string): string {
  return `text.replace(${toLiteral(pattern, flags)}, ${JSON.stringify(replacement)})`
}
