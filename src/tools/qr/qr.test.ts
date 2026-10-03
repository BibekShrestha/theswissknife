import { describe, expect, it } from 'vitest'
import { parseBatch, slugify } from './batch'
import { buildPayload, escapeWifi, icalDate } from './payload'
import { colorWarnings, contrastRatio, dataMode, drawQr, encodeQr, isFinder, logoRisk, toSvg, type Style } from './render'

const base = { ecc: 'M' as const, minVersion: 1, maskPattern: -1, boostEcc: false }
const style: Style = { margin: 4, moduleStyle: 'square', eyeStyle: 'square', fg: '#000000', bg: '#ffffff', eyeColor: '', transparent: false }

describe('payload builders', () => {
  it('passes text through untouched', () => {
    expect(buildPayload('text', { text: 'https://theswissknife.com' })).toEqual({ payload: 'https://theswissknife.com' })
    expect(buildPayload('text', { text: '' }).error).toBeTruthy()
  })

  it('escapes the Wi-Fi special characters', () => {
    expect(escapeWifi('a;b,c:d\\e"f')).toBe('a\\;b\\,c\\:d\\\\e\\"f')
    expect(buildPayload('wifi', { ssid: 'Cafe;1', password: 'p:w', security: 'WPA', hidden: 'true' }).payload)
      .toBe('WIFI:T:WPA;S:Cafe\\;1;P:p\\:w;H:true;;')
  })

  it('omits the password on open networks and requires it otherwise', () => {
    expect(buildPayload('wifi', { ssid: 'Open', security: 'nopass', password: 'ignored' }).payload).toBe('WIFI:T:nopass;S:Open;;')
    expect(buildPayload('wifi', { ssid: 'Locked', security: 'WPA' }).error).toMatch(/Password/)
  })

  it('builds mailto with encoded subject and body', () => {
    expect(buildPayload('email', { to: 'a@b.co', subject: 'Hi there', body: 'x&y' }).payload)
      .toBe('mailto:a@b.co?subject=Hi%20there&body=x%26y')
  })

  it('cleans phone numbers for tel: and SMSTO:', () => {
    expect(buildPayload('phone', { number: '+1 (555) 010-0000' }).payload).toBe('tel:+15550100000')
    expect(buildPayload('sms', { number: '555 1234', message: 'On my way' }).payload).toBe('SMSTO:5551234:On my way')
  })

  it('writes a CRLF vCard with escaped values', () => {
    const { payload } = buildPayload('contact', { first: 'Ada', last: 'Lovelace', org: 'Engines, Ltd', phone: '+44 20 0000' })
    expect(payload.split('\r\n')).toEqual([
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'FN:Ada Lovelace', 'ORG:Engines\\, Ltd', 'TEL;TYPE=CELL:+44200000', 'END:VCARD',
    ])
  })

  it('validates geo ranges', () => {
    expect(buildPayload('geo', { lat: '27.7172', lng: '85.324' }).payload).toBe('geo:27.7172,85.324')
    expect(buildPayload('geo', { lat: '91', lng: '0' }).error).toMatch(/Latitude/)
    expect(buildPayload('geo', { lat: '1', lng: '2', label: 'A & B' }).payload).toBe('geo:1,2?q=1,2(A%20%26%20B)')
  })

  it('builds a VEVENT in floating local time', () => {
    expect(icalDate('2026-10-03T14:30')).toBe('20261003T143000')
    const { payload } = buildPayload('event', { title: 'Launch', start: '2026-10-03T14:30', end: '2026-10-03T15:00' })
    expect(payload).toBe('BEGIN:VEVENT\r\nSUMMARY:Launch\r\nDTSTART:20261003T143000\r\nDTEND:20261003T150000\r\nEND:VEVENT')
    expect(buildPayload('event', { title: 'x', start: '2026-10-03T14:30', end: '2026-10-02T14:30' }).error).toMatch(/End/)
  })
})

describe('encodeQr', () => {
  it('picks the smallest version that fits', () => {
    const { code } = encodeQr('HELLO WORLD', base)
    expect(code?.version).toBe(1)
    expect(code?.size).toBe(21)
    expect(code?.ecc).toBe('M')
  })

  it('honours a minimum version and a fixed mask', () => {
    const { code } = encodeQr('hi', { ...base, minVersion: 5, maskPattern: 3 })
    expect(code?.version).toBe(5)
    expect(code?.mask).toBe(3)
  })

  it('boosts ECC without growing the symbol and reports the real level', () => {
    const { code } = encodeQr('hi', { ...base, ecc: 'L', boostEcc: true })
    expect(code?.version).toBe(1)
    expect(code?.ecc).toBe('H')
  })

  it('explains when the data does not fit', () => {
    expect(encodeQr('x'.repeat(1300), { ...base, ecc: 'H' }).error).toMatch(/1,273-byte limit at ECC H/)
  })

  it('reports the mode uqr will use', () => {
    expect(dataMode('12345')).toBe('Numeric')
    expect(dataMode('HTTPS://EX.COM')).toBe('Alphanumeric')
    expect(dataMode('https://ex.com')).toBe('Byte')
  })
})

describe('drawing', () => {
  const code = encodeQr('https://theswissknife.com', base).code!

  it('adds the quiet zone and draws three eyes', () => {
    const d = drawQr(code, style)
    expect(d.dim).toBe(code.size + 8)
    expect(d.eyes.match(/M/g)).toHaveLength(9)
  })

  it('never draws finder cells as data modules', () => {
    expect(isFinder(0, 0, 21)).toBe(true)
    expect(isFinder(0, 20, 21)).toBe(true)
    expect(isFinder(20, 20, 21)).toBe(false)
    // The top-left corner cell would otherwise start a run at the margin.
    expect(drawQr(code, style).modules).not.toContain('M4 4h')
  })

  it('emits every style without NaN', () => {
    for (const moduleStyle of ['square', 'rounded', 'dots'] as const) {
      for (const eyeStyle of ['square', 'rounded', 'circle'] as const) {
        const svg = toSvg(drawQr(code, { ...style, moduleStyle, eyeStyle }), style, 256)
        expect(svg).not.toContain('NaN')
        expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 33 33"/)
      }
    }
  })

  it('clears modules behind a logo plate', () => {
    const big = encodeQr('x'.repeat(200), base).code!
    const logo = { src: 'data:image/png;base64,AA==', width: 10, height: 10, img: {} as HTMLImageElement }
    const plain = drawQr(big, style)
    const withLogo = drawQr(big, style, logo, { scale: 0.25, plate: true })
    expect(withLogo.modules.length).toBeLessThan(plain.modules.length)
    expect(toSvg(withLogo, style, 512, logo)).toContain('<image href="data:image/png;base64,AA=="')
  })

  it('omits the background when transparent', () => {
    expect(toSvg(drawQr(code, style), { ...style, transparent: true }, 100)).not.toContain('<rect')
  })
})

describe('checks', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#777777', '#888888')).toBeLessThan(1.5)
  })

  it('warns about weak and inverted colours', () => {
    expect(colorWarnings(style)).toEqual([])
    expect(colorWarnings({ ...style, fg: '#dddddd' })[0]).toMatch(/Low contrast/)
    expect(colorWarnings({ ...style, fg: '#ffffff', bg: '#000000' })[0]).toMatch(/Light modules/)
  })

  it('grades logo coverage against the ECC budget', () => {
    expect(logoRisk(0.2, 'H')).toBe('ok')
    expect(logoRisk(0.3, 'L')).toBe('risky')
  })
})

describe('batch', () => {
  it('splits lines, names files and de-duplicates', () => {
    expect(parseBatch('https://a.com/x\n\nmenu\thttps://b.com\nhttps://a.com/x')).toEqual([
      { name: '001-a-com-x', content: 'https://a.com/x' },
      { name: '002-menu', content: 'https://b.com' },
      { name: '003-a-com-x-2', content: 'https://a.com/x' },
    ])
  })

  it('slugifies to something a file system accepts', () => {
    expect(slugify('https://www.Example.com/Ünïcode path?q=1')).toBe('example-com-unicode-path-q-1')
    expect(slugify('日本')).toBe('')
    expect(parseBatch('日本')[0].name).toBe('001-qr')
  })
})
