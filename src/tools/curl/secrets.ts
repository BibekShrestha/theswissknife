import { stringMembers } from './json'
import { headerValue, type Arg, type Parsed } from './parse'
import { quoteFor, type Token } from './tokenize'

/**
 * Finds credentials in a parsed command and rewrites the command with
 * placeholders. Spans point into the tokenizer's words, so the rewrite
 * re-quotes only the words that held a secret and leaves the rest of the
 * pasted text as it was; every generated output then follows from it.
 */

export interface Secret {
  /** Where it was found, for people: "Header authorization", "Query access_token". */
  label: string
  value: string
  placeholder: string
  token: number
  /** Span in tokens[token].value. */
  start: number
  end: number
}

type Found = Omit<Secret, 'placeholder'> & { base: string }

const PLACEHOLDER = /^<[A-Z0-9_]+>$/
/** Enough for any real request; keeps the overlap checks and the panel bounded on hostile input. */
export const MAX_SECRETS = 500
const JWT = /^eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/
const SECRET_WORD = /(?:^|[-_.\s[\]])(?:token|tokens|key|apikey|sig|signature|password|passwd|pwd|pass|secret|auth|credential|credentials|session|sessionid|session_id|sid|jwt|bearer|otp|csrftoken)$/

/** accessToken → access_token; X-Amz-Signature → x-amz-signature. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

export const isSecretName = (name: string) => SECRET_WORD.test(words(name.trim()))

function isSecretHeader(name: string) {
  const lower = name.toLowerCase()
  return !lower.startsWith('sec-') && isSecretName(lower)
}

const baseName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SECRET'

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    return text
  }
}

export function findSecrets(parsed: Parsed): Secret[] {
  if (!parsed.ok) return []
  const { sources, tokens } = parsed
  const found: Found[] = []
  const push = (arg: Arg, start: number, end: number, label: string, base: string) => {
    if (found.length >= MAX_SECRETS) return
    const value = arg.value.slice(start, end)
    if (!value || PLACEHOLDER.test(value)) return
    found.push({ label, value, token: arg.token, start: arg.offset + start, end: arg.offset + end, base })
  }

  /** name=value&… inside arg.value[from, to). */
  const pairs = (arg: Arg, from: number, to: number, where: string, all = false) => {
    let at = from
    while (at <= to) {
      let amp = arg.value.indexOf('&', at)
      if (amp < 0 || amp > to) amp = to
      const eq = arg.value.indexOf('=', at)
      if (eq >= 0 && eq < amp) {
        const name = safeDecode(arg.value.slice(at, eq))
        const value = arg.value.slice(eq + 1, amp)
        if (all || isSecretName(name) || JWT.test(safeDecode(value))) push(arg, eq + 1, amp, `${where} ${name}`, name)
      }
      at = amp + 1
    }
  }

  const json = (arg: Arg, where: string) => {
    for (const member of stringMembers(arg.value)) {
      const value = arg.value.slice(member.start, member.end)
      if (isSecretName(member.key) || JWT.test(value)) push(arg, member.start, member.end, `${where} ${member.key}`, member.key)
    }
  }

  // ---- URLs: user:password@ and query parameters
  for (const arg of sources.urls.slice(0, 1)) {
    const value = arg.value
    const scheme = value.indexOf('://')
    const authStart = scheme > 0 ? scheme + 3 : 0
    let authEnd = value.slice(authStart).search(/[/?#]/)
    authEnd = authEnd < 0 ? value.length : authStart + authEnd
    const at = value.lastIndexOf('@', authEnd - 1)
    if (at >= authStart) {
      const colon = value.indexOf(':', authStart)
      if (colon >= 0 && colon < at) {
        push(arg, authStart, colon, 'URL user', 'USER')
        push(arg, colon + 1, at, 'URL password', 'PASSWORD')
      } else push(arg, authStart, at, 'URL user', 'USER')
    }
    const q = value.indexOf('?', authEnd)
    if (q >= 0) {
      const hash = value.indexOf('#', q)
      pairs(arg, q + 1, hash < 0 ? value.length : hash, 'Query')
    }
  }
  for (const arg of sources.urlQuery) pairs(arg, arg.value.startsWith('+') ? 1 : 0, arg.value.length, 'Query')

  // ---- -u and --oauth2-bearer
  if (sources.user) {
    const value = sources.user.value
    const colon = value.indexOf(':')
    if (colon < 0) push(sources.user, 0, value.length, '-u user', 'USER')
    else {
      push(sources.user, 0, colon, '-u user', 'USER')
      push(sources.user, colon + 1, value.length, '-u password', 'PASSWORD')
    }
  }
  if (sources.bearer) push(sources.bearer, 0, sources.bearer.value.length, '--oauth2-bearer', 'TOKEN')

  // ---- headers, -b, -e
  for (const { arg, name, valueOffset } of sources.headers) {
    const lower = name.toLowerCase()
    const value = arg.value
    if (lower === 'authorization' || lower === 'proxy-authorization') {
      const scheme = /^(\S+)[ \t]+(?=\S)/.exec(value.slice(valueOffset))
      const prefix = lower === 'proxy-authorization' ? 'PROXY_' : ''
      if (scheme) {
        const kind = scheme[1].toLowerCase()
        push(arg, valueOffset + scheme[0].length, value.length, `Header ${name} (${scheme[1]})`, prefix + (kind === 'bearer' ? 'TOKEN' : kind === 'basic' ? 'BASIC_CREDENTIALS' : 'CREDENTIALS'))
      } else push(arg, valueOffset, value.length, `Header ${name}`, prefix + 'AUTHORIZATION')
    } else if (lower === 'cookie') {
      let at = valueOffset
      while (at < value.length) {
        let semi = value.indexOf(';', at)
        if (semi < 0) semi = value.length
        const eq = value.indexOf('=', at)
        if (eq >= 0 && eq < semi) {
          const cookie = value.slice(at, eq).trim()
          push(arg, eq + 1, semi, `Cookie ${cookie}`, cookie)
        }
        at = semi + 1
      }
    } else if (lower === 'referer') {
      const q = value.indexOf('?')
      if (q >= 0) {
        const hash = value.indexOf('#', q)
        pairs(arg, q + 1, hash < 0 ? value.length : hash, 'Referer query')
      }
    } else if (isSecretHeader(name) || JWT.test(value.slice(valueOffset).trim())) {
      push(arg, valueOffset, value.length, `Header ${name}`, name)
    }
  }

  // ---- bodies
  const contentType = parsed.request.headers && headerValue(parsed.request.headers, 'content-type')
  const boundary = contentType ? /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType) : null
  for (const { arg, kind } of sources.data) {
    const value = arg.value
    if (value.startsWith('@') && kind !== 'raw' && kind !== 'urlencode') continue
    const where = sources.get ? 'Query' : 'Body'
    if (kind === 'urlencode') {
      const at = value.search(/[=@]/)
      if (at > 0 && value[at] === '=' && isSecretName(value.slice(0, at))) push(arg, at + 1, value.length, `${where} ${value.slice(0, at)}`, value.slice(0, at))
    } else if (/^\s*[{[]/.test(value)) json(arg, 'JSON')
    else if (boundary) multipart(arg, boundary[1] ?? boundary[2], push)
    else if (!/\s/.test(value) && value.includes('=')) pairs(arg, 0, value.length, where)
  }
  for (const { arg, literal } of sources.forms) {
    const value = arg.value
    const eq = value.indexOf('=')
    if (eq <= 0) continue
    const name = value.slice(0, eq)
    const rest = value.slice(eq + 1)
    if (!literal && (rest.startsWith('@') || rest.startsWith('<'))) continue
    if (!isSecretName(name) && !JWT.test(rest)) continue
    if (!literal && rest.startsWith('"')) {
      const close = rest.indexOf('"', 1)
      push(arg, eq + 2, eq + 1 + (close < 0 ? rest.length : close), `Form ${name}`, name)
    } else {
      const params = literal ? null : /;\s*(?:type|filename|headers|encoder)=/i.exec(rest)
      push(arg, eq + 1, eq + 1 + (params ? params.index : rest.length), `Form ${name}`, name)
    }
  }

  return finish(found, tokens)
}

/** Raw multipart bodies (what browsers copy for FormData): fields whose name looks secret. */
function multipart(arg: Arg, boundary: string, push: (arg: Arg, start: number, end: number, label: string, base: string) => void) {
  const value = arg.value
  const delimiter = `--${boundary}`
  let at = value.indexOf(delimiter)
  while (at >= 0) {
    const headStart = at + delimiter.length
    const next = value.indexOf(delimiter, headStart)
    if (next < 0) break
    const section = value.slice(headStart, next)
    const split = section.search(/\r?\n\r?\n/)
    if (split >= 0) {
      const head = section.slice(0, split)
      const name = /name="([^"]*)"/i.exec(head)?.[1]
      const isFile = /filename=/i.test(head)
      const sep = /\r?\n\r?\n/.exec(section.slice(split))![0].length
      const contentStart = headStart + split + sep
      let contentEnd = next
      if (value.slice(contentEnd - 2, contentEnd) === '\r\n') contentEnd -= 2
      else if (value[contentEnd - 1] === '\n') contentEnd -= 1
      if (name && !isFile && (isSecretName(name) || JWT.test(value.slice(contentStart, contentEnd)))) push(arg, contentStart, contentEnd, `Form ${name}`, name)
    }
    at = next
  }
}

/** Drops overlaps, assigns placeholders (one per distinct value), and catches repeats elsewhere in the command. */
function finish(found: Found[], tokens: Token[]): Secret[] {
  const byToken = new Map<number, Found[]>()
  const keep: Found[] = []
  const overlaps = (item: { token: number; start: number; end: number }) =>
    (byToken.get(item.token) ?? []).some((other) => item.start < other.end && other.start < item.end)
  const accept = (item: Found) => {
    if (keep.length >= MAX_SECRETS || overlaps(item)) return
    keep.push(item)
    const list = byToken.get(item.token) ?? []
    list.push(item)
    byToken.set(item.token, list)
  }
  found.forEach(accept)

  // The same value in another word (a token in the Referer, a cookie echoed in a header).
  const distinct = [...new Map(keep.map((item) => [item.value, item])).values()].filter((item) => item.value.length >= 8).slice(0, 50)
  for (const item of distinct) {
    tokens.forEach((token, index) => {
      if (index === 0) return
      let at = token.value.indexOf(item.value)
      while (at >= 0 && keep.length < MAX_SECRETS) {
        accept({ label: `Same value as ${item.label}`, value: item.value, token: index, start: at, end: at + item.value.length, base: item.base })
        at = token.value.indexOf(item.value, at + item.value.length)
      }
    })
  }

  keep.sort((a, b) => a.token - b.token || a.start - b.start)
  const byValue = new Map<string, string>()
  const used = new Set<string>()
  const secrets = keep.map((item) => {
    let placeholder = byValue.get(item.value)
    if (!placeholder) {
      const base = baseName(item.base)
      let candidate = `<${base}>`
      for (let n = 2; used.has(candidate); n++) candidate = `<${base}_${n}>`
      placeholder = candidate
      used.add(placeholder)
      byValue.set(item.value, placeholder)
    }
    const { base: _base, ...rest } = item
    void _base
    return { ...rest, placeholder }
  })
  return secrets
}

/** The input with every secret replaced; only the words that held one are re-quoted. */
export function redactInput(parsed: Parsed, secrets: Secret[]): string {
  const { input, tokens, dialect } = parsed
  const quote = quoteFor(dialect)
  const byToken = new Map<number, Secret[]>()
  for (const secret of secrets) {
    const list = byToken.get(secret.token) ?? []
    list.push(secret)
    byToken.set(secret.token, list)
  }
  const edits = [...byToken.entries()].map(([index, list]) => {
    const token = tokens[index]
    let value = token.value
    const parts: string[] = []
    let at = 0
    for (const secret of [...list].sort((a, b) => a.start - b.start)) {
      parts.push(value.slice(at, secret.start), secret.placeholder)
      at = secret.end
    }
    parts.push(value.slice(at))
    value = parts.join('')
    return { start: token.start, end: token.end, text: quote(value) }
  })
  const pieces: string[] = []
  let at = 0
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    pieces.push(input.slice(at, edit.start), edit.text)
    at = edit.end
  }
  pieces.push(input.slice(at))
  return pieces.join('')
}

/** For the panel: enough of the value to recognise it, not enough to use it. */
export function maskValue(value: string): string {
  if (value.length <= 8) return '•'.repeat(value.length)
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}

