import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import type { StringStream } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const JQ_KEYWORDS = [
  'def', 'if', 'then', 'elif', 'else', 'end', 'as', 'reduce', 'foreach',
  'try', 'catch', 'import', 'include', 'label', 'and', 'or', 'not',
]

const KEYWORD_SET = new Set(JQ_KEYWORDS)
const LITERALS = new Set(['true', 'false', 'null'])

// Common builtins, used only for highlighting. Completion gets the full,
// version-exact list from the engine itself (see completions.ts).
const HIGHLIGHT_BUILTINS = new Set([
  'length', 'keys', 'keys_unsorted', 'values', 'has', 'in', 'map', 'map_values',
  'select', 'empty', 'error', 'add', 'any', 'all', 'range', 'floor', 'ceil',
  'sqrt', 'min', 'max', 'min_by', 'max_by', 'sort', 'sort_by', 'group_by',
  'unique', 'unique_by', 'reverse', 'contains', 'inside', 'startswith',
  'endswith', 'ltrimstr', 'rtrimstr', 'trim', 'split', 'join', 'test', 'match',
  'capture', 'scan', 'splits', 'sub', 'gsub', 'ascii_downcase', 'ascii_upcase',
  'explode', 'implode', 'tostring', 'tonumber', 'type', 'infinite', 'nan',
  'isnan', 'isinfinite', 'tojson', 'fromjson', 'recurse', 'walk', 'env',
  'input', 'inputs', 'debug', 'stderr', 'paths', 'leaf_paths', 'getpath',
  'setpath', 'delpaths', 'to_entries', 'from_entries', 'with_entries', 'del',
  'pick', 'path', 'flatten', 'until', 'while', 'repeat', 'limit', 'first',
  'last', 'nth', 'now', 'todate', 'fromdate', 'strftime', 'strptime', 'mktime',
  'gmtime', 'localtime', 'tostream', 'fromstream', 'truncate_stream',
  'transpose', 'combinations', 'indices', 'index', 'rindex', 'builtins',
  'halt', 'halt_error', 'splits', 'utf8bytelength', 'abs', 'toarray',
])

// String/interpolation nesting: "a\(1 + ("x" + 2))b" needs a frame stack.
type Frame = { t: 'str' } | { t: 'interp'; depth: number }

interface JqState {
  stack: Frame[]
}

function tokenize(stream: StringStream, state: JqState): string | null {
  const top = state.stack[state.stack.length - 1]

  if (top?.t === 'str') {
    if (stream.match('\\(')) {
      state.stack.push({ t: 'interp', depth: 0 })
      return 'interp'
    }
    while (!stream.eol()) {
      const ch = stream.peek()
      if (ch === '"') {
        stream.next()
        state.stack.pop()
        return 'string'
      }
      if (ch === '\\') {
        if (stream.string.startsWith('\\(', stream.pos)) break
        stream.next()
        if (!stream.eol()) stream.next()
        continue
      }
      stream.next()
    }
    return 'string'
  }

  if (stream.eatSpace()) return null

  const ch = stream.peek()
  if (ch === '#') {
    stream.skipToEnd()
    return 'comment'
  }
  if (ch === '"') {
    stream.next()
    state.stack.push({ t: 'str' })
    return 'string'
  }
  if (top?.t === 'interp') {
    if (ch === '(') {
      top.depth++
      stream.next()
      return null
    }
    if (ch === ')') {
      stream.next()
      if (top.depth === 0) {
        state.stack.pop()
        return 'interp'
      }
      top.depth--
      return null
    }
  }
  if (stream.match(/^\$(?:__loc__|ENV|[A-Za-z_]\w*)/)) return 'variable'
  if (stream.match(/^@\w+/)) return 'format'
  if (stream.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number'
  if (stream.match(/^\.\./)) return 'operator'
  if (stream.match(/^\.(?:[A-Za-z_]\w*)?/)) return 'field'
  if (stream.match(/^[A-Za-z_]\w*/)) {
    const word = stream.current()
    if (KEYWORD_SET.has(word)) return 'keyword'
    if (LITERALS.has(word)) return 'literal'
    if (HIGHLIGHT_BUILTINS.has(word)) return 'builtin'
    return null
  }
  if (stream.match(/^(?:\|=|\/\/=|[+\-*/%]=|==|!=|<=|>=|\?\/\/|\/\/|\?|\||=|<|>|[+\-*/%])/)) {
    return 'operator'
  }
  stream.next()
  return null
}

export const jqLanguage = StreamLanguage.define<JqState>({
  name: 'jq',
  startState: () => ({ stack: [] }),
  copyState: (s) => ({ stack: s.stack.map((f) => ({ ...f })) }),
  token: tokenize,
  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
  },
  tokenTable: {
    comment: t.comment,
    string: t.string,
    interp: t.special(t.string),
    variable: t.special(t.variableName),
    format: t.labelName,
    number: t.number,
    field: t.propertyName,
    keyword: t.keyword,
    literal: t.atom,
    builtin: t.standard(t.variableName),
    operator: t.operator,
  },
})

// Colors come from the app's CSS variables so both themes work untouched.
export const jqHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--tok-str)' },
  { tag: t.special(t.string), color: 'var(--tok-lit)' },
  { tag: t.special(t.variableName), color: 'var(--tok-num)' },
  { tag: t.labelName, color: 'var(--tok-lit)' },
  { tag: t.number, color: 'var(--tok-num)' },
  { tag: t.propertyName, color: 'var(--tok-key)' },
  { tag: t.keyword, color: 'var(--accent)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--tok-lit)' },
  { tag: t.standard(t.variableName), color: 'var(--accent)' },
  { tag: t.operator, color: 'var(--text)' },
])

export const jqSyntaxHighlighting = syntaxHighlighting(jqHighlightStyle)
