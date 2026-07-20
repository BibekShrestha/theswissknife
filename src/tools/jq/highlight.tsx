import type { ReactNode } from 'react'

const TOKEN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g

const MAX_HIGHLIGHT_LEN = 400_000

/**
 * Lightweight syntax highlighting for jq's JSON stdout. Works on the raw
 * text (so --tab / --indent / -c / --seq output is untouched), falls back
 * to plain text for very large outputs.
 */
export function highlightJson(text: string): ReactNode {
  if (text.length > MAX_HIGHLIGHT_LEN) return text
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    let cls: string
    if (tok[0] === '"') {
      cls = /^\s*:/.test(text.slice(m.index + tok.length)) ? 'tok-key' : 'tok-str'
    } else if (tok === 'true' || tok === 'false' || tok === 'null') {
      cls = 'tok-lit'
    } else {
      cls = 'tok-num'
    }
    nodes.push(
      <span key={key++} className={cls}>
        {tok}
      </span>,
    )
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
