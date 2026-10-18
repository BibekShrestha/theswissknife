import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper
import { readText } from '../../../scripts/read-text.mjs'
import { accessibleLabel, buildPayload, redactPayload } from './payload'
import { capacity, encodeQr } from './render'
import { describe as describePayload, toForm } from './scan/parse'

const opts = { ecc: 'M' as const, minVersion: 1, maskPattern: -1, boostEcc: false }

describe('QR-1: no Wi-Fi password in accessible names or on-screen previews', () => {
  const wifi = { ssid: 'HomeNet', password: 'hunter2;x', security: 'WPA', hidden: '' }

  it('labels a Wi-Fi code by its network, not its payload', () => {
    const label = accessibleLabel('wifi', wifi)
    expect(label).toBe('QR code for Wi-Fi network HomeNet')
    expect(label).not.toMatch(/hunter2/)
  })

  it('labels the other presets without dumping the raw payload', () => {
    expect(accessibleLabel('text', { text: 'https://example.com' })).toBe('QR code for https://example.com')
    expect(accessibleLabel('contact', { first: 'Ada', last: 'Lovelace' })).toBe('QR code for the contact Ada Lovelace')
    expect(accessibleLabel('event', { title: 'Launch' })).toBe('QR code for the event Launch')
  })

  it('masks the password in a shown Wi-Fi payload, escaped characters included', () => {
    const { payload } = buildPayload('wifi', wifi)
    const shown = redactPayload(payload)
    expect(shown).toBe('WIFI:T:WPA;S:HomeNet;P:••••••••;;')
    expect(redactPayload('https://example.com')).toBe('https://example.com')
  })

  it('the generator uses them for the preview label, the batch tooltips and the encoded-content view', () => {
    const src: string = readText('src/tools/qr/Generator.tsx')
    expect(src).not.toMatch(/aria-label=\{`QR code for \$\{built\.payload/)
    expect(src).not.toMatch(/title=\{row\.error \?\? row\.content\}/)
    expect(src).toMatch(/accessibleLabel\(/)
    expect(src).toMatch(/redactPayload\(/)
  })
})

describe('QR-2: encoder errors say what is actually wrong', () => {
  it('reports a lone surrogate as invalid text, not as too much data', () => {
    const r = encodeQr('a\uD800b', opts)
    expect(r.error).toMatch(/unpaired/)
    expect(r.error).not.toMatch(/Too much/)
  })

  it('states the limit for the mode the data is in', () => {
    expect(capacity('Numeric', 'M')).toBe(5596)
    expect(capacity('Alphanumeric', 'M')).toBe(3391)
    expect(capacity('Byte', 'M')).toBe(2331)
    expect(encodeQr('1'.repeat(5000), opts).error).toBeUndefined()
    expect(encodeQr('1'.repeat(5597), opts).error).toMatch(/5,597 digits is over the 5,596-digit limit at ECC M/)
    expect(encodeQr('A'.repeat(3392), opts).error).toMatch(/3,392 characters is over the 3,391-character limit/)
    expect(encodeQr('é'.repeat(1200), opts).error).toMatch(/2,400 bytes is over the 2,331-byte limit/)
  })

  it('a lone surrogate in a form field is an error, not a crash', () => {
    expect(() => buildPayload('email', { to: 'a@b.co', subject: 'x\uDC00' })).not.toThrow()
    expect(buildPayload('email', { to: 'a@b.co', subject: 'x\uDC00' }).error).toMatch(/unpaired/)
  })
})

describe('QR-3: payload escaping round-trips', () => {
  it('encodes parentheses in a geo label so the label survives', () => {
    const { payload } = buildPayload('geo', { lat: '27.7172', lng: '85.324', label: 'Durbar (main) square' })
    expect(payload).not.toMatch(/\(main\)/)
    const form = toForm(payload)
    expect(form.fields.label).toBe('Durbar (main) square')
    expect(form.exact).toBe(true)
  })

  it('writes a vCard URL as a URI, not escaped text, and cannot be broken onto a new line', () => {
    const url = 'https://example.com/a,b;c\\d'
    const { payload } = buildPayload('contact', { first: 'Ada', url })
    expect(payload.split('\r\n')).toContain(`URL:${url}`)
    const form = toForm(payload)
    expect(form.fields.url).toBe(url)
    expect(form.exact).toBe(true)
    const injected = buildPayload('contact', { first: 'Ada', url: 'https://x.test\r\nTEL:+1555' }).payload
    expect(injected.split('\r\n').filter((l) => l.startsWith('TEL'))).toEqual([])
  })

  it('encodes the mailto recipient so a "?cc=" in it cannot add a header', () => {
    const to = 'a@b.co?cc=evil@x.test&bcc=more@x.test'
    const { payload } = buildPayload('email', { to, subject: 'Hi' })
    expect(payload).not.toMatch(/\?cc=/)
    const shown = describePayload(payload)
    expect(shown.fields.find((f) => f.label === 'Cc')).toBeUndefined()
    expect(shown.fields.find((f) => f.label === 'To')?.value).toBe(to)
    expect(toForm(payload).exact).toBe(true)
    // Plain addresses (and several of them) stay readable.
    expect(buildPayload('email', { to: 'me+tag@example.com, you@example.com' }).payload).toBe('mailto:me+tag@example.com,you@example.com')
  })
})
