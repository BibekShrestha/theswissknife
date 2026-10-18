/**
 * Splits a pasted curl command into words the way the shell that the browser
 * wrote it for would: bash (Chrome/Firefox/Safari "Copy as cURL", and
 * Firefox's POSIX variant) or Windows cmd (Chrome's "Copy as cURL (cmd)",
 * Firefox's Windows variant).
 *
 * This is not a shell. It knows quoting, escapes and line continuations, and
 * anything that would make a real shell do more than split words — variables,
 * command substitution, pipes, redirects, a second command — is reported as a
 * note and taken literally or ignored, never run and never silently dropped.
 *
 * Every loop moves forward through the input and nothing backtracks, so the
 * cost is linear in the input length (the fuzz tests in tokenize.test.ts hold
 * it to that).
 */

export type Dialect = 'bash' | 'cmd'

export interface Token {
  /** The word after quote removal and escape processing. */
  value: string
  /** Source span [start, end) in the normalised input, quotes included. */
  start: number
  end: number
}

export interface Note {
  level: 'warn' | 'info'
  text: string
}

export interface Tokenized {
  dialect: Dialect
  tokens: Token[]
  notes: Note[]
}

/** Larger inputs are refused before tokenizing (a browser copy is rarely over a few hundred KB). */
export const MAX_INPUT = 1_000_000

const MAX_NOTES = 40

/** Windows clipboards turn \n into \r\n; both shells would see the CR as noise. */
export function normalizeInput(text: string): string {
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
}

const snippet = (text: string) => {
  const flat = text.trim().replace(/\s+/g, ' ')
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat
}

const lineOf = (text: string, index: number) => {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * cmd when the first argument is caret-quoted (`curl ^"https://…^"`, what
 * Chrome and Firefox write for cmd) or when lines end in a caret and none in
 * a backslash.
 */
export function detectDialect(text: string): Dialect {
  if (/^\s*(?:\S{0,200}[\\/])?curl(?:\.exe)?[ \t]+\^"/i.test(text.slice(0, 400))) return 'cmd'
  let caret = false
  let backslash = false
  let lineEnd = text.indexOf('\n')
  let from = 0
  while (true) {
    const end = lineEnd < 0 ? text.length : lineEnd
    let last = end - 1
    while (last >= from && (text[last] === ' ' || text[last] === '\t')) last--
    if (last >= from) {
      if (text[last] === '^') caret = true
      else if (text[last] === '\\') backslash = true
    }
    if (lineEnd < 0) break
    from = lineEnd + 1
    lineEnd = text.indexOf('\n', from)
  }
  return caret && !backslash ? 'cmd' : 'bash'
}

export function tokenize(input: string, dialect: Dialect = detectDialect(input)): Tokenized {
  return dialect === 'cmd' ? tokenizeCmd(input) : tokenizeBash(input)
}

function noteList() {
  const notes: Note[] = []
  const seen = new Set<string>()
  const add = (level: Note['level'], text: string) => {
    if (seen.has(text) || notes.length >= MAX_NOTES) return
    seen.add(text)
    notes.push({ level, text })
  }
  return { notes, add }
}

const isNameStart = (c: string | undefined) => c !== undefined && /[A-Za-z_]/.test(c)
const isNameChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isOctal = (c: string | undefined) => c !== undefined && c >= '0' && c <= '7'
const isHex = (c: string | undefined) => c !== undefined && /[0-9A-Fa-f]/.test(c)

/* ------------------------------------------------------------------ bash */

function tokenizeBash(src: string): Tokenized {
  const { notes, add } = noteList()
  const tokens: Token[] = []
  const n = src.length
  let i = 0
  let cur = null as string | null
  let curStart = 0
  /** Set by a redirect: the next word is its target, not an argument. */
  let redirect: string | null = null
  let joined = false

  const begin = (at: number) => {
    if (cur === null) {
      cur = ''
      curStart = at
    }
  }
  const finish = (end: number) => {
    if (cur === null) return
    if (redirect !== null) {
      add('warn', `The redirect ${redirect} ${cur} was ignored — it only affects where curl's output goes`)
      redirect = null
    } else {
      tokens.push({ value: cur, start: curStart, end })
    }
    cur = null
  }
  const stop = (from: number, why: string) => {
    const rest = snippet(src.slice(from))
    add('warn', rest ? `${why} — not converted: “${rest}”` : why)
  }

  /** `$…` outside single quotes. Returns the index after it; appends what bash would see literally. */
  const dollar = (at: number): number => {
    const next = src[at + 1]
    if (next === '(') {
      let depth = 0
      let j = at + 1
      for (; j < n; j++) {
        if (src[j] === '(') depth++
        else if (src[j] === ')' && --depth === 0) break
      }
      const end = Math.min(j + 1, n)
      const text = src.slice(at, end)
      add('warn', `Command substitution ${snippet(text)} is not run — it was kept as literal text`)
      cur += text
      return end
    }
    if (next === '{') {
      const close = src.indexOf('}', at + 2)
      const end = close < 0 ? n : close + 1
      const text = src.slice(at, end)
      add('warn', `Shell variable ${snippet(text)} is not expanded — it was kept as literal text`)
      cur += text
      return end
    }
    if (isNameStart(next)) {
      let j = at + 2
      while (j < n && isNameChar(src[j])) j++
      const text = src.slice(at, j)
      add('warn', `Shell variable ${text} is not expanded — it was kept as literal text`)
      cur += text
      return j
    }
    if (next !== undefined && /[0-9@*#?$!-]/.test(next)) {
      add('warn', `Shell parameter $${next} is not expanded — it was kept as literal text`)
      cur += `$${next}`
      return at + 2
    }
    cur += '$'
    return at + 1
  }

  const backtick = (at: number): number => {
    let j = at + 1
    while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1
    const end = Math.min(j + 1, n)
    const text = src.slice(at, end)
    add('warn', `Command substitution ${snippet(text)} is not run — it was kept as literal text`)
    cur += text
    return end
  }

  /** Inside "…" (or $"…"), starting after the opening quote. */
  const double = (at: number): number => {
    let j = at
    while (j < n) {
      const c = src[j]
      if (c === '"') return j + 1
      if (c === '\\') {
        const next = src[j + 1]
        if (next === '\n') j += 2
        else if (next === '$' || next === '`' || next === '"' || next === '\\') {
          cur += next
          j += 2
        } else {
          cur += '\\'
          j += 1
        }
      } else if (c === '$') j = dollar(j)
      else if (c === '`') j = backtick(j)
      else {
        // fast path for ordinary characters
        let k = j + 1
        while (k < n && src[k] !== '"' && src[k] !== '\\' && src[k] !== '$' && src[k] !== '`') k++
        cur += src.slice(j, k)
        j = k
      }
    }
    add('warn', 'A double quote is never closed — read to the end of the input')
    return n
  }

  /** Inside $'…', starting after the opening quote. */
  const ansi = (at: number): number => {
    let j = at
    let bytes: number[] = []
    const flush = () => {
      if (!bytes.length) return
      const array = Uint8Array.from(bytes)
      try {
        cur += new TextDecoder('utf-8', { fatal: true }).decode(array)
      } catch {
        // Firefox and Safari write \xHH for code points below 256 (é → \xe9),
        // which bash would emit as one raw byte. Read such bytes as Latin-1,
        // which is what the browser meant.
        cur += String.fromCharCode(...array)
        add('info', 'Some \\xHH escapes are not valid UTF-8; they were read as Latin-1 characters (how Firefox and Safari write é and other code points below 256)')
      }
      bytes = []
    }
    const push = (text: string) => {
      flush()
      cur += text
    }
    while (j < n) {
      const c = src[j]
      if (c === "'") {
        flush()
        return j + 1
      }
      if (c !== '\\') {
        let k = j + 1
        while (k < n && src[k] !== "'" && src[k] !== '\\') k++
        push(src.slice(j, k))
        j = k
        continue
      }
      const e = src[j + 1]
      j += 2
      switch (e) {
        case 'a': push('\x07'); break
        case 'b': push('\b'); break
        case 'e': case 'E': push('\x1b'); break
        case 'f': push('\f'); break
        case 'n': push('\n'); break
        case 'r': push('\r'); break
        case 't': push('\t'); break
        case 'v': push('\v'); break
        case '\\': case "'": case '"': case '?': push(e); break
        case 'c': {
          const ch = src[j]
          if (ch === undefined) push('\\c')
          else {
            push(String.fromCharCode(ch.charCodeAt(0) & 0x1f))
            j++
          }
          break
        }
        case 'x': {
          let k = j
          while (k < j + 2 && isHex(src[k])) k++
          if (k === j) push('\\x')
          else bytes.push(parseInt(src.slice(j, k), 16))
          j = k
          break
        }
        case 'u': case 'U': {
          let k = j
          const max = e === 'u' ? 4 : 8
          while (k < j + max && isHex(src[k])) k++
          if (k === j) push(`\\${e}`)
          else {
            const code = parseInt(src.slice(j, k), 16)
            if (e === 'u') push(String.fromCharCode(code))
            else push(code <= 0x10ffff ? String.fromCodePoint(code) : src.slice(j - 2, k))
          }
          j = k
          break
        }
        case undefined:
          push('\\')
          break
        default:
          if (isOctal(e)) {
            let k = j - 1
            while (k < j + 2 && isOctal(src[k])) k++
            bytes.push(parseInt(src.slice(j - 1, k), 8) & 0xff)
            j = k
          } else push(`\\${e}`)
      }
    }
    flush()
    add('warn', "A $'…' string is never closed — read to the end of the input")
    return n
  }

  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r') {
      finish(i)
      i++
    } else if (c === '\\') {
      if (src[i + 1] === '\n') i += 2
      else if (i + 1 >= n) i++
      else {
        begin(i)
        cur += src[i + 1]
        i += 2
      }
    } else if (c === '\n') {
      finish(i)
      let j = i + 1
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++
      if (j >= n) break
      if (!tokens.length) {
        i = j
        continue
      }
      if (src[j] === '-' || src[j] === '#') {
        if (src[j] === '-' && !joined) {
          joined = true
          add('warn', `Line ${lineOf(src, i)} does not end with a backslash, so bash would stop there; the lines starting with “-” after it were read as part of the same command`)
        }
        i = j
        continue
      }
      stop(j, 'Only the first command is converted')
      break
    } else if (c === '#' && cur === null) {
      const end = src.indexOf('\n', i)
      i = end < 0 ? n : end
    } else if (c === "'") {
      begin(i)
      const close = src.indexOf("'", i + 1)
      if (close < 0) {
        add('warn', 'A single quote is never closed — read to the end of the input')
        cur += src.slice(i + 1)
        i = n
      } else {
        cur += src.slice(i + 1, close)
        i = close + 1
      }
    } else if (c === '"') {
      begin(i)
      i = double(i + 1)
    } else if (c === '$') {
      begin(i)
      const next = src[i + 1]
      if (next === "'") i = ansi(i + 2)
      else if (next === '"') i = double(i + 2)
      else i = dollar(i)
    } else if (c === '`') {
      begin(i)
      i = backtick(i)
    } else if (c === '|' || c === ';' || c === '&') {
      finish(i)
      if (c === '&' && src[i + 1] !== '&') stop(i, 'An unquoted & ends the command in bash (it runs it in the background); quote the URL if the & belongs to it')
      else if (c === '|' && src[i + 1] !== '|') stop(i, 'A pipe (|) ends the curl command')
      else stop(i, `${c === ';' ? ';' : c + c} ends the curl command`)
      break
    } else if (c === '>' || c === '<') {
      // `2>/dev/null`: the digits before the operator name a file descriptor.
      if (cur !== null && /^\d+$/.test(cur) && src.slice(curStart, i) === cur) cur = null
      else finish(i)
      if (c === '<' && src[i + 1] === '<') {
        stop(i, 'Here-documents (<<) are not supported')
        break
      }
      if (c === '<' && src[i + 1] === '(') {
        stop(i, 'Process substitution <(…) is not supported')
        break
      }
      let j = i + 1
      while (j < n && (src[j] === '>' || src[j] === '&' || src[j] === '|')) j++
      redirect = src.slice(i, j)
      i = j
    } else {
      begin(i)
      let k = i + 1
      while (k < n && !` \t\r\n\\'"$\`|;&<>`.includes(src[k])) k++
      cur += src.slice(i, k)
      i = k
    }
  }
  finish(Math.min(i, n))
  if (redirect !== null) add('warn', `The redirect ${redirect} has no target and was ignored`)
  return { dialect: 'bash', tokens, notes }
}

/* ------------------------------------------------------------------ cmd */

/**
 * Two layers, as on Windows: cmd.exe removes carets (and would act on
 * unescaped & | < >), then the C runtime splits the remaining line into argv
 * at unquoted spaces, honouring "…" and backslash-quote escapes.
 *
 * Chrome and Firefox write every argument as ^"…^" after doubling every
 * backslash and turning " into \" (escapeStringWin in both). Backslash pairs
 * are therefore read back as one backslash wherever they are — the browsers'
 * meaning — rather than only before a quote, as the C runtime would.
 */
function tokenizeCmd(src: string): Tokenized {
  const { notes, add } = noteList()
  const n = src.length
  const chars: string[] = []
  const from: number[] = []
  const to: number[] = []
  const push = (c: string, start: number, end: number) => {
    chars.push(c)
    from.push(start)
    to.push(end)
  }

  let quoted = false
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === '^' && !quoted) {
      if (i + 1 >= n) {
        i++
      } else if (src[i + 1] === '\n') {
        // Caret-newline continues the line and takes the next character
        // literally — a space when joining lines, a newline for ^\n\n.
        if (i + 2 < n) push(src[i + 2], i, i + 3)
        i += 3
      } else {
        push(src[i + 1], i, i + 2)
        i += 2
      }
      continue
    }
    if (c === '"') {
      quoted = !quoted
      push(c, i, i + 1)
      i++
      continue
    }
    if (!quoted && (c === '&' || c === '|' || c === '<' || c === '>')) {
      const what = c === '|' ? 'A pipe (|)' : c === '&' ? 'An unescaped &' : `A redirect (${c})`
      add('warn', `${what} ends the curl command in cmd — not converted: “${snippet(src.slice(i))}”`)
      break
    }
    if (c === '\n' && !quoted) {
      const rest = src.slice(i + 1)
      if (rest.trim()) add('warn', `Only the first command is converted — the line does not end with ^, so cmd stops there; not converted: “${snippet(rest)}”`)
      break
    }
    if (c === '%') {
      let j = i + 1
      while (j < n && isNameChar(src[j])) j++
      if (j > i + 1 && src[j] === '%') add('warn', `Environment variable ${src.slice(i, j + 1)} is not expanded — it was kept as literal text`)
    }
    push(c, i, i + 1)
    i++
  }

  const tokens: Token[] = []
  let cur = null as string | null
  let first = 0
  let last = 0
  let inQuote = false
  const m = chars.length
  const begin = (k: number) => {
    if (cur === null) {
      cur = ''
      first = k
    }
  }
  const finish = () => {
    if (cur === null) return
    tokens.push({ value: cur, start: from[first], end: to[last] })
    cur = null
  }
  let k = 0
  while (k < m) {
    const c = chars[k]
    if ((c === ' ' || c === '\t' || c === '\n' || c === '\r') && !inQuote) {
      finish()
      k++
      continue
    }
    begin(k)
    if (c === '\\') {
      let j = k
      while (j < m && chars[j] === '\\') j++
      const run = j - k
      cur += '\\'.repeat(run >> 1)
      if (run & 1) {
        if (chars[j] === '"') {
          cur += '"'
          j++
        } else cur += '\\'
      }
      last = j - 1
      k = j
      continue
    }
    if (c === '"') {
      if (inQuote && chars[k + 1] === '"') {
        cur += '"'
        last = k + 1
        k += 2
        continue
      }
      inQuote = !inQuote
      last = k
      k++
      continue
    }
    cur += c
    last = k
    k++
  }
  if (inQuote) add('warn', 'A double quote is never closed — read to the end of the command')
  finish()
  return { dialect: 'cmd', tokens, notes }
}

/* --------------------------------------------------------------- quoting */

const SAFE_BASH = /^[A-Za-z0-9_@%+=:,./-]+$/

/** One bash word that reads back as `value`. */
export function quoteBash(value: string): string {
  if (value === '') return "''"
  if (SAFE_BASH.test(value)) return value
  // eslint-disable-next-line no-control-regex
  if (!/[\x00-\x1f\x7f']/.test(value)) return `'${value}'`
  let out = "$'"
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (ch === '\\') out += '\\\\'
    else if (ch === "'") out += "\\'"
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch === '!') out += '\\x21'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return `${out}'`
}

/** One cmd argument that reads back as `value` — Chrome's escapeStringWin, keeping CRs. */
export function quoteCmd(value: string): string {
  return `^"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[^a-zA-Z0-9\s_\-:=+~'/.,?;()*`]/g, '^$&')
    .replace(/%(?=[a-zA-Z0-9_])/g, '%^')
    .replace(/\n/g, '^\n\n')}^"`
}

export const quoteFor = (dialect: Dialect) => (dialect === 'cmd' ? quoteCmd : quoteBash)
