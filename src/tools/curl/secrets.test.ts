import { describe, expect, it } from 'vitest'
import { corpus } from './corpus'
import { generate, targets } from './generate'
import { parseCurl, splitUrl, type CurlRequest } from './parse'
import { findSecrets, isSecretName, maskValue, redactInput } from './secrets'

const scan = (input: string) => findSecrets(parseCurl(input)).map((secret) => [secret.label, secret.value, secret.placeholder])
const byName = (name: string) => corpus.find((entry) => entry.name.startsWith(name))!.input

/** Everything but the secret values: what must survive a redaction. */
function shape(request: CurlRequest) {
  const parts = splitUrl(request.url)
  return {
    method: request.method,
    host: parts.host,
    path: parts.path,
    query: parts.query.split('&').filter(Boolean).map((pair) => pair.split('=')[0]),
    headers: request.headers.map((header) => header.name),
    body: request.body?.kind,
    auth: Boolean(request.auth),
  }
}

describe('secret detection', () => {
  it('names credential-looking fields', () => {
    for (const name of ['access_token', 'accessToken', 'api_key', 'apiKey', 'apikey', 'key', 'sig', 'X-Amz-Signature', 'X-Amz-Credential', 'client_secret', 'password', 'sessionId', 'x-api-key', 'x-auth-token', 'X-CSRF-Token', 'Ocp-Apim-Subscription-Key', 'private-token']) {
      expect(isSecretName(name), name).toBe(true)
    }
    for (const name of ['page', 'monkey', 'q', 'status', 'keyboard', 'content-type', 'accept', 'tokenizer', 'sort']) {
      expect(isSecretName(name), name).toBe(false)
    }
  })

  it('finds headers, cookies and query tokens in a Chrome copy', () => {
    expect(scan(byName('Chrome bash: GET'))).toEqual([
      ['Query access_token', 'at_demo_0a1b2c3d4e', '<ACCESS_TOKEN>'],
      ['Cookie sid', 'demo-session-7f3e9a', '<SID>'],
      ['Cookie prefs', 'compact', '<PREFS>'],
    ])
    expect(scan(byName('Chrome bash: POST'))).toEqual([
      ['Header authorization (Bearer)', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ZGVtby1zaWduYXR1cmU', '<TOKEN>'],
    ])
  })

  it('finds -u, Basic auth, form, multipart and JSON fields', () => {
    expect(scan(byName('Hand-written: -u'))).toEqual([
      ['-u user', 'demo_user', '<USER>'],
      ['-u password', 'demo-pass-1', '<PASSWORD>'],
      ['Header Idempotency-Key', '7a1f', '<IDEMPOTENCY_KEY>'],
    ])
    expect(scan(byName('Firefox POSIX'))).toEqual([
      ['Header Authorization (Basic)', 'ZGVtbzpkZW1vLXBhc3M=', '<BASIC_CREDENTIALS>'],
      ['Cookie csrftoken', 'demo_csrf_998877', '<CSRFTOKEN>'],
    ])
    expect(scan(byName('Firefox Windows'))).toEqual([['Body password', 'pa%24%24word', '<PASSWORD>']])
    expect(scan(byName('Chrome bash: multipart'))).toEqual([['Form upload_token', 'ut_demo_55aa66bb', '<UPLOAD_TOKEN>']])
    expect(scan(byName('Chrome cmd: GET'))).toEqual([['Header x-api-key', 'demo_key_abcdef0123', '<X_API_KEY>']])
    expect(scan(`curl https://x --json '{"user":{"name":"a","password":"p4ss\\"w"},"api_key":"k-123"}'`)).toEqual([
      ['JSON password', 'p4ss\\"w', '<PASSWORD>'],
      ['JSON api_key', 'k-123', '<API_KEY>'],
    ])
    expect(scan("curl https://x -F 'token=t0k3n' -F 'file=@a.txt' --oauth2-bearer b3arer")).toEqual([
      ['Form token', 't0k3n', '<TOKEN>'],
      ['--oauth2-bearer', 'b3arer', '<TOKEN_2>'],
    ])
    expect(scan('curl https://user:pw@example.com/')).toEqual([['URL user', 'user', '<USER>'], ['URL password', 'pw', '<PASSWORD>']])
  })

  it('flags JWT-shaped values under any name, and repeats of a secret elsewhere', () => {
    const jwt = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.'
    expect(scan(`curl 'https://x/?state=${jwt}'`)).toEqual([['Query state', jwt, '<STATE>']])
    expect(scan("curl https://x -H 'x-api-key: abcdefgh1234' -H 'referer: https://x/?k=abcdefgh1234' -H 'x-note: abcdefgh1234'")).toEqual([
      ['Header x-api-key', 'abcdefgh1234', '<X_API_KEY>'],
      ['Same value as Header x-api-key', 'abcdefgh1234', '<X_API_KEY>'],
      ['Same value as Header x-api-key', 'abcdefgh1234', '<X_API_KEY>'],
    ])
  })

  it('leaves placeholders and ordinary requests alone', () => {
    expect(scan("curl https://x -H 'authorization: Bearer <TOKEN>'")).toEqual([])
    expect(scan(byName('Safari: binary'))).toEqual([])
    expect(scan('curl https://example.com/health')).toEqual([])
  })

  it('masks values in the panel', () => {
    expect(maskValue('short')).toBe('•••••')
    expect(maskValue('at_demo_0a1b2c3d4e')).toBe('at_d…4e')
  })
})

describe('replace with placeholders', () => {
  it.each(corpus.map((entry) => [entry.name, entry.input]))('%s: rewrites only the secrets', (_name, input) => {
    const parsed = parseCurl(input)
    if (!parsed.ok) throw new Error(parsed.error)
    const secrets = findSecrets(parsed)
    const redacted = redactInput(parsed, secrets)
    const again = parseCurl(redacted)
    if (!again.ok) throw new Error(again.error)

    expect(again.detected).toBe(parsed.detected)
    expect(shape(again.request)).toEqual(shape(parsed.request))
    expect(findSecrets(again)).toEqual([])
    const outputs = targets.map((target) => generate(target.id, again.request)).join('\n')
    // Short values (a cookie set to "all") occur naturally elsewhere.
    for (const secret of secrets.filter((item) => item.value.length >= 6)) {
      expect(redacted).not.toContain(secret.value)
      expect(outputs).not.toContain(secret.value)
    }
    for (const secret of secrets) expect(outputs).toContain(secret.placeholder)
    if (!secrets.length) expect(redacted).toBe(parsed.input)
  })

  it('keeps the rest of the command byte for byte', () => {
    const input = byName('Chrome bash: POST')
    const parsed = parseCurl(input)
    const redacted = redactInput(parsed, findSecrets(parsed))
    expect(redacted).toBe(input.replace('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ZGVtby1zaWduYXR1cmU', '<TOKEN>'))
  })

  it('re-quotes cmd words for cmd', () => {
    const parsed = parseCurl(byName('Chrome cmd: GET'))
    const redacted = redactInput(parsed, findSecrets(parsed))
    expect(redacted).toContain('-H ^"x-api-key: ^<X_API_KEY^>^"')
    expect(parseCurl(redacted).dialect).toBe('cmd')
  })
})

describe('credential flags curl does not convert', () => {
  const notes = (input: string) => parseCurl(input).notes.map((note) => note.text).join('\n')
  it.each([
    ["curl -U alice:Sup3rS3cret! https://x", [['--proxy-user user', 'alice', '<PROXY_USER>'], ['--proxy-user password', 'Sup3rS3cret!', '<PROXY_PASSWORD>']]],
    ["curl --proxy-user alice:Sup3rS3cret! https://x", [['--proxy-user user', 'alice', '<PROXY_USER>'], ['--proxy-user password', 'Sup3rS3cret!', '<PROXY_PASSWORD>']]],
    ["curl -E client.pem:certpassw0rd https://x", [['--cert password', 'certpassw0rd', '<CERT_PASSWORD>']]],
    ["curl --cert 'C:\\certs\\client.pem:certpassw0rd' https://x", [['--cert password', 'certpassw0rd', '<CERT_PASSWORD>']]],
    ["curl --cert client.pem https://x", []],
    ["curl --proxy-cert p.pem:pr0xycertpw https://x", [['--proxy-cert password', 'pr0xycertpw', '<PROXY_CERT_PASSWORD>']]],
    ["curl --key k.pem --pass keyPassw0rd https://x", [['--pass', 'keyPassw0rd', '<KEY_PASSWORD>']]],
    ["curl --proxy-pass pr0xyKeyPw https://x", [['--proxy-pass', 'pr0xyKeyPw', '<PROXY_KEY_PASSWORD>']]],
    ["curl -x http://bob:pr0xyPassw0rd@proxy:8080 https://x", [['--proxy user', 'bob', '<PROXY_USER>'], ['--proxy password', 'pr0xyPassw0rd', '<PROXY_PASSWORD>']]],
    ["curl --proxy-header 'Proxy-Authorization: Basic Ym9iOnB3MTIzNDU2' https://x", [['Header Proxy-Authorization (Basic)', 'Ym9iOnB3MTIzNDU2', '<PROXY_BASIC_CREDENTIALS>']]],
  ])('%s', (input, expected) => {
    expect(scan(input)).toEqual(expected)
    const parsed = parseCurl(input)
    const secrets = findSecrets(parsed)
    for (const secret of secrets) expect(notes(input)).not.toContain(secret.value)
    const again = parseCurl(redactInput(parsed, secrets))
    expect(findSecrets(again)).toEqual([])
    for (const secret of secrets) {
      expect(again.input).not.toContain(secret.value)
      expect(again.input).toContain(secret.placeholder)
    }
  })

  it('still names the flag in the warning, without its value', () => {
    expect(notes('curl -U alice:Sup3rS3cret! https://x')).toContain('-U changes the request but is not converted')
    expect(notes('curl --pass hunter22 https://x')).toContain('--pass changes the request but is not converted')
    expect(notes('curl -x http://bob:pw@proxy:8080 https://x')).not.toContain('bob:pw')
    expect(notes('curl -x http://proxy:8080 https://x')).toContain('-x http://proxy:8080')
  })
})

describe('more secret shapes', () => {
  it('scans form bodies whose values contain spaces', () => {
    expect(scan("curl https://x --data-raw 'username=bob&password=hunter2 now'")).toEqual([['Body password', 'hunter2 now', '<PASSWORD>']])
    expect(scan("curl https://x -d 'just some text with password = x'")).toEqual([])
  })

  it('finds numeric JSON secrets and keeps the redacted body JSON', () => {
    const input = `curl https://x --json '{"user":"a","password":12345678,"pin":0,"count":3}'`
    expect(scan(input)).toEqual([['JSON password', '12345678', '<PASSWORD>']])
    const parsed = parseCurl(input)
    const again = parseCurl(redactInput(parsed, findSecrets(parsed)))
    if (!again.ok || again.request.body?.kind !== 'text') throw new Error('expected a text body')
    expect(JSON.parse(again.request.body.text)).toEqual({ user: 'a', password: '<PASSWORD>', pin: 0, count: 3 })
    expect(findSecrets(again)).toEqual([])
  })

  it('matches hyphen, underscore and case variants of secret-ish header names', () => {
    for (const name of ['X-Session-Id', 'x-session-id', 'X_SESSION_ID', 'XSessionId', 'Session-Token', 'X-Auth-Token', 'X-Api-Key']) {
      expect(isSecretName(name), name).toBe(true)
    }
    expect(scan("curl https://x -H 'X-Session-Id: 9f8e7d6c5b4a'")).toEqual([['Header X-Session-Id', '9f8e7d6c5b4a', '<X_SESSION_ID>']])
    for (const name of ['X-Request-Id', 'Content-Id', 'sessions']) expect(isSecretName(name), name).toBe(false)
  })
})
