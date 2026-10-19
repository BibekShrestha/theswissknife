import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Calculator, Contains, RangeTab, SPLIT_PAGE, Split, Summarise } from './index'
import { DEFAULTS } from './share'

const copy = async () => undefined
const noop = () => undefined
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const calc = (value: string) => text(renderToStaticMarkup(createElement(Calculator, { value, onChange: noop, copy })))

describe('Calculator view', () => {
  it('shows an IPv4 network with hosts, masks, DNS and class', () => {
    const out = calc('192.168.1.10/24')
    for (const part of ['192.168.1.0/24', '255.255.255.0', '0.0.0.255', '192.168.1.255', '192.168.1.1', '192.168.1.254', '254', '10.1.168.192.in-addr.arpa', '1.168.192.in-addr.arpa', 'Private-Use', 'RFC 1918', 'host bits set']) {
      expect(out).toContain(part)
    }
  })

  it('shows IPv6 canonical, expanded and Teredo fields', () => {
    const out = calc('2001:0:4136:e378:8000:63bf:3fff:fdd2')
    expect(out).toContain('2001:0:4136:e378:8000:63bf:3fff:fdd2')
    expect(out).toContain('2001:0000:4136:e378:8000:63bf:3fff:fdd2')
    expect(out).toContain('192.0.2.45')
    expect(out).toContain('TEREDO')
  })

  it('explains a refused input', () => {
    expect(calc('010.0.0.1/8')).toMatch(/leading zero.*octal 8/)
    expect(calc('1::2::3')).toMatch(/More than one “::”/)
  })

  it('handles /31, /0 and IPv6 /0 without building lists', () => {
    expect(calc('203.0.113.6/31')).toContain('RFC 3021')
    expect(calc('0.0.0.0/0')).toContain('4,294,967,294')
    expect(calc('::/0')).toContain('(2^128)')
  })
})

describe('Split view', () => {
  it('caps a /8 into /32s at one page and says so', () => {
    const html = renderToStaticMarkup(createElement(Split, { state: { ...DEFAULTS, splitNet: '10.0.0.0/8', splitBy: 'prefix', splitValue: '32' }, set: noop, copy }))
    expect((html.match(/<tr>/g) ?? []).length).toBe(SPLIT_PAGE + 1)
    expect(text(html)).toContain(`Showing 1–${SPLIT_PAGE} of 16,777,216 (2^24) — capped at ${SPLIT_PAGE} per page`)
  })

  it('rounds a count up and says why', () => {
    const out = text(renderToStaticMarkup(createElement(Split, { state: { ...DEFAULTS, splitNet: '192.0.2.0/24', splitBy: 'count', splitValue: '3' }, set: noop, copy })))
    expect(out).toContain('4 × /26')
    expect(out).toContain('3 asked for')
  })
})

describe('other tabs', () => {
  it('summarises, compares and converts ranges', () => {
    const sum = renderToStaticMarkup(createElement(Summarise, { value: DEFAULTS.entries, onChange: noop, copy }))
    expect(sum).toContain('10.0.0.0/23\n10.0.2.0/24\n192.168.0.0/23\n2001:db8::/32')
    const contains = text(renderToStaticMarkup(createElement(Contains, { a: '10.0.0.0 - 10.0.0.200', b: '10.0.0.128/25', set: noop })))
    expect(contains).toContain('They overlap')
    expect(contains).toContain('10.0.0.200/32')
    const mapped = text(renderToStaticMarkup(createElement(Contains, { a: '::ffff:10.0.0.1', b: '10.0.0.0/8', set: noop })))
    expect(mapped).toContain('A is IPv4-mapped; its IPv4 form is 10.0.0.1 – 10.0.0.1')
    const range = text(renderToStaticMarkup(createElement(RangeTab, { value: '192.0.2.10 - 192.0.2.99', onChange: noop, copy })))
    expect(range).toContain('192.0.2.10 – 192.0.2.99 → 6 CIDRs 90 addresses')
    expect(range).toContain('192.0.2.96/30')
  })
})
