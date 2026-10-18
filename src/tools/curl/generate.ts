import { exactJsonValue } from './json'
import { headerValue, splitUrl, type CurlRequest, type FormPart, type Header } from './parse'
import { quoteBash } from './tokenize'

/**
 * One request → code. Every generator sends the body exactly as curl would:
 * a JSON body is printed as a literal only when serialising it back gives
 * the same bytes (see exactJsonValue); otherwise it stays a string.
 */

export type Target = 'fetch' | 'python' | 'go' | 'raw' | 'curl'

export const targets: { id: Target; label: string; language: string }[] = [
  { id: 'fetch', label: 'fetch', language: 'JavaScript' },
  { id: 'python', label: 'Python', language: 'Python requests' },
  { id: 'go', label: 'Go', language: 'Go net/http' },
  { id: 'raw', label: 'HTTP', language: 'Raw HTTP/1.1' },
  { id: 'curl', label: 'curl', language: 'curl (bash)' },
]

export function generate(target: Target, request: CurlRequest): string {
  switch (target) {
    case 'fetch': return toFetch(request)
    case 'python': return toPython(request)
    case 'go': return toGo(request)
    case 'raw': return toRawHttp(request)
    case 'curl': return toCurl(request)
  }
}

/* ------------------------------------------------------------ literals */

const hex = (code: number, width: number) => code.toString(16).padStart(width, '0')

function escapeWith(s: string, quote: string, lone: (code: number) => string, extra?: (code: number) => string | undefined): string {
  let out = quote
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const code = s.charCodeAt(i)
    const special = extra?.(code)
    if (special !== undefined) out += special
    else if (c === '\\') out += '\\\\'
    else if (c === quote) out += `\\${quote}`
    else if (c === '\n') out += '\\n'
    else if (c === '\r') out += '\\r'
    else if (c === '\t') out += '\\t'
    else if (code < 0x20 || code === 0x7f) out += `\\x${hex(code, 2)}`
    else if (code >= 0xd800 && code <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      out += c + s[i + 1]
      i++
    } else if (code >= 0xd800 && code <= 0xdfff) out += lone(code)
    else out += c
  }
  return out + quote
}

export const jsString = (s: string) =>
  escapeWith(s, "'", (code) => `\\u${hex(code, 4)}`, (code) => (code === 0x2028 || code === 0x2029 ? `\\u${hex(code, 4)}` : undefined))
export const pyString = (s: string) => escapeWith(s, "'", (code) => `\\u${hex(code, 4)}`)
/** Go source cannot hold a lone surrogate; it becomes U+FFFD, as Go's UTF-8 encoding would make it. */
export const goString = (s: string) => escapeWith(s, '"', () => '\\uFFFD')

/** A Go raw string when the text allows one (no backtick; raw strings drop CRs). */
const goBody = (s: string) => (s.includes('"') && !/[`\r]/.test(s) && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s) && !/[\ud800-\udfff]/.test(s) ? `\`${s}\`` : goString(s))

const utf8 = (s: string) => new TextEncoder().encode(s)
const base64 = (s: string) => {
  let binary = ''
  for (const byte of utf8(s)) binary += String.fromCharCode(byte)
  return btoa(binary)
}
// eslint-disable-next-line no-control-regex
const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s)

interface LiteralStyle { quote: (s: string) => string; t: string; f: string; n: string; unit: string }

function jsLiteral(value: unknown, depth: number, style: LiteralStyle): string {
  const pad = style.unit.repeat(depth + 1)
  const close = style.unit.repeat(depth)
  const { quote } = style
  const words = style
  if (value === null) return words.n
  if (value === true) return words.t
  if (value === false) return words.f
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map((item) => pad + jsLiteral(item, depth + 1, style)).join(',\n')},\n${close}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length) return '{}'
  return `{\n${entries.map(([key, item]) => `${pad}${quote(key)}: ${jsLiteral(item, depth + 1, style)}`).join(',\n')},\n${close}}`
}

const indentAfterFirst = (text: string, pad: string) => text.replace(/\n/g, `\n${pad}`)

/* ------------------------------------------------------------- helpers */

function hasDuplicates(headers: Header[]) {
  const names = headers.map((header) => header.name.toLowerCase())
  return new Set(names).size !== names.length
}

/** Fetch spec forbidden request headers: a page's fetch() silently drops these. */
function forbidden(name: string) {
  const lower = name.toLowerCase()
  return lower.startsWith('sec-') || lower.startsWith('proxy-') || [
    'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
    'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
    'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
  ].includes(lower)
}

/** Custom multipart Content-Type headers are dropped: FormData-style encoders set their own boundary. */
function codeHeaders(request: CurlRequest): { headers: Header[]; droppedMultipartType: boolean } {
  const multipart = request.body?.kind === 'form'
  let droppedMultipartType = false
  const headers = request.headers.filter((header) => {
    const drop = multipart && header.name.toLowerCase() === 'content-type' && /^multipart\/form-data/i.test(header.value)
    if (drop) droppedMultipartType = true
    return !drop
  })
  return { headers, droppedMultipartType }
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || path

/* --------------------------------------------------------------- fetch */

export function toFetch(request: CurlRequest): string {
  const { headers, droppedMultipartType } = codeHeaders(request)
  const imports = new Set<string>()
  const before: string[] = []
  const comments: string[] = []
  const options: string[] = []
  if (request.method !== 'GET') options.push(`method: ${jsString(request.method)},`)

  const pairs: [string, string][] = []
  if (request.auth) {
    const pair = `${request.auth.user}:${request.auth.password}`
    pairs.push(["'Authorization'", /^[\x20-\x7e]*$/.test(pair) ? `'Basic ' + btoa(${jsString(pair)})` : jsString(`Basic ${base64(pair)}`)])
  }
  for (const header of headers) pairs.push([jsString(header.name), jsString(header.value)])
  if (pairs.length) {
    const duplicate = hasDuplicates(headers)
    if (duplicate) comments.push('// fetch joins repeated headers into one, comma-separated')
    const lines = pairs.map(([name, value]) => (duplicate ? `[${name}, ${value}],` : `${name}: ${value},`))
    options.push(`headers: ${duplicate ? '[' : '{'}\n    ${lines.join('\n    ')}\n  ${duplicate ? ']' : '}'},`)
  }
  const blocked = [...new Set(headers.filter((header) => forbidden(header.name)).map((header) => header.name.toLowerCase()))]
  if (blocked.length) comments.push(`// In a browser, fetch() silently drops forbidden headers: ${blocked.join(', ')}`)
  if (droppedMultipartType) comments.push('// Content-Type is left to FormData, which adds the multipart boundary')

  const body = request.body
  if (body?.kind === 'text') {
    const value = exactJsonValue(body.text)
    options.push(value !== undefined
      ? `body: JSON.stringify(${indentAfterFirst(jsLiteral(value, 0, { quote: (s) => JSON.stringify(s), t: 'true', f: 'false', n: 'null', unit: '  ' }), '  ')}),`
      : `body: ${jsString(body.text)},`)
  } else if (body?.kind === 'file') {
    imports.add("import { readFile } from 'node:fs/promises';")
    options.push(body.stripNewlines
      ? `body: (await readFile(${jsString(body.path)}, 'utf8')).replace(/[\\r\\n]/g, ''), // curl -d strips CR and LF`
      : `body: await readFile(${jsString(body.path)}),`)
  } else if (body?.kind === 'form') {
    before.push('const form = new FormData();')
    for (const part of body.parts) {
      if (part.kind === 'text') {
        before.push(part.type
          ? `form.append(${jsString(part.name)}, new Blob([${jsString(part.value)}], { type: ${jsString(part.type)} }));`
          : `form.append(${jsString(part.name)}, ${jsString(part.value)});`)
      } else if (part.kind === 'filetext') {
        imports.add("import { readFile } from 'node:fs/promises';")
        before.push(`form.append(${jsString(part.name)}, await readFile(${jsString(part.value)}, 'utf8'));`)
      } else {
        imports.add("import { openAsBlob } from 'node:fs';")
        const typeArg = part.type ? `, { type: ${jsString(part.type)} }` : ''
        before.push(`form.append(${jsString(part.name)}, await openAsBlob(${jsString(part.value)}${typeArg}), ${jsString(part.filename ?? fileName(part.value))});`)
      }
    }
    options.push('body: form,')
  }
  if (body && (request.method === 'GET' || request.method === 'HEAD')) comments.push(`// fetch() throws on a ${request.method} request with a body; curl sends it anyway`)
  if (!request.followRedirects) options.push("redirect: 'manual', // curl does not follow redirects without -L")
  if (request.insecure) comments.push('// curl -k skips certificate checks; fetch() has no option for that')

  const lines: string[] = []
  if (imports.size) lines.push(...[...imports].sort(), '')
  if (comments.length) lines.push(...comments)
  if (before.length) lines.push(...before, '')
  lines.push(options.length
    ? `const response = await fetch(${jsString(request.url)}, {\n  ${options.join('\n  ')}\n});`
    : `const response = await fetch(${jsString(request.url)});`)
  lines.push('', 'console.log(response.status);', 'console.log(await response.text());')
  return lines.join('\n') + '\n'
}

/* -------------------------------------------------------------- Python */

const pyMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export function toPython(request: CurlRequest): string {
  const { headers, droppedMultipartType } = codeHeaders(request)
  const imports = ['import requests']
  const blocks: string[] = []
  const args: string[] = [pyString(request.url)]

  if (headers.length) {
    const merged = new Map<string, Header>()
    let joined = false
    for (const header of headers) {
      const key = header.name.toLowerCase()
      const existing = merged.get(key)
      if (existing) {
        existing.value += key === 'cookie' ? `; ${header.value}` : `, ${header.value}`
        joined = true
      } else merged.set(key, { ...header })
    }
    const lines = [...merged.values()].map((header) => `    ${pyString(header.name)}: ${pyString(header.value)},`)
    blocks.push(`${joined ? '# requests sends each header once, so repeated ones are joined\n' : ''}${droppedMultipartType ? '# Content-Type is left to requests, which adds the multipart boundary\n' : ''}headers = {\n${lines.join('\n')}\n}`)
    args.push('headers=headers')
  } else if (droppedMultipartType) blocks.push('# Content-Type is left to requests, which adds the multipart boundary')

  if (request.auth) {
    const { user, password } = request.auth
    // requests encodes auth as Latin-1; anything else goes in as a header.
    if (isAscii(user + password)) args.push(`auth=(${pyString(user)}, ${pyString(password)})`)
    else {
      blocks.push(`headers = {**${headers.length ? 'headers' : '{}'}, 'Authorization': ${pyString(`Basic ${base64(`${user}:${password}`)}`)}}`)
      if (!headers.length) args.push('headers=headers')
    }
  }

  const body = request.body
  if (body?.kind === 'text') {
    const value = isAscii(body.text) ? exactJsonValue(body.text) : undefined
    if (value !== undefined) {
      imports.push('import json')
      blocks.push(`json_data = ${jsLiteral(value, 0, { quote: pyString, t: 'True', f: 'False', n: 'None', unit: '    ' })}`)
      args.push("data=json.dumps(json_data, separators=(',', ':'))")
    } else {
      // http.client would encode a str body as Latin-1; send UTF-8 bytes instead.
      blocks.push(`data = ${pyString(body.text)}${isAscii(body.text) ? '' : ".encode('utf-8')"}`)
      args.push('data=data')
    }
  } else if (body?.kind === 'file') {
    blocks.push(`with open(${pyString(body.path)}, 'rb') as f:\n    data = f.read()${body.stripNewlines ? ".replace(b'\\r', b'').replace(b'\\n', b'')  # curl -d strips CR and LF" : ''}`)
    args.push('data=data')
  } else if (body?.kind === 'form') {
    const lines = body.parts.map((part) => {
      if (part.kind === 'text') return `    (${pyString(part.name)}, (None, ${pyString(part.value)}${part.type ? `, ${pyString(part.type)}` : ''})),`
      if (part.kind === 'filetext') return `    (${pyString(part.name)}, (None, open(${pyString(part.value)}, 'rb').read()${part.type ? `, ${pyString(part.type)}` : ''})),`
      return `    (${pyString(part.name)}, (${pyString(part.filename ?? fileName(part.value))}, open(${pyString(part.value)}, 'rb')${part.type ? `, ${pyString(part.type)}` : ''})),`
    })
    blocks.push(`files = [\n${lines.join('\n')}\n]`)
    args.push('files=files')
  }

  if (request.insecure) args.push('verify=False')
  const lower = request.method.toLowerCase()
  const known = pyMethods.has(request.method)
  // requests follows redirects except for head(); curl only with -L.
  if (request.method === 'HEAD' && known) {
    if (request.followRedirects) args.push('allow_redirects=True')
  } else if (!request.followRedirects) args.push('allow_redirects=False')

  const call = known ? `requests.${lower}(` : `requests.request(\n    ${pyString(request.method)},`
  const lines = [...imports, '', ...blocks.flatMap((block) => [block, '']), `response = ${call}\n    ${args.join(',\n    ')},\n)`, '', 'print(response.status_code)', 'print(response.text)']
  return lines.join('\n') + '\n'
}

/* ------------------------------------------------------------------ Go */

export function toGo(request: CurlRequest): string {
  const { headers, droppedMultipartType } = codeHeaders(request)
  const imports = new Set(['fmt', 'io', 'log', 'net/http'])
  const pre: string[] = []
  let bodyExpr = 'nil'
  const body = request.body

  if (body?.kind === 'text') {
    imports.add('strings')
    bodyExpr = `strings.NewReader(${goBody(body.text)})`
  } else if (body?.kind === 'file') {
    imports.add('os')
    if (body.stripNewlines) {
      imports.add('bytes')
      pre.push(`data, err := os.ReadFile(${goString(body.path)})\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\t// curl -d strips CR and LF\n\tdata = bytes.ReplaceAll(bytes.ReplaceAll(data, []byte("\\r"), nil), []byte("\\n"), nil)`)
      bodyExpr = 'bytes.NewReader(data)'
    } else {
      pre.push(`file, err := os.Open(${goString(body.path)})\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer file.Close()`)
      bodyExpr = 'file'
    }
  } else if (body?.kind === 'form') {
    imports.add('bytes')
    imports.add('mime/multipart')
    const lines = ['var body bytes.Buffer', 'form := multipart.NewWriter(&body)']
    const part = (p: FormPart) => {
      if (p.kind === 'text' && !p.type) return [`form.WriteField(${goString(p.name)}, ${goString(p.value)})`]
      const out: string[] = []
      imports.add('net/textproto')
      const disposition = `form-data; name="${p.name.replace(/["\\]/g, '\\$&')}"${p.kind === 'file' ? `; filename="${(p.filename ?? fileName(p.value)).replace(/["\\]/g, '\\$&')}"` : ''}`
      const type = p.type ?? (p.kind === 'file' ? 'application/octet-stream' : undefined)
      out.push('{')
      out.push(`\tpart, err := form.CreatePart(textproto.MIMEHeader{\n\t\t\t"Content-Disposition": {${goString(disposition)}},${type ? `\n\t\t\t"Content-Type":        {${goString(type)}},` : ''}\n\t\t})`)
      out.push('\tif err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}')
      if (p.kind === 'text') out.push(`\tpart.Write([]byte(${goString(p.value)}))`)
      else {
        imports.add('os')
        out.push(`\tfile, err := os.Open(${goString(p.value)})\n\t\tif err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}\n\t\tio.Copy(part, file)\n\t\tfile.Close()`)
      }
      out.push('}')
      return out
    }
    for (const p of body.parts) lines.push(...part(p))
    lines.push('form.Close()')
    pre.push(lines.join('\n\t'))
    bodyExpr = '&body'
  }

  const lines: string[] = []
  lines.push(...pre)
  lines.push(`req, err := http.NewRequest(${goString(request.method)}, ${goString(request.url)}, ${bodyExpr})\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}`)
  if (body?.kind === 'form') lines.push(`${droppedMultipartType ? '// Content-Type comes from the multipart writer, with its boundary\n\t' : ''}req.Header.Set("Content-Type", form.FormDataContentType())`)
  if (request.auth) lines.push(`req.SetBasicAuth(${goString(request.auth.user)}, ${goString(request.auth.password)})`)
  const seen = new Set<string>()
  const headerLines: string[] = []
  for (const header of headers) {
    const key = header.name.toLowerCase()
    if (key === 'host') {
      headerLines.push(`req.Host = ${goString(header.value)}`)
      continue
    }
    headerLines.push(`req.Header.${seen.has(key) ? 'Add' : 'Set'}(${goString(header.name)}, ${goString(header.value)})`)
    seen.add(key)
  }
  if (headerLines.length) lines.push(headerLines.join('\n\t'))

  const client: string[] = []
  if (request.insecure) {
    imports.add('crypto/tls')
    client.push('Transport: &http.Transport{\n\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true}, // curl -k\n\t\t},')
  }
  if (!request.followRedirects) {
    client.push('// curl does not follow redirects without -L\n\t\tCheckRedirect: func(req *http.Request, via []*http.Request) error {\n\t\t\treturn http.ErrUseLastResponse\n\t\t},')
  }
  const check = '\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer resp.Body.Close()'
  lines.push(client.length ? `client := &http.Client{\n\t\t${client.join('\n\t\t')}\n\t}\n\tresp, err := client.Do(req)${check}` : `resp, err := http.DefaultClient.Do(req)${check}`)
  lines.push('data, err := io.ReadAll(resp.Body)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tfmt.Println(resp.Status)\n\tfmt.Printf("%s\\n", data)')

  let source = lines.join('\n\n\t')
  // `data` is already declared when the body was read from a file.
  if (body?.kind === 'file' && body.stripNewlines) source = source.replace('data, err := io.ReadAll', 'data, err = io.ReadAll')
  const importList = [...imports].sort().map((name) => `\t"${name}"`).join('\n')
  return `package main\n\nimport (\n${importList}\n)\n\nfunc main() {\n\t${source}\n}\n`
}

/* -------------------------------------------------------- raw HTTP/1.1 */

/** The multipart boundary in the raw view; curl picks a random one each run. */
export const RAW_BOUNDARY = '------------------------d74496d66958873e'

export function toRawHttp(request: CurlRequest): string {
  const parts = splitUrl(request.url)
  const lines = [`${request.method} ${parts.target} HTTP/1.1`]
  const removed = new Set(request.removed)
  const has = (name: string) => headerValue(request.headers, name) !== undefined || removed.has(name.toLowerCase())
  let host = parts.host
  if ((parts.scheme === 'http' && host.endsWith(':80')) || (parts.scheme === 'https' && host.endsWith(':443'))) host = host.slice(0, host.lastIndexOf(':'))
  if (!has('host')) lines.push(`Host: ${host}`)
  if (request.auth && !has('authorization')) lines.push(`Authorization: Basic ${base64(`${request.auth.user}:${request.auth.password}`)}`)
  if (!has('accept')) lines.push('Accept: */*')
  if (request.compressed && !has('accept-encoding')) lines.push('Accept-Encoding: deflate, gzip, br, zstd')
  for (const header of request.headers) lines.push(`${header.name}: ${header.value}`)

  const body = request.body
  let payload = ''
  let length: number | undefined
  if (body?.kind === 'text') {
    payload = body.text
    length = utf8(payload).length
  } else if (body?.kind === 'file') {
    payload = `<contents of ${body.path}${body.stripNewlines ? ', CR and LF removed' : ''}>`
  } else if (body?.kind === 'form') {
    let known = true
    for (const part of body.parts) {
      const filename = part.kind === 'file' ? `; filename="${part.filename ?? fileName(part.value)}"` : ''
      payload += `--${RAW_BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"${filename}\r\n`
      const type = part.type ?? (part.kind === 'file' ? 'application/octet-stream' : undefined)
      if (type) payload += `Content-Type: ${type}\r\n`
      payload += `\r\n${part.kind === 'text' ? part.value : `<contents of ${part.value}>`}\r\n`
      if (part.kind !== 'text') known = false
    }
    payload += `--${RAW_BOUNDARY}--\r\n`
    if (known) length = utf8(payload).length
    if (!has('content-type')) lines.push(`Content-Type: multipart/form-data; boundary=${RAW_BOUNDARY}`)
    else {
      const index = lines.findIndex((line) => /^content-type:\s*multipart\/form-data\s*$/i.test(line))
      if (index >= 0) lines[index] += `; boundary=${RAW_BOUNDARY}`
    }
  }
  if (body && length !== undefined && !has('content-length')) lines.push(`Content-Length: ${length}`)
  return `${lines.join('\n')}\n\n${payload.replace(/\r\n/g, '\n')}`
}

/* --------------------------------------------------------- curl (bash) */

function formArg(part: FormPart): string {
  const quote = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`
  if (part.kind === 'text' && !part.type) return `--form-string ${quoteBash(`${part.name}=${part.value}`)}`
  const prefix = part.kind === 'file' ? '@' : part.kind === 'filetext' ? '<' : ''
  let value = `${part.name}=${prefix}${quote(part.value)}`
  if (part.filename !== undefined) value += `;filename=${quote(part.filename)}`
  if (part.type) value += `;type=${part.type}`
  return `-F ${quoteBash(value)}`
}

export function toCurl(request: CurlRequest): string {
  const args: string[] = [`curl ${quoteBash(request.url)}`]
  const body = request.body
  const inferred = body ? 'POST' : 'GET'
  if (request.method === 'HEAD' && !body) args.push('-I')
  else if (request.method !== inferred) args.push(`-X ${quoteBash(request.method)}`)
  if (/[[\]{}]/.test(request.url)) args.push('-g')
  if (request.auth) args.push(`-u ${quoteBash(`${request.auth.user}:${request.auth.password}`)}`)
  for (const header of request.headers) args.push(`-H ${quoteBash(header.value === '' ? `${header.name};` : `${header.name}: ${header.value}`)}`)
  for (const name of request.removed) args.push(`-H ${quoteBash(`${name}:`)}`)
  if (body?.kind === 'text') {
    // curl adds this Content-Type to -d data on its own; -H keeps it explicit and order-preserving.
    args.push(`--data-raw ${quoteBash(body.text)}`)
  } else if (body?.kind === 'file') args.push(`${body.stripNewlines ? '-d' : '--data-binary'} ${quoteBash(`@${body.path}`)}`)
  else if (body?.kind === 'form') for (const part of body.parts) args.push(formArg(part))
  const flags = [request.followRedirects && '-L', request.insecure && '-k', request.compressed && '--compressed'].filter(Boolean)
  if (flags.length) args.push(flags.join(' '))
  return args.join(' \\\n  ') + '\n'
}
