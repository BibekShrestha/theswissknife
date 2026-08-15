/**
 * Build-time SEO metadata, derived from the tool registry.
 *
 * sitemap.xml and the landing page's JSON-LD used to list tools by hand, so
 * every new tool silently shipped invisible to crawlers. Both are generated
 * from src/shell/registry.ts instead, keeping "one folder plus one registry
 * line" the only place a tool is declared.
 *
 * Everything here is pure — the Vite config passes file contents in — so the
 * tests can exercise it without touching the filesystem.
 *
 * The registry is handled as text rather than imported: it carries
 * `load: () => import('../tools/…')` thunks, and pulling those into the Vite
 * config bundle would drag the whole app (and its CSS) along with it.
 * src/shell/tool-meta.test.ts asserts this parser and the real registry stay
 * in agreement.
 */

export interface ToolSeoMeta {
  slug: string
  name: string
  tagline: string
  category: string
}

export const DEFAULT_ORIGIN = 'https://theswissknife.com'

/** The deployment domain, kept single-sourced with the CNAME we publish. */
export function originFromCname(cname: string | undefined): string {
  const host = cname?.trim()
  return host ? `https://${host}` : DEFAULT_ORIGIN
}

function quotedField(chunk: string, field: string): string | undefined {
  const match = new RegExp(`\\b${field}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(chunk)
  return match ? match[1].replace(/\\(.)/g, '$1') : undefined
}

export function parseToolMeta(source: string): ToolSeoMeta[] {
  // Split at each entry's slug — the ToolMeta interface declares `slug: string`
  // without quotes, so the type definition never matches.
  const chunks = source.split(/(?=\bslug:\s*')/g).slice(1)
  const tools: ToolSeoMeta[] = []
  for (const chunk of chunks) {
    const slug = quotedField(chunk, 'slug')
    const name = quotedField(chunk, 'name')
    const tagline = quotedField(chunk, 'tagline')
    const category = quotedField(chunk, 'category')
    if (slug && name && tagline && category) tools.push({ slug, name, tagline, category })
  }
  return tools
}

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Landing page first, then tools in registry order. */
export function buildSitemap(tools: ToolSeoMeta[], origin = DEFAULT_ORIGIN): string {
  const entry = (loc: string, priority: string) =>
    `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <priority>${priority}</priority>\n  </url>`
  const urls = [
    entry(`${origin}/`, '1.0'),
    ...tools.map((tool) => entry(`${origin}/${tool.slug}`, '0.8')),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

function schemaCategory(category: string): string {
  return category === 'security' ? 'SecurityApplication' : 'DeveloperApplication'
}

function sentenceList(items: string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function buildJsonLd(tools: ToolSeoMeta[], origin = DEFAULT_ORIGIN): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'The Swiss Knife',
    url: `${origin}/`,
    description: `Developer tools that run entirely in your browser: ${sentenceList(tools.map((t) => t.name))}.`,
    about: { '@type': 'Thing', name: 'Developer utilities' },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: tools.map((tool, i) => ({
        '@type': 'WebApplication',
        position: i + 1,
        name: tool.name,
        url: `${origin}/${tool.slug}`,
        applicationCategory: schemaCategory(tool.category),
        operatingSystem: 'Any',
        description: tool.tagline,
      })),
    },
  }
  return JSON.stringify(data, null, 2)
}

/**
 * A link preview shows about this much, and a search result rather less. The
 * markup names every tool it can fit: a search engine truncating the display is
 * its business, but a tool missing from the description entirely is ours.
 */
export const DESCRIPTION_LIMIT = 200

const DESCRIPTION_PREFIX = 'Developer tools that run entirely in your browser: '

/**
 * The meta description, naming as many tools as fit. Past the limit the list
 * ends with "and more" rather than being cut off mid-name.
 */
export function buildDescription(tools: ToolSeoMeta[], limit = DESCRIPTION_LIMIT): string {
  const names = tools.map((tool) => tool.name)
  const render = (items: string[]) =>
    `${DESCRIPTION_PREFIX}${
      items.length < names.length ? `${items.join(', ')} and more` : sentenceList(items)
    }.`

  let fitted: string[] = []
  for (const name of names) {
    const candidate = [...fitted, name]
    if (render(candidate).length > limit && fitted.length > 0) break
    fitted = candidate
  }
  return render(fitted)
}

const attributeEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** The meta tags that name tools; og:description stays generic, so it cannot go stale. */
const DESCRIBED_TAGS = ['description', 'twitter:description']

const metaPattern = (name: string) => new RegExp(`(<meta name="${name}" content=")[^"]*(")`)

/** Rewrite the tool-naming meta descriptions from the registry. */
export function injectMeta(html: string, tools: ToolSeoMeta[]): string {
  const description = attributeEscape(buildDescription(tools))
  let out = html
  for (const name of DESCRIBED_TAGS) {
    const pattern = metaPattern(name)
    if (!pattern.test(out)) {
      // Loud failure: a silent no-op would ship a stale tool list.
      throw new Error(`tool-meta: no <meta name="${name}"> found in index.html`)
    }
    out = out.replace(pattern, `$1${description}$2`)
  }
  return out
}

const JSON_LD_BLOCK = /<script type="application\/ld\+json">[\s\S]*?<\/script>/

/** Swap the JSON-LD block in index.html for freshly generated data. */
export function injectJsonLd(html: string, tools: ToolSeoMeta[], origin = DEFAULT_ORIGIN): string {
  if (!JSON_LD_BLOCK.test(html)) {
    // Loud failure: a silent no-op would ship a stale tool list.
    throw new Error('tool-meta: no <script type="application/ld+json"> block found in index.html')
  }
  const indented = buildJsonLd(tools, origin)
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n')
  return html.replace(
    JSON_LD_BLOCK,
    `<script type="application/ld+json">\n${indented}\n    </script>`,
  )
}
