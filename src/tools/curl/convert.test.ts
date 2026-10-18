import { describe, expect, it } from 'vitest'
import { corpus } from './corpus'
import { generate, targets, toCurl } from './generate'
import { headerValue, parseCurl, type CurlRequest } from './parse'
import { describeBody } from './view'

const request = (input: string): CurlRequest => {
  const parsed = parseCurl(input)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.request
}
const noteText = (input: string) => parseCurl(input).notes.map((note) => `${note.level}: ${note.text}`).join('\n')
const byName = (name: string) => corpus.find((entry) => entry.name.startsWith(name))!.input

describe('browser corpus', () => {
  it.each(corpus.map((entry) => [entry.name, entry]))('%s: detects the shell and parses', (_name, entry) => {
    const parsed = parseCurl(entry.input)
    expect(parsed.detected).toBe(entry.dialect)
    expect(parsed.ok).toBe(true)
    expect(parsed.notes.filter((note) => note.level === 'warn').map((note) => note.text)).toEqual([])
  })

  it('Chrome bash GET: cookies from -b, query kept verbatim', () => {
    const req = request(byName('Chrome bash: GET'))
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://app.example.com/api/v1/me?include=teams&access_token=at_demo_0a1b2c3d4e')
    expect(headerValue(req.headers, 'cookie')).toBe('sid=demo-session-7f3e9a; prefs=compact')
    expect(req.headers.map((header) => header.name)).toEqual(['accept', 'accept-language', 'Cookie', 'priority', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-fetch-mode', 'user-agent'])
    expect(headerValue(req.headers, 'sec-ch-ua')).toBe('"Chromium";v="129", "Not=A?Brand";v="8"')
  })

  it("Chrome bash $'…': escapes decode to the exact body", () => {
    const req = request(byName("Chrome bash: $'"))
    expect(req.method).toBe('PUT')
    expect(req.body).toEqual({ kind: 'text', text: "It's done!\nSecond line — ok" })
  })

  it('Chrome bash multipart: raw parts are split for the view', () => {
    const view = describeBody(request(byName('Chrome bash: multipart')))
    expect(view).toEqual({
      kind: 'multipart',
      parts: [
        { name: 'title', filename: undefined, type: undefined, value: 'Quarterly report', file: false },
        { name: 'upload_token', filename: undefined, type: undefined, value: 'ut_demo_55aa66bb', file: false },
        { name: 'file', filename: 'q3.csv', type: 'text/csv', value: '', file: true },
      ],
    })
  })

  it('Chrome cmd: carets, quotes, & and % decode', () => {
    const req = request(byName('Chrome cmd: POST'))
    expect(req.url).toBe('https://shop.example.com/api/cart?locale=en-US&ref=nav')
    expect(req.body).toEqual({ kind: 'text', text: '{"sku":"A-100","qty":3,"note":"50% off & free"}' })
    expect(headerValue(req.headers, 'sec-ch-ua')).toBe('"Chromium";v="129", "Not=A?Brand";v="8"')
    expect(headerValue(req.headers, 'cookie')).toBe('cart_id=c-1029; consent=all')
  })

  it('Chrome cmd: %^25 and ^\\n\\n newlines', () => {
    const req = request(byName('Chrome cmd: GET'))
    expect(req.url).toBe('https://example.com/search?q=100%25&page=2')
    expect(req.body).toEqual({ kind: 'text', text: 'line one\nline two' })
  })

  it('Firefox POSIX: \\xe9 is é, \\u20ac is €', () => {
    const req = request(byName('Firefox POSIX'))
    expect(req.body).toEqual({ kind: 'text', text: '{"name":"Renée","bio":"It\'s 5€"}' })
    expect(req.method).toBe('PUT')
    expect(noteText(byName('Firefox POSIX'))).toContain('Latin-1')
  })

  it('Firefox Windows: urlencoded form fields decode', () => {
    const req = request(byName('Firefox Windows'))
    expect(req.body).toEqual({ kind: 'text', text: 'user=demo&password=pa%24%24word&remember=1' })
    expect(describeBody(req)).toEqual({ kind: 'form', fields: [{ name: 'user', value: 'demo' }, { name: 'password', value: 'pa$$word' }, { name: 'remember', value: '1' }] })
  })

  it('Safari: \\[ \\] are curl glob escapes, \\041 is !', () => {
    expect(request(byName('Safari: escaped')).url).toBe('https://example.com/search?filter[type]=book&page=1')
    expect(request(byName('Safari: binary')).body).toEqual({ kind: 'text', text: '{"msg":"Hi! über"}' })
  })

  it('hand-written: -u, clustered flags, joined data', () => {
    const req = request(byName('Hand-written: -u'))
    expect(req.method).toBe('POST')
    expect(req.auth).toEqual({ user: 'demo_user', password: 'demo-pass-1' })
    expect(req.body).toEqual({ kind: 'text', text: 'amount=500&currency=usd&description=Two%20widgets%20%26%20a%20gadget' })
    expect(headerValue(req.headers, 'content-type')).toBe('application/x-www-form-urlencoded')
    expect(req.followRedirects && req.insecure && req.compressed).toBe(true)
    expect(noteText(byName('Hand-written: -u'))).toContain('No effect on the request, so not converted: -s -S')
  })

  it('hand-written: -F parts, -A and -e', () => {
    const req = request(byName('Hand-written: -F'))
    expect(req.body).toEqual({
      kind: 'form',
      parts: [
        { name: 'name', value: 'report', kind: 'text' },
        { name: 'file', value: './q3.csv', kind: 'file', type: 'text/csv' },
        { name: 'meta', value: 'meta.json', kind: 'filetext' },
      ],
    })
    expect(req.headers).toEqual([{ name: 'User-Agent', value: 'importer/2.1' }, { name: 'Referer', value: 'https://example.com/' }])
  })

  it('hand-written: -G moves data into the query; removals and empty headers', () => {
    const req = request(byName('Hand-written: -G'))
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://example.com/search?q=hello&tag=a%20b')
    expect(req.body).toBeUndefined()
    expect(req.removed).toEqual(['accept'])
    expect(req.headers).toEqual([{ name: 'X-Empty', value: '' }])
    expect(generate('raw', req)).not.toContain('Accept: */*')
  })

  it('--json sets both headers; big integers survive the pretty view', () => {
    const req = request(byName('Hand-written: --json'))
    expect(req.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }, { name: 'Accept', value: 'application/json' }])
    expect(describeBody(req)).toEqual({ kind: 'json', pretty: '{\n  "name": "demo",\n  "id": 12345678901234567890\n}' })
    // Not safe to print as a literal: the body stays a string in code.
    expect(generate('fetch', req)).toContain(`body: '{"name":"demo","id":12345678901234567890}'`)
  })

  it('-I is HEAD', () => {
    expect(request(byName('Hand-written: HEAD')).method).toBe('HEAD')
  })
})

describe('round trip: request → curl → the same request', () => {
  it.each(corpus.map((entry) => [entry.name, entry.input]))('%s', (_name, input) => {
    const original = request(input)
    const again = request(toCurl(original))
    expect(again).toEqual(original)
  })
})

describe('outputs per target', () => {
  it.each(corpus.flatMap((entry) => targets.map((target) => [`${entry.name} → ${target.language}`, entry.input, target.id] as const)))('%s', (_name, input, target) => {
    expect(generate(target, request(input))).toMatchSnapshot()
  })

  it('prints a JSON literal only when it serialises back byte for byte', () => {
    const exact = request(`curl https://x -H 'content-type: application/json' -d '{"a":[1,true,null],"b":"c"}'`)
    expect(generate('fetch', exact)).toContain('body: JSON.stringify({')
    expect(generate('python', exact)).toContain("data=json.dumps(json_data, separators=(',', ':'))")
    for (const body of ['{"a": 1}', '{"a":1.5}', '{"b":1,"2":0}', '{"a":1,"a":2}', '{"__proto__":1}']) {
      const req = request(`curl https://x --json '${body}'`)
      expect(generate('fetch', req), body).not.toContain('JSON.stringify')
      expect(generate('python', req), body).not.toContain('json.dumps')
    }
  })

  it('sends non-ASCII bodies as UTF-8 from Python and counts bytes in raw HTTP', () => {
    const req = request(`curl https://x -d 'name=Zoë'`)
    expect(generate('python', req)).toContain(".encode('utf-8')")
    expect(generate('raw', req)).toContain('Content-Length: 9')
  })

  it('follows redirects only with -L, as curl does', () => {
    expect(generate('python', request('curl https://x'))).toContain('allow_redirects=False')
    expect(generate('python', request('curl -L https://x'))).not.toContain('allow_redirects')
    expect(generate('python', request('curl -I https://x'))).not.toContain('allow_redirects')
    expect(generate('python', request('curl -I -L https://x'))).toContain('allow_redirects=True')
    expect(generate('fetch', request('curl -L https://x'))).not.toContain('redirect:')
    expect(generate('go', request('curl -L https://x'))).not.toContain('CheckRedirect')
  })

  it('moves URL credentials into Basic auth', () => {
    const req = request('curl https://demo:pw@example.com/a')
    expect(req.url).toBe('https://example.com/a')
    expect(req.auth).toEqual({ user: 'demo', password: 'pw' })
    expect(generate('raw', req)).toContain(`Authorization: Basic ${btoa('demo:pw')}`)
  })
})

describe('warnings', () => {
  const warns = (input: string) => parseCurl(input).notes.filter((note) => note.level === 'warn').map((note) => note.text).join('\n')

  it('lists unknown and unconverted flags instead of dropping them', () => {
    expect(warns('curl --frobnicate https://x')).toContain('Unknown option --frobnicate')
    expect(warns('curl -Q https://x')).toContain('-Q')
    expect(warns('curl --data=a https://x')).toContain('curl does not accept --data=')
    expect(warns('curl -x http://proxy:8080 https://x')).toContain('-x http://proxy:8080 changes the request but is not converted')
    expect(warns('curl --digest -u a:b https://x')).toContain('--digest changes the request but is not converted')
    expect(warns('curl -T file.bin https://x')).toContain('-T file.bin')
  })

  it('names shell constructs', () => {
    expect(warns('curl -H "x-api-key: $API_KEY" https://x')).toContain('$API_KEY is not expanded')
    expect(warns('curl https://x | jq .')).toContain('pipe')
    expect(warns('curl https://x > out.json')).toContain('redirect')
  })

  it('reports curl-level conflicts and leftovers', () => {
    expect(warns('curl https://a https://b')).toContain('only the first URL is converted')
    expect(warns('curl -d a=1 -F b=2 https://x')).toContain('refuses to combine -d/--data with -F')
    expect(warns('curl -X HEAD https://x')).toContain('-I is the way to send HEAD')
    expect(warns('curl -d @payload.json https://x')).toBe('')
    expect(warns('curl -d @- https://x')).toContain('standard input')
    expect(warns("curl 'https://x/?a[0]=1'")).toContain('glob')
    expect(warns("curl -g 'https://x/?a[0]=1'")).toBe('')
    expect(warns('curl -H nocolon https://x')).toContain('has no colon')
    expect(warns('curl -b cookies.txt https://x')).toContain('reads cookies from a file')
  })

  it('explains precedence and missing pieces', () => {
    const text = noteText('curl -A agent -H "User-Agent: real" -u a:b -H "Authorization: Bearer t" example.com')
    expect(text).toContain('-H User-Agent takes precedence over -A')
    expect(text).toContain('-H Authorization takes precedence over -u')
    expect(text).toContain('curl assumes http://')
    expect(parseCurl('wget https://x')).toMatchObject({ ok: false, error: expect.stringContaining('start with curl') })
    expect(parseCurl('curl -s')).toMatchObject({ ok: false, error: 'No URL found in the command' })
    expect(noteText(`curl https://x -d '{"a":1}'`)).toContain('sent as application/x-www-form-urlencoded')
  })
})

describe('--data-urlencode and --url-query forms (curl checks = before @)', () => {
  const body = (arg: string) => request(`curl https://x --data-urlencode '${arg}'`).body
  it.each([
    ['content', 'hello world', { kind: 'text', text: 'hello%20world' }],
    ['=content', '=a=b&c', { kind: 'text', text: 'a%3Db%26c' }],
    ['name=content', 'msg=hello world', { kind: 'text', text: 'msg=hello%20world' }],
    ['name=content with @ in the name', 'email@x.com=hello world', { kind: 'text', text: 'email@x.com=hello%20world' }],
    ['name=content with @ in the content', 'to=a@b.c', { kind: 'text', text: 'to=a%40b.c' }],
    ['@filename', '@notes.txt', { kind: 'text', text: '<contents of notes.txt>' }],
    ['name@filename', 'notes@notes.txt', { kind: 'text', text: 'notes=<contents of notes.txt>' }],
  ])('%s', (_form, arg, expected) => {
    expect(body(arg)).toEqual(expected)
  })

  it('--url-query follows the same rule', () => {
    expect(request("curl https://x --url-query 'email@x.com=a b'").url).toBe('https://x?email@x.com=a%20b')
    expect(request("curl https://x --url-query 'q@file.txt'").url).toBe('https://x?q=<contents of file.txt>')
  })
})

describe('user agent and method case', () => {
  it('-A "" removes the User-Agent header, as curl does', () => {
    const req = request("curl -A '' https://x")
    expect(headerValue(req.headers, 'user-agent')).toBeUndefined()
    expect(req.removed).toContain('user-agent')
    for (const target of ['raw', 'fetch', 'python', 'go'] as const) expect(generate(target, req)).not.toMatch(/User-Agent['"]?: ?['"]?$/m)
    expect(generate('curl', req)).toContain('-H user-agent:')
    // A later -A wins, and a single space is still a blank header.
    expect(headerValue(request("curl -A '' -A x https://x").headers, 'user-agent')).toBe('x')
    expect(headerValue(request("curl -A ' ' https://x").headers, 'user-agent')).toBe(' ')
  })

  it('-X post: says requests and fetch() upper-case it while curl sends it as written', () => {
    const parsed = parseCurl('curl -X post https://x')
    expect(parsed.notes.some((note) => note.level === 'warn' && /-X post/.test(note.text) && /POST/.test(note.text))).toBe(true)
    expect(generate('raw', request('curl -X post https://x'))).toMatch(/^post \//)
    expect(generate('python', request('curl -X post https://x'))).toMatch(/requests upper-cases/)
    expect(parseCurl('curl -X POST https://x').notes.some((note) => /exactly as written/.test(note.text))).toBe(false)
    expect(parseCurl('curl -X MyVerb https://x').notes.map((note) => note.text)).toContain('-X MyVerb: curl sends the method exactly as written, and servers may treat method names case-sensitively; Python requests sends MYVERB instead')
    expect(generate('python', request('curl -X MyVerb https://x'))).toMatch(/requests upper-cases/)
  })

  it('a JSON body with a raw DEL is not printed as a literal json.dumps would re-escape', () => {
    const req = request(`curl https://x -H 'Content-Type: application/json' -d '{"a":"x\x7fy"}'`)
    const python = generate('python', req)
    expect(python).not.toContain('json.dumps')
    expect(python).toContain("data = '{\"a\":\"x\\x7fy\"}'")
  })
})
