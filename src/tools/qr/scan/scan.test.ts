import { describe as suite, expect, it } from 'vitest'
import { buildPayload } from '../payload'
import { encodeQr, isFinder } from '../render'
import { decodeWechat, decodeZxing, type Pixels } from './engine'
import './testing'
import { describe, readIcalDate, splitKeyed, unescapeText } from './parse'

const enc = { ecc: 'M' as const, minVersion: 1, maskPattern: -1, boostEcc: false }

/** Places several renders side by side on one white canvas. */
function sideBySide(...parts: { data: Uint8ClampedArray; dim: number }[]): Pixels {
  const width = parts.reduce((w, p) => w + p.dim, 0)
  const height = Math.max(...parts.map((p) => p.dim))
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  let x0 = 0
  for (const p of parts) {
    for (let y = 0; y < p.dim; y++) data.set(p.data.subarray(y * p.dim * 4, (y + 1) * p.dim * 4), (y * width + x0) * 4)
    x0 += p.dim
  }
  return { data, width, height }
}

/** Renders a code as RGBA pixels — `px` per module, 4-module quiet zone. */
function pixels(text: string, px = 4, invert = false) {
  const { code } = encodeQr(text, enc)
  if (!code) throw new Error('encode failed')
  const dim = (code.size + 8) * px
  const data = new Uint8ClampedArray(dim * dim * 4)
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / px) - 4
      const my = Math.floor(y / px) - 4
      const dark = code.matrix[my]?.[mx] === true
      const v = dark !== invert ? 0 : 255
      data.set([v, v, v, 255], (y * dim + x) * 4)
    }
  }
  return { data, dim, version: code.version }
}

/**
 * The styled look jsQR cannot read as is: round dot modules and circular
 * eyes (ring + disc), like many generators' "dots" preset.
 */
function dotted(text: string, px = 12) {
  const { code } = encodeQr(text, { ...enc, ecc: 'H' })
  if (!code) throw new Error('encode failed')
  const dim = (code.size + 8) * px
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255)
  const eyes = [[3.5, 3.5], [code.size - 3.5, 3.5], [3.5, code.size - 3.5]]
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mx = x / px - 4
      const my = y / px - 4
      const col = Math.floor(mx)
      const row = Math.floor(my)
      let dark = false
      if (row >= 0 && col >= 0 && row < code.size && col < code.size && isFinder(row, col, code.size)) {
        const [ex, ey] = eyes.find(([cx, cy]) => Math.abs(mx - cx) <= 3.5 && Math.abs(my - cy) <= 3.5)!
        const r = Math.hypot(mx - ex, my - ey)
        dark = (r <= 3.5 && r >= 2.5) || r <= 1.5
      } else if (code.matrix[row]?.[col]) {
        dark = Math.hypot(mx - col - 0.5, my - row - 0.5) <= 0.38
      }
      if (dark) data.set([0, 0, 0], (y * dim + x) * 4)
    }
  }
  return { data, dim }
}

const values = (text: string) => Object.fromEntries(describe(text).fields.map((f) => [f.label, f.value]))

suite('decodeZxing', () => {
  it('reads back what the generator draws, UTF-8 included', async () => {
    for (const text of ['https://theswissknife.com/qr', 'Grüße — 日本語 ✓', 'x'.repeat(400)]) {
      const { data, dim, version } = pixels(text)
      const [found, ...rest] = await decodeZxing({ data, width: dim, height: dim })
      expect(rest).toEqual([])
      expect(found.text).toBe(text)
      expect(found.version).toBe(version)
      expect(found.ecLevel).toBe('M')
    }
  })

  it('reads light-on-dark codes', async () => {
    const { data, dim } = pixels('inverted', 4, true)
    expect((await decodeZxing({ data, width: dim, height: dim }))[0]?.text).toBe('inverted')
  })

  it('reads dot modules with round eyes as they are — the style jsQR could not', async () => {
    const text = 'https://theswissknife.com/qr?style=dots'
    const { data, dim } = dotted(text)
    const [found] = await decodeZxing({ data, width: dim, height: dim })
    expect(found?.text).toBe(text)
  })

  it('reads every code in the image, with corners on each code', async () => {
    const a = pixels('first code', 5)
    const b = pixels('second code', 5)
    const found = await decodeZxing(sideBySide(a, b))
    expect(found.map((f) => f.text).sort()).toEqual(['first code', 'second code'])
    const second = found.find((f) => f.text === 'second code')!
    // Top-left sits just inside the second render's 4-module (20 px) quiet zone.
    expect(second.corners[0].x).toBeCloseTo(a.dim + 20, -1)
    expect(second.corners[0].y).toBeCloseTo(20, -1)
  })

  it('returns nothing for a blank image', async () => {
    expect(await decodeZxing({ data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 })).toEqual([])
  })
})

suite('decodeWechat', () => {
  it('loads OpenCV with its models and reads a code with its corners', async () => {
    const { data, dim } = pixels('wechat fallback', 6)
    const [found] = await decodeWechat({ data, width: dim, height: dim })
    expect(found?.text).toBe('wechat fallback')
    expect(found.corners[0].x).toBeCloseTo(24, -1)
    expect(found.corners[2].x).toBeCloseTo(dim - 24, -1)
  }, 60_000)
})

suite('describe', () => {
  it('round-trips Wi-Fi with escaped characters and hides the password', () => {
    const { payload } = buildPayload('wifi', { ssid: 'Cafe;1', password: 'p:w\\"x', security: 'WPA', hidden: 'true' })
    const d = describe(payload)
    expect(d.kind).toBe('wifi')
    expect(values(payload)).toEqual({ 'Network (SSID)': 'Cafe;1', Security: 'WPA', Password: 'p:w\\"x', Hidden: 'Yes' })
    expect(d.fields.find((f) => f.label === 'Password')?.secret).toBe(true)
    expect(values('WIFI:T:nopass;S:Open;;')).toEqual({ 'Network (SSID)': 'Open', Security: 'None (open)' })
  })

  it('round-trips email, phone and SMS', () => {
    expect(values(buildPayload('email', { to: 'a@b.co', subject: 'Hi there', body: 'x&y' }).payload))
      .toEqual({ To: 'a@b.co', Subject: 'Hi there', Body: 'x&y' })
    expect(values(buildPayload('phone', { number: '+1 555 010' }).payload)).toEqual({ Number: '+1555010' })
    expect(values(buildPayload('sms', { number: '+1555', message: 'on: my way' }).payload)).toEqual({ Number: '+1555', Message: 'on: my way' })
    expect(values('sms:+1555?body=hello%20there')).toEqual({ Number: '+1555', Message: 'hello there' })
    expect(values('mailto:me+tag@x.io')).toEqual({ To: 'me+tag@x.io' })
  })

  it('round-trips contacts, vCard and MECARD', () => {
    const { payload } = buildPayload('contact', { first: 'Ada', last: 'Lovelace', org: 'Engines, Ltd', phone: '+44 20', email: 'ada@example.com', address: '1 Main St; Flat 2', note: 'line1\nline2' })
    expect(describe(payload).kind).toBe('contact')
    expect(values(payload)).toEqual({
      Name: 'Ada Lovelace', Organisation: 'Engines, Ltd', Phone: '+4420', Email: 'ada@example.com', Address: '1 Main St; Flat 2', Note: 'line1\nline2',
    })
    expect(values('MECARD:N:Doe,John;TEL:123;EMAIL:j\\;d@x.io;;')).toEqual({ Name: 'John Doe', Phone: '123', Email: 'j;d@x.io' })
  })

  it('round-trips locations and events', () => {
    expect(values(buildPayload('geo', { lat: '27.7172', lng: '85.324', label: 'Durbar Square' }).payload))
      .toEqual({ Latitude: '27.7172', Longitude: '85.324', Label: 'Durbar Square' })
    const { payload } = buildPayload('event', { title: 'Launch, v2', start: '2026-10-03T14:30', end: '2026-10-03T16:00', location: 'Hall; B' })
    expect(values(payload)).toEqual({ Title: 'Launch, v2', Starts: '2026-10-03 14:30', Ends: '2026-10-03 16:00', Location: 'Hall; B' })
  })

  it('offers only http(s) links, showing the punycode host', () => {
    const d = describe('https://exаmple.com/login')
    expect(d.kind).toBe('url')
    expect(d.href).toMatch(/^https:\/\/xn--/)
    expect(values('https://exаmple.com/login').Host).toMatch(/^xn--/)
    expect(describe('javascript:alert(1)').href).toBeUndefined()
    expect(describe('javascript:alert(1)').kind).toBe('text')
    expect(describe('https://a.example and more words').kind).toBe('text')
  })

  it('falls back to plain text', () => {
    expect(describe('hello').kind).toBe('text')
    expect(describe('hello').fields).toEqual([])
  })
})

suite('helpers', () => {
  it('splits keyed fields on unescaped semicolons only', () => {
    expect(splitKeyed('S:a\\;b;P:c\\:d;;')).toEqual({ S: 'a;b', P: 'c:d' })
  })

  it('unescapes vCard text', () => {
    expect(unescapeText('a\\,b\\;c\\nd\\\\e')).toBe('a,b;c\nd\\e')
  })

  it('formats iCalendar dates', () => {
    expect(readIcalDate('20261003T143000')).toBe('2026-10-03 14:30')
    expect(readIcalDate('20261003T143000Z')).toBe('2026-10-03 14:30 UTC')
    expect(readIcalDate('20261003')).toBe('2026-10-03')
  })
})
