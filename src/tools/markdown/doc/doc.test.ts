// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { inlineKatexFonts } from '../render/math'
import { normalizeSettings, loadState, saveState, STORAGE_KEY } from '../state/persist'
import { buildHtml, EXPORT_CSP, fileBase } from './buildHtml'
import { buildCss, DEFAULT_SETTINGS, pageBox, THEMES, THEME_SELECTORS } from './docTheme'
import { absolutizeUrls, frameSkeleton, scrollFraction } from './frame'

describe('docTheme', () => {
  it('puts the chosen paper, orientation and margin into @page', () => {
    expect(buildCss(DEFAULT_SETTINGS)).toContain('@page{size:A4 portrait;margin:20mm}')
    expect(buildCss({ ...DEFAULT_SETTINGS, paper: 'letter', landscape: true, margin: 'wide' })).toContain('@page{size:letter landscape;margin:30mm}')
  })

  it('sizes the content box from paper minus margins', () => {
    expect(pageBox(DEFAULT_SETTINGS)).toEqual({ width: 170, height: 257, margin: 20 })
    expect(pageBox({ ...DEFAULT_SETTINGS, landscape: true, margin: 'narrow' })).toEqual({ width: 273, height: 186, margin: 12 })
  })

  it('styles the same selectors in every theme', () => {
    for (const { id } of THEMES) {
      const css = buildCss({ ...DEFAULT_SETTINGS, theme: id })
      for (const selector of THEME_SELECTORS) expect(css, `${id} ${selector}`).toContain(`\n${selector}{`)
    }
  })

  it('keeps the page guide off print and out when disabled', () => {
    expect(buildCss(DEFAULT_SETTINGS)).toMatch(/@media screen\{[\s\S]*repeating-linear-gradient/)
    expect(buildCss({ ...DEFAULT_SETTINGS, pageGuide: false })).not.toContain('repeating-linear-gradient')
  })

  it('prints link targets only when asked', () => {
    expect(buildCss(DEFAULT_SETTINGS)).not.toContain('attr(href)')
    expect(buildCss({ ...DEFAULT_SETTINGS, linkUrls: true })).toContain('attr(href)')
  })
})

describe('buildHtml', () => {
  const out = buildHtml({ title: 'A <b> & c', body: '<p>Hi</p>', css: 'p{color:red}' })

  it('is one self-contained file', () => {
    expect(out).not.toMatch(/<link\b/i)
    expect(out).not.toMatch(/<script\b/i)
    expect(out).toContain('<style>\np{color:red}\n</style>')
    expect(out.startsWith('<!doctype html>')).toBe(true)
  })

  it('escapes the title and forbids script with its own CSP', () => {
    expect(out).toContain('<title>A &lt;b&gt; &amp; c</title>')
    expect(EXPORT_CSP).toContain("default-src 'none'")
    expect(EXPORT_CSP).not.toContain('script-src')
    expect(out).toContain(EXPORT_CSP)
  })

  it('parses into the expected document', () => {
    const doc = new DOMParser().parseFromString(out, 'text/html')
    expect(doc.querySelector('main#doc p')?.textContent).toBe('Hi')
    expect(doc.title).toBe('A <b> & c')
  })

  it('makes safe file names', () => {
    expect(fileBase('Résumé: 2026/Q4 plan')).toBe('resume-2026-q4-plan')
    expect(fileBase('')).toBe('document')
  })
})

describe('KaTeX font inlining', () => {
  it('keeps only woff2 and inlines it', async () => {
    const css = '@font-face{font-family:K;src:url(/assets/K.woff2) format("woff2"),url(/assets/K.woff) format("woff"),url(/assets/K.ttf) format("truetype")}'
    const fetcher = (async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch
    const out = await inlineKatexFonts(css, fetcher)
    expect(out).toBe('@font-face{font-family:K;src:url(data:font/woff2;base64,AQID) format("woff2")}')
  })
})

describe('persistence', () => {
  it('falls back to the sample and defaults', () => {
    const state = loadState('SAMPLE', { getItem: () => null })
    expect(state).toEqual({ doc: 'SAMPLE', settings: DEFAULT_SETTINGS, split: 50, sync: true })
  })

  it('rejects stale or hand-edited values field by field', () => {
    const raw = JSON.stringify({ doc: 'x', split: 999, settings: { theme: 'neon', fontSize: 99, paper: 'letter', tocDepth: 7 } })
    const state = loadState('S', { getItem: () => raw })
    expect(state.doc).toBe('x')
    expect(state.split).toBe(80)
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, fontSize: 22, paper: 'letter' })
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('survives broken JSON and a throwing store', () => {
    expect(loadState('S', { getItem: () => '{nope' }).doc).toBe('S')
    expect(() => saveState(loadState('S', { getItem: () => null }), { setItem: () => { throw new Error('quota') } })).not.toThrow()
  })

  it('round-trips', () => {
    const store = new Map<string, string>()
    const state = { doc: '# hi', settings: { ...DEFAULT_SETTINGS, toc: true }, split: 40, sync: false }
    saveState(state, { setItem: (k, v) => store.set(k, v) })
    expect(loadState('S', { getItem: (k) => store.get(k) ?? null })).toEqual(state)
    expect(store.has(STORAGE_KEY)).toBe(true)
  })
})

describe('scroll sync', () => {
  it('maps position as a fraction of the scrollable room', () => {
    expect(scrollFraction({ scrollTop: 50, scrollHeight: 300, clientHeight: 200 })).toBe(0.5)
    expect(scrollFraction({ scrollTop: 0, scrollHeight: 100, clientHeight: 200 })).toBe(0)
  })
})

describe('frame', () => {
  it('pins the base so #anchors stay inside the document', () => {
    expect(frameSkeleton()).toContain('<base href="about:srcdoc">')
  })

  it('makes root-relative font URLs absolute and leaves the rest', () => {
    const css = 'a{src:url(/assets/K.woff2)} b{src:url("/assets/L.woff2")} c{src:url(data:x)} d{src:url(//cdn/x)}'
    expect(absolutizeUrls(css, 'https://s.test')).toBe('a{src:url(https://s.test/assets/K.woff2)} b{src:url("https://s.test/assets/L.woff2")} c{src:url(data:x)} d{src:url(//cdn/x)}')
  })
})
