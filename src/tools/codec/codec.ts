export type CodecId = 'base64' | 'base64url' | 'url-component' | 'url-full' | 'html' | 'hex'
export type CodecDirection = 'encode' | 'decode'

export interface CodecResult {
  value: string
  error: string | null
}

export const codecs: ReadonlyArray<{ id: CodecId; label: string; hint: string }> = [
  { id: 'base64', label: 'Base64', hint: 'UTF-8 text ↔ padded Base64' },
  { id: 'base64url', label: 'Base64URL', hint: 'UTF-8 text ↔ URL-safe Base64 without padding' },
  { id: 'url-component', label: 'URL component', hint: 'encodeURIComponent / decodeURIComponent' },
  { id: 'url-full', label: 'Full URI', hint: 'Preserves URI separators such as : / ? & #' },
  { id: 'html', label: 'HTML entities', hint: 'Escapes markup-significant characters; decodes named and numeric entities' },
  { id: 'hex', label: 'UTF-8 hex', hint: 'UTF-8 text ↔ hexadecimal bytes' },
]

const utf8 = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(raw: string, urlSafe: boolean): Uint8Array {
  const compact = raw.replace(/\s+/g, '')
  const body = urlSafe ? compact.replace(/-/g, '+').replace(/_/g, '/') : compact
  const alphabet = urlSafe ? /^[A-Za-z0-9_-]*={0,2}$/ : /^[A-Za-z0-9+/]*={0,2}$/
  if (!alphabet.test(compact) || /=/.test(compact.slice(0, -2)) || body.length % 4 === 1) {
    throw new Error(`Invalid ${urlSafe ? 'Base64URL' : 'Base64'} input.`)
  }
  const padded = body.padEnd(Math.ceil(body.length / 4) * 4, '=')
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new Error(`Invalid ${urlSafe ? 'Base64URL' : 'Base64'} input.`)
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const canonical = bytesToBase64(bytes).replace(/=+$/, '')
  if (canonical !== body.replace(/=+$/, '')) throw new Error(`Invalid ${urlSafe ? 'Base64URL' : 'Base64'} input.`)
  return bytes
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Decoded bytes are not valid UTF-8 text.')
  }
}

function encodeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!)
}

function decodeHtmlFallback(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10
    const digits = radix === 16 ? code.slice(2) : code.slice(1)
    const point = Number.parseInt(digits, radix)
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

function decodeHtml(value: string): string {
  if (typeof document === 'undefined') return decodeHtmlFallback(value)
  const doc = new DOMParser().parseFromString(value, 'text/html')
  return doc.body.textContent ?? value
}

export function convertCodec(codec: CodecId, direction: CodecDirection, input: string): CodecResult {
  try {
    let value: string
    if (codec === 'base64' || codec === 'base64url') {
      const urlSafe = codec === 'base64url'
      if (direction === 'encode') {
        value = bytesToBase64(utf8.encode(input))
        if (urlSafe) value = value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      } else {
        value = decodeUtf8(base64ToBytes(input, urlSafe))
      }
    } else if (codec === 'url-component') {
      value = direction === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input)
    } else if (codec === 'url-full') {
      value = direction === 'encode' ? encodeURI(input) : decodeURI(input)
    } else if (codec === 'html') {
      value = direction === 'encode' ? encodeHtml(input) : decodeHtml(input)
    } else if (direction === 'encode') {
      value = Array.from(utf8.encode(input), (byte) => byte.toString(16).padStart(2, '0')).join(' ')
    } else {
      const compact = input.replace(/\s+/g, '')
      if (compact.length % 2 !== 0 || !/^[\da-f]*$/i.test(compact)) throw new Error('Hex input must contain complete byte pairs.')
      const bytes = new Uint8Array(compact.length / 2)
      for (let i = 0; i < compact.length; i += 2) bytes[i / 2] = Number.parseInt(compact.slice(i, i + 2), 16)
      value = decodeUtf8(bytes)
    }
    return { value, error: null }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const message = raw === 'URI malformed' ? 'Input contains an invalid percent-escape sequence.' : raw
    return { value: '', error: message }
  }
}

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength
}
