import { describe, expect, it } from 'vitest'
import { analyze } from './lib/analyze'
import { findingDetail, FINDING_TITLES, graphemeEscapes, visible } from './copy'

describe('display copy', () => {
  it('never shows bidi controls or invisibles raw', () => {
    expect(visible('user\u202E \u2066// x\u2069')).toBe('user[RLO] [LRI]// x[PDI]')
    expect(visible('a\u200Bb\u00A0c')).toBe('a[ZWSP]b[NBSP]c')
    expect(visible('\uD800')).toBe('[U+D800]')
    expect(visible('Café e\u0301')).toBe('Café e\u0301')
    expect(visible(' ', true)).toBe('[SP]')
  })

  it('has a title and a description for every finding the sample can raise', () => {
    const text = 'p\u0430ypal pass\u200Bword \u202Eevil\nHi\u{E0068}\u{E0069} \u00A0 \uFEFF a\uFE0F\uFE01 \u0301 \u0007 \uE000 \uD800 Tシャツ'
    const findings = analyze(text).findings
    expect(findings.length).toBe(12)
    for (const f of findings) {
      expect(FINDING_TITLES[f.kind]).toMatch(/\w/)
      expect(findingDetail(f).join(' ')).toMatch(/\w{4}/)
    }
  })

  it('offers JavaScript, HTML and CSS escapes for a grapheme', () => {
    expect(graphemeEscapes('é').map(([label]) => label)).toEqual(['JavaScript', 'HTML', 'CSS'])
  })
})

const sources = import.meta.glob<string>('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true })

describe('this folder’s own sources', () => {
  it('spell every invisible, bidi or odd-space character as an escape', () => {
    // A raw RLO in a test file is the very thing this tool warns about.
    const hidden = /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFE00-\uFE0F]/u
    const offenders = Object.entries(sources).filter(([, text]) => hidden.test(text)).map(([path]) => path)
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    expect(offenders).toEqual([])
  })
})
