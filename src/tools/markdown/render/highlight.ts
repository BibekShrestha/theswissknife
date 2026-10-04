/**
 * Fenced-code highlighting, hand-written.
 *
 * Shiki and highlight.js are 300 KB+ of grammars for something that mostly has
 * to survive being printed. This covers the languages people actually paste,
 * degrades to plain monospace for the rest, and ships inside the tool's chunk.
 * Tokens are produced as data (`tokenize`) so the tests can read them, and
 * turned into markup separately (`highlight`).
 */

export type TokenClass = 'com' | 'str' | 'num' | 'key' | 'lit' | 'meta' | 'add' | 'del'

export interface Token {
  cls: TokenClass | null
  text: string
}

type Rule = [TokenClass, RegExp]

const ALIASES: Record<string, string> = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  json: 'json', jsonc: 'json',
  py: 'py', python: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh', shell: 'sh', console: 'sh', terminal: 'sh',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql',
  yaml: 'yaml', yml: 'yaml',
  diff: 'diff', patch: 'diff',
}

/** `lang` as written in the fence info string → an id in RULES, or null. */
export function resolveLang(lang: string): string | null {
  const key = lang.trim().toLowerCase().split(/[\s:{,]/)[0]
  return ALIASES[key] ?? null
}

const words = (list: string, flags = '') =>
  new RegExp(`(?:${list.trim().split(/\s+/).join('|')})\\b`, `y${flags}`)

const JS_KEYWORDS =
  'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield'
const TS_KEYWORDS =
  'abstract any asserts bigint boolean declare enum implements infer interface is keyof namespace never number object private protected public readonly require satisfies string symbol type undefined unique unknown'
const PY_KEYWORDS =
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'
const SH_KEYWORDS =
  'if then elif else fi for while until do done case esac function return export local readonly source alias set unset trap exit'
const SQL_KEYWORDS =
  'select from where group by having order limit offset insert into values update set delete create table alter drop index view join left right inner outer full on as and or not null is distinct union all with returning primary key foreign references default constraint cascade begin commit rollback case when then else end exists between like ilike in asc desc count sum avg min max coalesce'

/**
 * Ordered per language: comments and strings first, so a keyword inside a
 * string is never highlighted as a keyword. Every regex is sticky — `scan`
 * only ever tries to match at the current position.
 */
const RULES: Record<string, Rule[]> = {
  js: [
    ['com', /\/\/[^\n]*/y],
    ['com', /\/\*[\s\S]*?(?:\*\/|$)/y],
    ['str', /`(?:\\[\s\S]|[^\\`])*`?/y],
    ['str', /"(?:\\[\s\S]|[^\\"\n])*"?/y],
    ['str', /'(?:\\[\s\S]|[^\\'\n])*'?/y],
    ['num', /0[xX][\da-fA-F_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?/y],
    ['lit', words('true false null undefined NaN Infinity')],
    ['key', words(JS_KEYWORDS)],
  ],
  ts: [
    ['com', /\/\/[^\n]*/y],
    ['com', /\/\*[\s\S]*?(?:\*\/|$)/y],
    ['str', /`(?:\\[\s\S]|[^\\`])*`?/y],
    ['str', /"(?:\\[\s\S]|[^\\"\n])*"?/y],
    ['str', /'(?:\\[\s\S]|[^\\'\n])*'?/y],
    ['num', /0[xX][\da-fA-F_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?/y],
    ['lit', words('true false null undefined NaN Infinity')],
    ['key', words(`${JS_KEYWORDS} ${TS_KEYWORDS}`)],
  ],
  json: [
    ['str', /"(?:\\[\s\S]|[^\\"\n])*"?/y],
    ['num', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
    ['lit', words('true false null')],
  ],
  py: [
    ['com', /#[^\n]*/y],
    ['str', /(?:[rRbBfFuU]{0,2})("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y],
    ['str', /(?:[rRbBfFuU]{0,2})("(?:\\[\s\S]|[^\\"\n])*"?|'(?:\\[\s\S]|[^\\'\n])*'?)/y],
    ['meta', /@[\w.]+/y],
    ['num', /0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?/y],
    ['lit', words('True False None NotImplemented Ellipsis self cls')],
    ['key', words(PY_KEYWORDS)],
  ],
  sh: [
    ['com', /#[^\n]*/y],
    ['str', /"(?:\\[\s\S]|[^\\"])*"?/y],
    ['str', /'[^']*'?/y],
    ['lit', /\$(?:\{[^}]*\}?|[\w@*#?$!-]+)/y],
    ['meta', /^[$#>](?=\s)/my],
    ['num', /\b\d+\b/y],
    ['key', words(SH_KEYWORDS)],
  ],
  html: [
    ['com', /<!--[\s\S]*?(?:-->|$)/y],
    ['meta', /<!(?:doctype|DOCTYPE)[^>]*>?/y],
    ['key', /<\/?[a-zA-Z][\w:-]*|\/?>/y],
    ['str', /"[^"]*"?|'[^']*'?/y],
    ['lit', /[a-zA-Z_:][\w:.-]*(?==)/y],
  ],
  css: [
    ['com', /\/\*[\s\S]*?(?:\*\/|$)/y],
    ['str', /"[^"\n]*"?|'[^'\n]*'?/y],
    ['meta', /@[\w-]+/y],
    ['key', /[-a-zA-Z][\w-]*(?=\s*:)/y],
    ['num', /[+-]?\d*\.?\d+(?:%|[a-z]{1,4})?|#[\da-fA-F]{3,8}/y],
  ],
  sql: [
    ['com', /--[^\n]*/y],
    ['com', /\/\*[\s\S]*?(?:\*\/|$)/y],
    ['str', /'(?:''|[^'])*'?/y],
    ['str', /"[^"]*"?/y],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['key', words(SQL_KEYWORDS, 'i')],
  ],
  yaml: [
    ['com', /#[^\n]*/y],
    ['key', /^[ \t-]*[\w.$/-]+(?=\s*:(?:\s|$))/my],
    ['str', /"(?:\\[\s\S]|[^\\"\n])*"?|'(?:''|[^'\n])*'?/y],
    ['meta', /^---$|^\.\.\.$/my],
    ['num', /\b\d+(?:\.\d+)?\b/y],
    ['lit', words('true false null yes no on off ~')],
  ],
}

/** Diff is the one language that is line-shaped rather than token-shaped. */
function tokenizeDiff(code: string): Token[] {
  const out: Token[] = []
  for (const line of code.split(/(?<=\n)/)) {
    const cls: TokenClass | null =
      /^(?:\+\+\+|---|@@|diff |index )/.test(line) ? 'meta'
      : line.startsWith('+') ? 'add'
      : line.startsWith('-') ? 'del'
      : null
    out.push({ cls, text: line })
  }
  return merge(out)
}

/** Adjacent runs of the same class read as one token, and test cleaner. */
function merge(tokens: Token[]): Token[] {
  const out: Token[] = []
  for (const token of tokens) {
    if (token.text === '') continue
    const last = out[out.length - 1]
    if (last && last.cls === token.cls) last.text += token.text
    else out.push({ ...token })
  }
  return out
}

function scan(code: string, rules: Rule[]): Token[] {
  const out: Token[] = []
  let pos = 0

  while (pos < code.length) {
    let matched = false
    for (const [cls, re] of rules) {
      re.lastIndex = pos
      const m = re.exec(code)
      if (m && m[0].length > 0) {
        // A keyword must start a word: "isNaN" is not the `is` keyword.
        if ((cls === 'key' || cls === 'lit') && pos > 0 && /[\w$]/.test(code[pos - 1])) continue
        out.push({ cls, text: m[0] })
        pos += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      out.push({ cls: null, text: code[pos] })
      pos++
    }
  }

  return merge(out)
}

/** Code → tokens. An unsupported language yields one plain token. */
export function tokenize(code: string, lang: string): Token[] {
  const id = resolveLang(lang)
  if (!id) return merge([{ cls: null, text: code }])
  if (id === 'diff') return tokenizeDiff(code)
  return scan(code, RULES[id])
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Code → markup. Escaping happens here, so no token can inject an element. */
export function highlight(code: string, lang: string): string {
  return tokenize(code, lang)
    .map(({ cls, text }) => (cls ? `<span class="hl-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text)))
    .join('')
}

/** Languages the fence info string can name, for the UI to advertise. */
export const SUPPORTED_LANGUAGES = [...new Set(Object.values(ALIASES))].sort()
