import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { cheatsheet } from '../cheatsheet'
import { foldPaths, pathContext, type PathIndex } from './context'
import { JQ_KEYWORDS } from './jqLanguage'

/** Live data the sources read; owned by FilterEditor, updated via refs. */
export interface CompletionData {
  builtins: string[]
  pathsIndex: PathIndex
  /** $names in scope from the options panel (named args). */
  argNames: string[]
}

export const emptyCompletionData = (): CompletionData => ({
  builtins: [],
  pathsIndex: foldPaths([]),
  argNames: [],
})

const FORMATS = [
  '@text', '@json', '@html', '@uri', '@csv', '@tsv', '@sh',
  '@base64', '@base64d', '@base32', '@base32d',
]

const BUILTIN_VARS = ['ENV', 'ARGS', '__loc__']

// Short docs for common builtins, sourced from the cheatsheet data where a
// snippet starts with the builtin's name.
const BUILTIN_DOCS: Map<string, string> = (() => {
  const docs = new Map<string, string>()
  for (const section of cheatsheet) {
    for (const item of section.items) {
      const m = /^([a-z_]\w*)/i.exec(item.code)
      if (m && !docs.has(m[1])) docs.set(m[1], item.desc)
    }
  }
  return docs
})()

const SNIPPET_OPTIONS: Completion[] = cheatsheet.flatMap((section) =>
  section.items.map((item) => ({
    label: item.code,
    detail: section.title,
    info: item.desc,
    type: 'text',
    boost: -99,
  })),
)

function fieldOptions(data: CompletionData, parentSig: string): Completion[] {
  const exact = data.pathsIndex.children.get(parentSig)
  const options: Completion[] = []
  if (exact) {
    for (const key of exact) {
      options.push({ label: key, type: 'property', boost: 2, detail: parentSig ? `${parentSig}.` : 'key' })
    }
  }
  for (const key of data.pathsIndex.allKeys) {
    if (!exact?.has(key)) options.push({ label: key, type: 'property', boost: 0, detail: 'key (elsewhere)' })
  }
  return options
}

/** Scan the filter text for `as $x` bindings and `def f($a; $b)` params. */
export function scanVariables(doc: string): string[] {
  const names = new Set<string>()
  for (const m of doc.matchAll(/\bas\s+\$([A-Za-z_]\w*)/g)) names.add(m[1])
  for (const m of doc.matchAll(/\bas\s*\[([^\]]*)\]/g)) {
    for (const v of m[1].matchAll(/\$([A-Za-z_]\w*)/g)) names.add(v[1])
  }
  for (const m of doc.matchAll(/\bdef\s+[A-Za-z_]\w*\s*\(([^)]*)\)/g)) {
    for (const v of m[1].matchAll(/\$([A-Za-z_]\w*)/g)) names.add(v[1])
  }
  return [...names]
}

export function createJqCompletionSource(getData: () => CompletionData) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const data = getData()
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = ctx.state.sliceDoc(line.from, ctx.pos)

    // $variables
    const varMatch = /\$([A-Za-z_]\w*)?$/.exec(before)
    if (varMatch) {
      const scoped = scanVariables(ctx.state.doc.toString())
      const names = [...new Set([...data.argNames, ...scoped, ...BUILTIN_VARS])]
      return {
        from: ctx.pos - (varMatch[1]?.length ?? 0),
        options: names.map((n) => ({ label: n, type: 'variable' })),
        validFor: /^[A-Za-z_]\w*$/,
      }
    }

    // @formats
    const fmtMatch = /@(\w*)$/.exec(before)
    if (fmtMatch) {
      return {
        from: ctx.pos - fmtMatch[0].length,
        options: FORMATS.map((f) => ({ label: f, type: 'function' })),
        validFor: /^@\w*$/,
      }
    }

    // .fields — input-aware
    const path = pathContext(before)
    if (path) {
      const options = fieldOptions(data, path.parentSig)
      if (options.length === 0) return null
      return {
        from: ctx.pos - path.partial.length,
        options,
        validFor: /^\w*$/,
      }
    }

    // builtins / keywords / snippets on a word token
    const word = ctx.matchBefore(/[A-Za-z_]\w*/)
    if (!word && !ctx.explicit) return null
    const options: Completion[] = [
      ...data.builtins.map((b): Completion => ({
        label: b,
        type: 'function',
        info: BUILTIN_DOCS.get(b),
        boost: 1,
      })),
      ...JQ_KEYWORDS.map((k): Completion => ({ label: k, type: 'keyword' })),
      ...SNIPPET_OPTIONS,
    ]
    return {
      from: word ? word.from : ctx.pos,
      options,
      validFor: /^[A-Za-z_]\w*$/,
    }
  }
}
