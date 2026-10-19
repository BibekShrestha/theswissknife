import { describe, expect, it } from 'vitest'
import { buildToolPage, DEFAULT_ORIGIN, parseToolMeta } from '../../scripts/tool-meta'

const html = Object.values(import.meta.glob<string>('/index.html', { query: '?raw', import: 'default', eager: true }))[0]
// ?inline: the PNG as a data: URL, so the bytes survive (a ?raw string would not).
const png = Object.values(import.meta.glob<string>('/public/og.png', { query: '?inline', import: 'default', eager: true }))[0]
const registry = Object.values(import.meta.glob<string>('/src/shell/registry.ts', { query: '?raw', import: 'default', eager: true }))[0]
const copy = Object.values(import.meta.glob<string>('/src/shell/tool-copy.ts', { query: '?raw', import: 'default', eager: true }))[0]

const REGENERATE = 'run `npm run og-image` and commit public/og.png'
const IMAGE = `${DEFAULT_ORIGIN}/og.png`

const meta = (page: string, attr: 'property' | 'name', key: string) =>
  new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(page)?.[1]

describe('the link-preview image', () => {
  it('is a 1200×630 PNG', () => {
    expect(png, REGENERATE).toMatch(/^data:image\/png;base64,/)
    const bytes = Uint8Array.from(atob(png.split(',')[1]), (c) => c.charCodeAt(0))
    const view = new DataView(bytes.buffer)
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG')
    expect([view.getUint32(16), view.getUint32(20)], REGENERATE).toEqual([1200, 630])
    // Crawlers give up on large previews; this one is flat colour and ~56 KB.
    expect(bytes.length).toBeLessThan(300 * 1024)
  })

  it('is named by index.html as a large card, with its size and alt text', () => {
    expect(meta(html, 'property', 'og:image')).toBe(IMAGE)
    expect(meta(html, 'name', 'twitter:image')).toBe(IMAGE)
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image')
    expect([meta(html, 'property', 'og:image:width'), meta(html, 'property', 'og:image:height')]).toEqual(['1200', '630'])
    expect(meta(html, 'property', 'og:image:alt')).toBeTruthy()
    expect(meta(html, 'name', 'twitter:image:alt')).toBeTruthy()
  })

  it('carries over to every tool page', () => {
    for (const tool of parseToolMeta(registry, copy)) {
      const page = buildToolPage(html, tool, DEFAULT_ORIGIN)
      expect(meta(page, 'property', 'og:image'), tool.slug).toBe(IMAGE)
      expect(meta(page, 'name', 'twitter:image'), tool.slug).toBe(IMAGE)
    }
  })
})
