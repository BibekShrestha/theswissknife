import { describe, expect, it } from 'vitest'
import {
  buildDescription,
  buildJsonLd,
  buildSitemap,
  DESCRIPTION_LIMIT,
  injectJsonLd,
  injectMeta,
  originFromCname,
  parseToolMeta,
} from '../../scripts/tool-meta'
// the same file the build parses, read as text rather than imported
import registrySource from './registry.ts?raw'
import { tools } from './registry'

const ORIGIN = 'https://theswissknife.com'
const meta = parseToolMeta(registrySource)

describe('parseToolMeta', () => {
  /**
   * The guard that matters: the text parser the build uses must agree with the
   * registry the app uses. If a future entry is written in a shape the parser
   * misses, this fails instead of quietly shipping a tool with no sitemap URL.
   */
  it('matches the real registry exactly', () => {
    expect(meta.map((t) => t.slug)).toEqual(tools.map((t) => t.slug))
    expect(meta.map((t) => t.name)).toEqual(tools.map((t) => t.name))
    expect(meta.map((t) => t.tagline)).toEqual(tools.map((t) => t.tagline))
    expect(meta.map((t) => t.category)).toEqual(tools.map((t) => t.category))
  })

  it('ignores the ToolMeta interface declaration', () => {
    expect(meta.some((t) => t.slug === 'string')).toBe(false)
  })

  it('unescapes quoted values', () => {
    const source = `
      { slug: 'x', name: 'Bob\\'s tool', tagline: 'It\\'s fine', mark: 'X', category: 'text', load: () => import('../tools/x') },
    `
    expect(parseToolMeta(source)).toEqual([
      { slug: 'x', name: "Bob's tool", tagline: "It's fine", category: 'text' },
    ])
  })

  it('skips entries missing required fields', () => {
    expect(parseToolMeta(`{ slug: 'y', name: 'Y' }`)).toEqual([])
  })
})

describe('originFromCname', () => {
  it('uses the published CNAME so the sitemap follows the domain', () => {
    expect(originFromCname('theswissknife.com\n')).toBe('https://theswissknife.com')
    expect(originFromCname('example.dev')).toBe('https://example.dev')
  })

  it('falls back when there is no CNAME', () => {
    expect(originFromCname(undefined)).toBe(ORIGIN)
    expect(originFromCname('  ')).toBe(ORIGIN)
  })
})

describe('buildSitemap', () => {
  const xml = buildSitemap(meta, ORIGIN)

  it('lists the landing page and every tool', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual([`${ORIGIN}/`, ...tools.map((t) => `${ORIGIN}/${t.slug}`)])
  })

  it('covers the tools that were missing before generation', () => {
    expect(xml).toContain(`${ORIGIN}/pdf`)
    expect(xml).toContain(`${ORIGIN}/html-table`)
  })

  it('is well-formed and escapes XML metacharacters', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
    const escaped = buildSitemap([{ slug: 'a&b', name: 'n', tagline: 't', category: 'data' }], ORIGIN)
    expect(escaped).toContain('a&amp;b')
  })
})

describe('buildJsonLd', () => {
  const data = JSON.parse(buildJsonLd(meta, ORIGIN))

  it('emits one WebApplication per tool, in order, positions from 1', () => {
    const items = data.mainEntity.itemListElement
    expect(items.map((i: { url: string }) => i.url)).toEqual(
      tools.map((t) => `${ORIGIN}/${t.slug}`),
    )
    expect(items.map((i: { position: number }) => i.position)).toEqual(
      tools.map((_, i) => i + 1),
    )
  })

  it('maps security tools to SecurityApplication and the rest to DeveloperApplication', () => {
    const byUrl = new Map<string, string>(
      data.mainEntity.itemListElement.map((i: { url: string; applicationCategory: string }) => [
        i.url,
        i.applicationCategory,
      ]),
    )
    expect(byUrl.get(`${ORIGIN}/jwt`)).toBe('SecurityApplication')
    expect(byUrl.get(`${ORIGIN}/jq`)).toBe('DeveloperApplication')
  })

  it('names every tool in the collection description', () => {
    for (const tool of tools) expect(data.description).toContain(tool.name)
  })
})

describe('buildDescription', () => {
  it('names the tools, newest ones included', () => {
    const text = buildDescription(meta)
    expect(text.startsWith('Developer tools that run entirely in your browser: ')).toBe(true)
    expect(text).toContain(tools[0].name)
  })

  it('stays inside what a search result or link preview shows', () => {
    expect(buildDescription(meta).length).toBeLessThanOrEqual(DESCRIPTION_LIMIT)
  })

  it('trims to whole names and says there are more', () => {
    const text = buildDescription(meta, 90)
    expect(text.length).toBeLessThanOrEqual(90)
    expect(text).toMatch(/ and more\.$/)
    // whatever it kept, it kept in full
    const listed = text.split('browser: ')[1].replace(' and more.', '').split(', ')
    for (const name of listed) expect(tools.map((t) => t.name)).toContain(name)
  })

  it('reads as a list when everything fits', () => {
    const short = [
      { slug: 'a', name: 'Alpha', tagline: 't', category: 'text' },
      { slug: 'b', name: 'Beta', tagline: 't', category: 'text' },
    ]
    expect(buildDescription(short)).toBe(
      'Developer tools that run entirely in your browser: Alpha, and Beta.',
    )
  })

  it('keeps at least one tool even under an impossible limit', () => {
    expect(buildDescription(meta, 10)).toContain(tools[0].name)
  })
})

describe('injectMeta', () => {
  const html = `<head>
    <meta name="description" content="stale list" />
    <meta property="og:description" content="untouched" />
    <meta name="twitter:description" content="also stale" />
  </head>`

  it('rewrites both tool-naming descriptions and leaves og:description alone', () => {
    const out = injectMeta(html, meta)
    expect(out).not.toContain('stale')
    expect(out).toContain('content="untouched"')
    expect(out.match(/Developer tools that run entirely in your browser/g)).toHaveLength(2)
  })

  it('escapes characters that would break the attribute', () => {
    // "JWT decode & generate" must not put a bare ampersand in the markup
    const out = injectMeta(html, [
      { slug: 'x', name: 'A & B "quoted"', tagline: 't', category: 'text' },
    ])
    expect(out).toContain('A &amp; B &quot;quoted&quot;')
    expect(out).not.toMatch(/content="[^"]*&(?!amp;|quot;|lt;|gt;)/)
  })

  it('throws instead of silently shipping a stale description', () => {
    expect(() => injectMeta('<head></head>', meta)).toThrow(/no <meta name="description">/)
    expect(() =>
      injectMeta('<head><meta name="description" content="x" /></head>', meta),
    ).toThrow(/twitter:description/)
  })
})

describe('injectJsonLd', () => {
  const html = `<head>
    <script>theme()</script>
    <script type="application/ld+json">
    {"@type": "stale"}
    </script>
    <title>x</title>
  </head>`

  it('replaces only the JSON-LD block', () => {
    const out = injectJsonLd(html, meta, ORIGIN)
    expect(out).not.toContain('"stale"')
    expect(out).toContain('<script>theme()</script>') // CSP-hashed inline script untouched
    expect(out).toContain('<title>x</title>')
    expect(out.match(/<script type="application\/ld\+json">/g)).toHaveLength(1)
  })

  it('produces parseable JSON inside the block', () => {
    const out = injectJsonLd(html, meta, ORIGIN)
    const body = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(out)![1]
    expect(JSON.parse(body).mainEntity.itemListElement).toHaveLength(tools.length)
  })

  it('throws instead of silently shipping a stale list', () => {
    expect(() => injectJsonLd('<head></head>', meta, ORIGIN)).toThrow(/no <script/)
  })
})
