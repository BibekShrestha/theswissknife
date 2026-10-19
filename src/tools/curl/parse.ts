import { scanJson } from './json'
import { detectDialect, MAX_INPUT, normalizeInput, tokenize, type Dialect, type Note, type Token } from './tokenize'

/**
 * curl's command line → one HTTP request, with curl's own rules for what the
 * flags mean (method inference, default Content-Type, how -d pieces join,
 * which header wins). Flags that do not change the request are listed as
 * notes; flags that would change it but are not converted are warnings.
 */

export interface Header {
  name: string
  value: string
}

export interface FormPart {
  name: string
  /** Literal text, or the file path for 'file' and 'filetext'. */
  value: string
  /** -F name=@path uploads a file; -F name=<path sends a file's contents as a text field. */
  kind: 'text' | 'file' | 'filetext'
  filename?: string
  type?: string
}

export type Body =
  | { kind: 'text'; text: string }
  /** The whole body is one file: --data-binary @path, or -d @path (curl strips CR and LF). */
  | { kind: 'file'; path: string; stripNewlines: boolean }
  | { kind: 'form'; parts: FormPart[] }

export interface CurlRequest {
  method: string
  url: string
  /** Headers in the order given, after curl's precedence rules; curl's own defaults are not listed. */
  headers: Header[]
  /** Lower-cased names of headers removed with -H 'Name:' (curl then omits its own). */
  removed: string[]
  auth?: { user: string; password: string }
  body?: Body
  followRedirects: boolean
  insecure: boolean
  compressed: boolean
}

/** Where an option's value came from: tokens[token].value.slice(offset). */
export interface Arg {
  value: string
  token: number
  offset: number
}

export type DataKind = 'data' | 'raw' | 'binary' | 'urlencode' | 'json'

/** Every argument that can carry a credential, for the secrets scan. */
export interface Sources {
  urls: Arg[]
  headers: { arg: Arg; name: string; valueOffset: number }[]
  data: { arg: Arg; kind: DataKind }[]
  urlQuery: Arg[]
  forms: { arg: Arg; literal: boolean }[]
  user?: Arg
  bearer?: Arg
  /** Credentials in flags that are not converted (proxy, client certificate, key passphrase), by long name. */
  credentials: { arg: Arg; flag: CredentialFlag }[]
  /** -G moved the data into the query string. */
  get: boolean
}

export type Parsed =
  | { ok: true; dialect: Dialect; detected: Dialect; input: string; tokens: Token[]; notes: Note[]; request: CurlRequest; sources: Sources }
  | { ok: false; dialect: Dialect; detected: Dialect; input: string; tokens: Token[]; notes: Note[]; error: string }

type Action =
  | 'request' | 'header' | 'data' | 'data-ascii' | 'data-raw' | 'data-binary' | 'data-urlencode' | 'json'
  | 'form' | 'form-string' | 'user' | 'cookie' | 'user-agent' | 'referer' | 'url' | 'url-query' | 'oauth2-bearer'
  | 'get' | 'head' | 'location' | 'location-trusted' | 'insecure' | 'compressed' | 'globoff'

interface Spec {
  long: string
  arg: boolean
  /** handled: converted. ignored: no effect on the request. unsupported: changes the request, not converted. */
  kind: 'handled' | 'ignored' | 'unsupported'
}

const specs: Spec[] = []
const byLong = new Map<string, Spec>()
const byShort = new Map<string, Spec>()

function define(kind: Spec['kind'], arg: boolean, list: string) {
  for (const item of list.trim().split(/\s+/)) {
    const [long, short] = item.split('|')
    const spec = { long, arg, kind }
    specs.push(spec)
    byLong.set(long, spec)
    if (short) byShort.set(short, spec)
  }
}

define('handled', true, `
  request|X header|H data|d data-ascii data-raw data-binary data-urlencode json form|F form-string
  user|u cookie|b user-agent|A referer|e url url-query oauth2-bearer`)
define('handled', false, 'get|G head|I location|L location-trusted insecure|k compressed globoff|g')
define('ignored', false, `
  silent|s show-error|S verbose|v include|i fail|f fail-with-body fail-early progress-bar|# no-progress-meter
  no-buffer|N remote-name|O remote-name-all remote-header-name|J remote-time|R http1.1 http2 http2-prior-knowledge
  http3 http3-only ipv4|4 ipv6|6 path-as-is create-dirs raw tr-encoding tlsv1 tlsv1.0 tlsv1.1 tlsv1.2 tlsv1.3
  sslv2|2 sslv3|3 ssl ssl-reqd styled-output no-keepalive tcp-nodelay tcp-fastopen trace-time xattr basic
  retry-connrefused retry-all-errors show-headers disable|q no-sessionid no-alpn no-npn compressed-ssh
  ssl-allow-beast ssl-no-revoke ssl-revoke-best-effort ssl-auto-client-cert suppress-connect-headers
  disable-eprt disable-epsv ftp-pasv ftp-skip-pasv-ip ftp-create-dirs metalink manual|M help|h version|V`)
define('ignored', true, `
  output|o write-out|w max-time|m connect-timeout retry retry-delay retry-max-time max-redirs dump-header|D
  trace trace-ascii trace-config stderr limit-rate cookie-jar|c output-dir keepalive-time expect100-timeout
  happy-eyeballs-timeout-ms speed-time|y speed-limit|Y max-filesize interface local-port dns-servers
  dns-interface dns-ipv4-addr dns-ipv6-addr doh-url ciphers tls13-ciphers tls-max curves proto proto-default
  proto-redir rate parallel-max etag-save etag-compare libcurl create-file-mode`)
define('unsupported', false, `
  digest ntlm ntlm-wb negotiate anyauth netrc|n netrc-optional http1.0|0 proxy-insecure junk-session-cookies|j
  next|: parallel|Z use-ascii|B append|a crlf list-only|l proxy-anyauth proxy-basic proxy-digest proxy-ntlm
  proxy-negotiate proxytunnel|p ignore-content-length post301 post302 post303 doh-insecure ca-native
  proxy-ca-native haproxy-protocol sasl-ir`)
define('unsupported', true, `
  proxy|x proxy-user|U cacert capath cert|E key cert-type key-type pass resolve connect-to range|r
  continue-at|C upload-file|T config|K unix-socket abstract-unix-socket aws-sigv4 request-target socks4
  socks4a socks5 socks5-hostname preproxy noproxy time-cond|z variable quote|Q mail-from mail-rcpt mail-auth
  hostpubmd5 hostpubsha256 pinnedpubkey proxy-header telnet-option|t ftp-port|P netrc-file crlfile
  proxy-cacert proxy-capath proxy-cert proxy-key proxy-pass delegation login-options sasl-authzid
  service-name socks5-gssapi-service krb ftp-method ftp-account ftp-alternative-to-user ech ip-tos vlan-priority
  alt-svc hsts json-file engine random-file egd-file`)

/** fetch() normalises these to upper case; requests upper-cases every method. */
const standardMethods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])

const curlName = /^(?:.*[\\/])?curl(?:\.exe)?$/i

/**
 * Unconverted flags whose value can hold a credential. Their warnings name
 * the flag only (proxies: with any user:password@ masked), and the secrets
 * scan looks inside them.
 */
export type CredentialFlag = 'proxy-user' | 'cert' | 'proxy-cert' | 'pass' | 'proxy-pass' | 'proxy' | 'preproxy' | 'socks4' | 'socks4a' | 'socks5' | 'socks5-hostname' | 'proxy-header'
const credentialFlags = new Set<string>(['proxy-user', 'cert', 'proxy-cert', 'pass', 'proxy-pass', 'proxy', 'preproxy', 'socks4', 'socks4a', 'socks5', 'socks5-hostname', 'proxy-header'] satisfies CredentialFlag[])
const proxyFlags = new Set<string>(['proxy', 'preproxy', 'socks4', 'socks4a', 'socks5', 'socks5-hostname'])

/** A proxy given as [scheme://][user[:password]@]host: the userinfo part, if any. */
export function proxyUserinfo(value: string): { start: number; end: number } | undefined {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value)
  const start = scheme ? scheme[0].length : 0
  const authEnd = value.slice(start).search(/[/?#]/)
  const end = authEnd < 0 ? value.length : start + authEnd
  const at = value.lastIndexOf('@', end - 1)
  return at >= start ? { start, end: at } : undefined
}

/** curl_easy_escape: everything but A–Z a–z 0–9 - . _ ~ as %XX of the UTF-8 bytes. */
export function urlEncode(text: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(text)) {
    const c = String.fromCharCode(byte)
    out += /[A-Za-z0-9\-._~]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/**
 * Where --data-urlencode / --url-query split name from content: curl looks
 * for '=' first and only then for '@', so `a@b=c` is the name `a@b`.
 */
export function urlencodeSplit(value: string): number {
  const eq = value.indexOf('=')
  return eq >= 0 ? eq : value.indexOf('@')
}

/** --data-urlencode's forms: content, =content, name=content, @file, name@file. */
function encodeDataPiece(value: string): { text?: string; file?: string; name: string } {
  const at = urlencodeSplit(value)
  if (at < 0) return { text: urlEncode(value), name: '' }
  const name = value.slice(0, at)
  if (value[at] === '=') return { text: (name ? `${name}=` : '') + urlEncode(value.slice(at + 1)), name }
  return { file: value.slice(at + 1), name }
}

/** -F name=content[;type=…][;filename=…] — curl's formparse, simplified. */
function parseFormPart(value: string, literal: boolean): FormPart | string {
  const eq = value.indexOf('=')
  if (eq <= 0) return `-F ${value} has no name=content — ignored (curl refuses it)`
  const name = value.slice(0, eq)
  let rest = value.slice(eq + 1)
  if (literal) return { name, value: rest, kind: 'text' }
  let kind: FormPart['kind'] = 'text'
  if (rest.startsWith('@')) {
    kind = 'file'
    rest = rest.slice(1)
  } else if (rest.startsWith('<')) {
    kind = 'filetext'
    rest = rest.slice(1)
  }
  let content = ''
  let i = 0
  if (rest.startsWith('"')) {
    i = 1
    while (i < rest.length && rest[i] !== '"') {
      if (rest[i] === '\\' && (rest[i + 1] === '"' || rest[i + 1] === '\\')) i++
      content += rest[i]
      i++
    }
    i++
  } else {
    const params = /;\s*(?:type|filename|headers|encoder)=/i.exec(rest)
    i = params ? params.index : rest.length
    content = rest.slice(0, i)
  }
  const part: FormPart = { name, value: content, kind }
  for (const param of rest.slice(i).split(';')) {
    const match = /^\s*(type|filename|headers|encoder)=(.*)$/i.exec(param)
    if (!match) continue
    let v = match[2].trim()
    if (v.startsWith('"') && v.endsWith('"') && v.length > 1) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1')
    const key = match[1].toLowerCase()
    if (key === 'type') part.type = v
    else if (key === 'filename') part.filename = v
    else return `-F ${name}: ;${key}= is not converted`
  }
  return part
}

export interface UrlParts {
  scheme: string
  userinfo?: string
  host: string
  /** Path and query, as sent on the request line ("/" when empty). */
  target: string
  path: string
  query: string
  fragment: string
}

/** Splits an absolute URL as written, without normalising it the way `new URL` would. */
export function splitUrl(url: string): UrlParts {
  const schemeEnd = url.indexOf('://')
  const scheme = schemeEnd > 0 ? url.slice(0, schemeEnd).toLowerCase() : ''
  let rest = schemeEnd > 0 ? url.slice(schemeEnd + 3) : url
  let fragment = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
  }
  const authEnd = rest.search(/[/?]/)
  let authority = authEnd < 0 ? rest : rest.slice(0, authEnd)
  const pathQuery = authEnd < 0 ? '' : rest.slice(authEnd)
  let userinfo: string | undefined
  const at = authority.lastIndexOf('@')
  if (at >= 0) {
    userinfo = authority.slice(0, at)
    authority = authority.slice(at + 1)
  }
  const q = pathQuery.indexOf('?')
  const path = (q < 0 ? pathQuery : pathQuery.slice(0, q)) || '/'
  const query = q < 0 ? '' : pathQuery.slice(q + 1)
  return { scheme, userinfo, host: authority, path, query, fragment, target: path + (q < 0 ? '' : `?${query}`) }
}

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** name=value pairs of a query string or urlencoded body, decoded (+ as space). */
export function splitPairs(text: string): { name: string; value: string; raw: string }[] {
  if (!text) return []
  return text.split('&').map((raw) => {
    const eq = raw.indexOf('=')
    const name = eq < 0 ? raw : raw.slice(0, eq)
    const value = eq < 0 ? '' : raw.slice(eq + 1)
    return { name: safeDecode(name.replace(/\+/g, ' ')), value: safeDecode(value.replace(/\+/g, ' ')), raw }
  })
}

export function headerValue(headers: Header[], name: string): string | undefined {
  const lower = name.toLowerCase()
  return headers.find((header) => header.name.toLowerCase() === lower)?.value
}

/** curl unescapes \[ \] \{ \} in URLs and treats unescaped ones as a glob, unless -g. */
function unglob(url: string, add: (level: Note['level'], text: string) => void): string {
  let out = ''
  let glob = false
  for (let i = 0; i < url.length; i++) {
    const c = url[i]
    if (c === '\\' && '[]{}'.includes(url[i + 1] ?? '')) {
      out += url[i + 1]
      i++
    } else {
      if ('[]{}'.includes(c)) glob = true
      out += c
    }
  }
  if (glob) add('warn', 'The URL contains [ ] or { }, which curl expands as a glob (several URLs) unless -g/--globoff is given; converted as one literal URL')
  return out
}

export function parseCurl(rawInput: string, dialectChoice: Dialect | 'auto' = 'auto'): Parsed {
  const input = normalizeInput(rawInput)
  const detected = detectDialect(input)
  const dialect = dialectChoice === 'auto' ? detected : dialectChoice
  if (input.length > MAX_INPUT) {
    return { ok: false, dialect, detected, input, tokens: [], notes: [], error: `The command is ${(input.length / 1e6).toFixed(1)} MB; the limit is ${MAX_INPUT / 1e6} MB` }
  }
  const { tokens, notes } = tokenize(input, dialect)
  const seen = new Set(notes.map((note) => note.text))
  const add = (level: Note['level'], text: string) => {
    if (seen.has(text)) return
    seen.add(text)
    notes.push({ level, text })
  }
  const fail = (error: string): Parsed => ({ ok: false, dialect, detected, input, tokens, notes, error })

  if (!tokens.length) return fail('Paste a curl command')
  if (!curlName.test(tokens[0].value)) return fail(`Expected the command to start with curl, not “${tokens[0].value.slice(0, 40)}”`)

  const sources: Sources = { urls: [], headers: [], data: [], urlQuery: [], forms: [], credentials: [], get: false }
  const flags = { get: false, head: false, location: false, insecure: false, compressed: false, globoff: false }
  let method: string | undefined
  const custom: { name: string; value: string; removal: boolean }[] = []
  /** Header order as given: -H entries, and -A/-e/-b where they first appear. */
  const slots: (number | 'User-Agent' | 'Referer' | 'Cookie')[] = []
  const slotted = new Set<string>()
  const slot = (name: 'User-Agent' | 'Referer' | 'Cookie') => {
    if (slotted.has(name)) return
    slotted.add(name)
    slots.push(name)
  }
  const pushCustom = (header: { name: string; value: string; removal: boolean }) => {
    slots.push(custom.length)
    custom.push(header)
  }
  let userAgent: string | undefined
  let referer: string | undefined
  const cookies: string[] = []
  let bearer: string | undefined
  const ignored: string[] = []

  const apply = (spec: Spec, used: string, arg?: Arg) => {
    if (spec.kind === 'ignored') {
      ignored.push(used)
      return
    }
    if (spec.kind === 'unsupported') {
      let shown = arg?.value
      if (arg && credentialFlags.has(spec.long)) {
        sources.credentials.push({ arg, flag: spec.long as CredentialFlag })
        const colon = arg.value.indexOf(':')
        if (spec.long === 'proxy-header' && colon > 0) {
          let start = colon + 1
          while (arg.value[start] === ' ' || arg.value[start] === '\t') start++
          sources.headers.push({ arg, name: arg.value.slice(0, colon).trim(), valueOffset: start })
        }
        const userinfo = proxyFlags.has(spec.long) ? proxyUserinfo(arg.value) : undefined
        shown = !proxyFlags.has(spec.long) ? undefined : userinfo ? `${arg.value.slice(0, userinfo.start)}…${arg.value.slice(userinfo.end)}` : arg.value
      }
      add('warn', `${used}${shown !== undefined ? ` ${shown.length > 40 ? `${shown.slice(0, 37)}…` : shown}` : ''} changes the request but is not converted`)
      return
    }
    const action = spec.long as Action
    const value = arg?.value ?? ''
    switch (action) {
      case 'request':
        method = value
        break
      case 'header': {
        if (value.startsWith('@')) {
          add('warn', `-H ${value} reads headers from a file, which is not converted`)
          break
        }
        const colon = value.indexOf(':')
        if (colon < 0) {
          const semi = value.indexOf(';')
          if (semi > 0 && !value.slice(semi + 1).trim()) pushCustom({ name: value.slice(0, semi).trim(), value: '', removal: false })
          else add('warn', `-H ${value} has no colon, so curl ignores it`)
          break
        }
        const name = value.slice(0, colon).trim()
        let start = colon + 1
        while (value[start] === ' ' || value[start] === '\t') start++
        const headerValue = value.slice(start)
        if (!name) {
          add('warn', `-H ${value} has no header name — ignored`)
          break
        }
        pushCustom({ name, value: headerValue, removal: headerValue.trim() === '' })
        if (arg) sources.headers.push({ arg, name, valueOffset: start })
        break
      }
      case 'data':
      case 'data-ascii':
        sources.data.push({ arg: arg!, kind: 'data' })
        break
      case 'data-raw':
        sources.data.push({ arg: arg!, kind: 'raw' })
        break
      case 'data-binary':
        sources.data.push({ arg: arg!, kind: 'binary' })
        break
      case 'data-urlencode':
        sources.data.push({ arg: arg!, kind: 'urlencode' })
        break
      case 'json':
        sources.data.push({ arg: arg!, kind: 'json' })
        break
      case 'form':
      case 'form-string':
        sources.forms.push({ arg: arg!, literal: action === 'form-string' })
        break
      case 'user':
        sources.user = arg
        break
      case 'cookie':
        if (value.includes('=')) {
          cookies.push(value)
          slot('Cookie')
          sources.headers.push({ arg: arg!, name: 'Cookie', valueOffset: 0 })
        } else add('warn', `-b ${value} reads cookies from a file, which is not converted`)
        break
      case 'user-agent':
        userAgent = value
        slot('User-Agent')
        break
      case 'referer':
        slot('Referer')
        referer = value.endsWith(';auto') ? value.slice(0, -5) : value
        if (value.includes(';auto')) add('info', 'The ;auto part of -e (set Referer when following redirects) is not converted')
        if (arg) sources.headers.push({ arg, name: 'Referer', valueOffset: 0 })
        break
      case 'url':
        sources.urls.push(arg!)
        break
      case 'url-query':
        sources.urlQuery.push(arg!)
        break
      case 'oauth2-bearer':
        bearer = value
        sources.bearer = arg
        break
      case 'get':
        flags.get = true
        break
      case 'head':
        flags.head = true
        break
      case 'location':
        flags.location = true
        break
      case 'location-trusted':
        flags.location = true
        add('info', '--location-trusted is converted as -L; resending credentials to other hosts after a redirect is not')
        break
      case 'insecure':
        flags.insecure = true
        break
      case 'compressed':
        flags.compressed = true
        break
      case 'globoff':
        flags.globoff = true
        break
    }
  }

  const negate = (spec: Spec, used: string) => {
    const key = spec.long as keyof typeof flags
    if (spec.kind === 'handled' && key in flags) flags[key] = false
    else if (spec.kind === 'ignored') ignored.push(used)
    else add('warn', `${used} is not converted`)
  }

  for (let i = 1; i < tokens.length; i++) {
    const word = tokens[i].value
    const nextArg = (used: string): Arg | undefined => {
      if (i + 1 >= tokens.length) {
        add('warn', `${used} needs a value and has none`)
        return undefined
      }
      i++
      return { value: tokens[i].value, token: i, offset: 0 }
    }
    if (word.startsWith('--') && word.length > 2) {
      const name = word.slice(2)
      const spec = byLong.get(name)
      if (spec) {
        const arg = spec.arg ? nextArg(word) : undefined
        if (!spec.arg || arg) apply(spec, word, arg)
        continue
      }
      const negated = name.startsWith('no-') ? byLong.get(name.slice(3)) : undefined
      if (negated && !negated.arg) {
        negate(negated, word)
        continue
      }
      const eq = name.indexOf('=')
      if (eq > 0 && byLong.has(name.slice(0, eq))) add('warn', `curl does not accept ${word.slice(0, eq + 3)}… — write --${name.slice(0, eq)} followed by its value; ignored`)
      else add('warn', `Unknown option ${word} — ignored (if it takes a value, that value was read as a URL)`)
      continue
    }
    if (word.startsWith('-') && word.length > 1) {
      for (let j = 1; j < word.length; j++) {
        const letter = word[j]
        const spec = byShort.get(letter)
        if (!spec) {
          add('warn', `Unknown option -${letter} — ignored`)
          continue
        }
        if (!spec.arg) {
          apply(spec, `-${letter}`)
          continue
        }
        const arg = j + 1 < word.length ? { value: word.slice(j + 1), token: i, offset: j + 1 } : nextArg(`-${letter}`)
        if (arg) apply(spec, `-${letter}`, arg)
        break
      }
      continue
    }
    sources.urls.push({ value: word, token: i, offset: 0 })
  }

  if (ignored.length) add('info', `No effect on the request, so not converted: ${[...new Set(ignored)].join(' ')}`)

  if (!sources.urls.length) return fail('No URL found in the command')
  if (sources.urls.length > 1) add('warn', `curl would also request ${sources.urls.slice(1).map((arg) => arg.value).join(', ')}; only the first URL is converted`)

  // ---- URL
  let url = sources.urls[0].value
  if (!flags.globoff) url = unglob(url, add)
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = `http://${url}`
    add('info', 'The URL has no scheme; curl assumes http://')
  }
  let parts = splitUrl(url)
  if (parts.scheme !== 'http' && parts.scheme !== 'https') add('warn', `Only HTTP and HTTPS are converted; this URL is ${parts.scheme}://`)
  let auth: CurlRequest['auth']
  if (parts.userinfo !== undefined) {
    const colon = parts.userinfo.indexOf(':')
    const user = safeDecode(colon < 0 ? parts.userinfo : parts.userinfo.slice(0, colon))
    const password = colon < 0 ? '' : safeDecode(parts.userinfo.slice(colon + 1))
    auth = { user, password }
    url = url.replace(`${parts.userinfo}@`, '')
    add('info', 'The credentials in the URL become Basic auth, as curl sends them')
  }
  if (parts.fragment || url.endsWith('#')) {
    url = url.slice(0, url.indexOf('#'))
    add('info', 'The #fragment is not sent — curl drops it, and so does the converted code')
  }
  if (sources.user) {
    const value = sources.user.value
    const colon = value.indexOf(':')
    auth = { user: colon < 0 ? value : value.slice(0, colon), password: colon < 0 ? '' : value.slice(colon + 1) }
    if (colon < 0) add('warn', '-u has no password, so curl would prompt for one; converted with an empty password')
  }

  // ---- data
  const pieces: { text?: string; file?: string; name?: string; strip: boolean; kind: DataKind }[] = []
  for (const { arg, kind } of sources.data) {
    const value = arg.value
    if (kind === 'urlencode') {
      const piece = encodeDataPiece(value)
      pieces.push({ ...piece, strip: false, kind })
    } else if ((kind === 'data' || kind === 'binary' || kind === 'json') && value.startsWith('@')) {
      pieces.push({ file: value.slice(1), strip: kind === 'data', kind })
    } else pieces.push({ text: value, strip: false, kind })
  }
  const describeFile = (file: string) => (file === '-' ? 'standard input' : file)
  let body: Body | undefined
  if (pieces.length) {
    const onlyFile = pieces.length === 1 && pieces[0].file !== undefined && pieces[0].kind !== 'urlencode' && pieces[0].file !== '-'
    if (onlyFile) body = { kind: 'file', path: pieces[0].file!, stripNewlines: pieces[0].strip }
    else {
      let text = ''
      pieces.forEach((piece, index) => {
        if (index > 0 && piece.kind !== 'json') text += '&'
        if (piece.file !== undefined) {
          const label = `<contents of ${describeFile(piece.file)}>`
          text += piece.kind === 'urlencode' && piece.name ? `${piece.name}=${label}` : label
          add('warn', `curl reads data from ${describeFile(piece.file)}; the converted body has a <contents of …> placeholder there instead`)
        } else text += piece.text
      })
      body = { kind: 'text', text }
    }
  }
  if (sources.forms.length) {
    const formParts: FormPart[] = []
    for (const { arg, literal } of sources.forms) {
      const part = parseFormPart(arg.value, literal)
      if (typeof part === 'string') add('warn', part)
      else formParts.push(part)
    }
    if (body) add('warn', 'curl refuses to combine -d/--data with -F/--form; only the -F form was converted')
    body = { kind: 'form', parts: formParts }
  }

  if (flags.get && body) {
    if (body.kind === 'form') add('warn', 'curl refuses to combine -G with -F; the form was kept as the body')
    else {
      const text = body.kind === 'text' ? body.text : `<contents of ${body.path}>`
      url += (url.includes('?') ? '&' : '?') + text
      body = undefined
      sources.get = true
    }
  }
  for (const arg of sources.urlQuery) {
    const piece = arg.value.startsWith('+') ? { text: arg.value.slice(1), name: '' } : encodeDataPiece(arg.value)
    const text = piece.text ?? `${piece.name ? `${piece.name}=` : ''}<contents of ${piece.file}>`
    if (piece.file !== undefined) add('warn', `--url-query reads ${piece.file}; the query has a <contents of …> placeholder there instead`)
    url += (url.includes('?') ? '&' : '?') + text
  }
  parts = splitUrl(url)

  // ---- method
  const inferred = flags.head ? 'HEAD' : body ? 'POST' : 'GET'
  const finalMethod = method ?? inferred
  if (method && flags.head && method !== 'HEAD') add('warn', `-X ${method} with -I sends ${method} but curl still expects no response body`)
  if (method === 'HEAD' && !flags.head) add('warn', 'curl -X HEAD waits for a response body that never comes; -I is the way to send HEAD')
  if (method && method !== method.toUpperCase()) {
    const upper = method.toUpperCase()
    add('warn', `-X ${method}: curl sends the method exactly as written, and servers may treat method names case-sensitively; ${standardMethods.has(upper) ? 'Python requests and fetch() send' : 'Python requests sends'} ${upper} instead`)
  }
  if (flags.head && body) add('warn', 'curl refuses to combine -I with request data')

  // ---- headers: curl's own (-A -e -b --oauth2-bearer, then data defaults) give way to -H
  const customNames = new Set(custom.map((header) => header.name.toLowerCase()))
  const headers: Header[] = []
  let agentRemoved = false
  const overridden = (name: string, flag: string) => {
    if (!customNames.has(name.toLowerCase())) return false
    add('info', `-H ${name} takes precedence over ${flag}`)
    return true
  }
  if (bearer !== undefined && !overridden('Authorization', '--oauth2-bearer')) headers.push({ name: 'Authorization', value: `Bearer ${bearer}` })
  for (const item of slots) {
    if (typeof item === 'number') {
      const header = custom[item]
      if (!header.removal) headers.push({ name: header.name, value: header.value })
    } else if (item === 'User-Agent' && userAgent !== undefined && !overridden('User-Agent', '-A')) {
      // curl: an empty -A removes the header; a single space sends a blank one.
      if (userAgent === '') agentRemoved = true
      else headers.push({ name: 'User-Agent', value: userAgent })
    }
    else if (item === 'Referer' && referer !== undefined && !overridden('Referer', '-e')) headers.push({ name: 'Referer', value: referer })
    else if (item === 'Cookie' && !overridden('Cookie', '-b')) headers.push({ name: 'Cookie', value: cookies.join('; ') })
  }
  const isJson = sources.data.some((piece) => piece.kind === 'json')
  if (body && body.kind !== 'form' && !customNames.has('content-type')) {
    headers.push({ name: 'Content-Type', value: isJson ? 'application/json' : 'application/x-www-form-urlencoded' })
  }
  if (isJson && body && !customNames.has('accept')) headers.push({ name: 'Accept', value: 'application/json' })
  if (auth && (customNames.has('authorization') || bearer !== undefined)) {
    add('info', customNames.has('authorization') ? '-H Authorization takes precedence over -u' : '--oauth2-bearer takes precedence over -u')
    auth = undefined
  }
  const removed = [...new Set([...custom.filter((header) => header.removal).map((header) => header.name.toLowerCase()), ...(agentRemoved ? ['user-agent'] : [])])]

  if (body?.kind === 'text' && headerValue(headers, 'content-type') === 'application/x-www-form-urlencoded' && /^\s*[{[]/.test(body.text) && scanJson(body.text)) {
    add('info', 'The body is JSON but is sent as application/x-www-form-urlencoded (curl’s -d default); add -H \'Content-Type: application/json\' or use --json if the server expects JSON')
  }

  return {
    ok: true,
    dialect,
    detected,
    input,
    tokens,
    notes,
    sources,
    request: {
      method: finalMethod,
      url,
      headers,
      removed,
      auth,
      body,
      followRedirects: flags.location,
      insecure: flags.insecure,
      compressed: flags.compressed,
    },
  }
}

export const allSpecs = specs
