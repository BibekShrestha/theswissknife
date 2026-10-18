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
