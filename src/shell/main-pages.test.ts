import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import readme from '../../README.md?raw'
import { buildDescription, buildJsonLd, buildSitemap, parseToolMeta } from '../../scripts/tool-meta'
import registrySource from './registry.ts?raw'
import { categories } from './Landing'
import { tools } from './registry'
import { ToolSidebar } from './ToolSidebar'

/**
 * "One folder plus one registry line" only holds if a registry line is enough
 * to appear everywhere. It has not always been: the landing page, the README
 * table and the meta descriptions were each maintained by hand, and each went
 * stale the moment a tool was added.
 *
 * These are the places a new tool has to reach. A failure here means the tool
 * exists but nobody can find it — not a cosmetic problem.
 */

const meta = parseToolMeta(registrySource)

describe('the landing page lists every tool', () => {
  it('has a category for each tool', () => {
    const known = new Set(categories.map((category) => category.id))
    const orphaned = tools.filter((tool) => !known.has(tool.category))
    expect(
      orphaned.map((tool) => `${tool.slug} (category "${tool.category}")`),
      'add the category to `categories` in src/shell/Landing.tsx, or the tool renders nowhere',
    ).toEqual([])
  })

  it('has no category without tools', () => {
    const used = new Set<string>(tools.map((tool) => tool.category))
    const empty = categories.filter((category) => !used.has(category.id))
    expect(empty.map((category) => category.id), 'dead entry in Landing.tsx').toEqual([])
  })
})

describe('the persistent tool index lists every tool', () => {
  const markup = renderToStaticMarkup(
    createElement(ToolSidebar, { path: 'jq', open: false, onClose: () => undefined }),
  )

  it('derives every route from the registry', () => {
    const missing = tools.filter((tool) => !markup.includes(`href="/${tool.slug}"`))
    expect(missing.map((tool) => tool.slug)).toEqual([])
  })

  it('marks the current tool for sighted and assistive navigation', () => {
    expect(markup).toContain('class="active" aria-current="page" href="/jq"')
  })
})

describe('the README lists every tool', () => {
  it('links each tool from the table', () => {
    const missing = tools.filter((tool) => !readme.includes(`(https://theswissknife.com/${tool.slug})`))
    expect(
      missing.map((tool) => tool.slug),
      'add a row to the tool table in README.md',
    ).toEqual([])
  })

  it('names each tool in its row', () => {
    const missing = tools.filter((tool) => !readme.includes(`| ${tool.name} |`))
    expect(missing.map((tool) => tool.name), 'the row exists but the name does not match').toEqual(
      [],
    )
  })
})

describe('the crawlable metadata covers every tool', () => {
  it('puts every tool in the sitemap', () => {
    const xml = buildSitemap(meta)
    for (const tool of tools) expect(xml).toContain(`/${tool.slug}<`)
  })

  it('puts every tool in the landing JSON-LD', () => {
    const data = JSON.parse(buildJsonLd(meta))
    const urls = data.mainEntity.itemListElement.map((item: { url: string }) => item.url)
    for (const tool of tools) expect(urls).toContain(`https://theswissknife.com/${tool.slug}`)
  })

  it('names every tool in the meta description, or admits it stopped early', () => {
    const description = buildDescription(meta)
    const named = tools.filter((tool) => description.includes(tool.name))
    if (named.length !== tools.length) {
      // Truncation is allowed — silently dropping the tail is not.
      expect(description).toMatch(/ and more\.$/)
    }
    expect(named.length).toBeGreaterThan(0)
  })
})

describe('the build guards every tool chunk', () => {
  it('derives its slug list from the registry, so it cannot drift', async () => {
    const source = await import('../../scripts/check-bundle.mjs?raw').then((m) => m.default)
    expect(
      source,
      'check-bundle.mjs should read src/shell/registry.ts rather than hardcode slugs',
    ).toContain('registry.ts')
  })
})
