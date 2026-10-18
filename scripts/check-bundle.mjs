import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { cspProblems, inlineScripts } from './csp-hash.mjs'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const entry = manifest['index.html'] ?? manifest['src/main.tsx']

if (!entry?.file) throw new Error('Could not find the main entry in the Vite manifest.')

// The entry plus every chunk it imports statically: the bundler may hoist
// shared code (the JSX runtime, interop helpers) into small chunks of their
// own once enough lazy chunks share it. Those still load on first paint, so
// measuring the entry file alone would let the budget quietly undercount.
const eager = new Set()
const walk = (key) => {
  const chunk = manifest[key]
  if (!chunk || eager.has(chunk.file)) return
  eager.add(chunk.file)
  for (const dep of chunk.imports ?? []) walk(dep)
}
walk(manifest['index.html'] ? 'index.html' : 'src/main.tsx')

const bytes = [...eager].reduce((sum, file) => sum + gzipSync(readFileSync(`dist/${file}`)).byteLength, 0)

// Read from src/shell/registry.ts rather than repeating the slugs: a hardcoded
// list stops guarding the moment someone adds a tool and forgets this file.
const registry = readFileSync('src/shell/registry.ts', 'utf8')
const required = [...registry.matchAll(/\bslug:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1])

// The entry chunk is react + the shell + one registry line per tool (slug,
// name, mark, category, loader: ~0.05 KiB gzipped — taglines load lazily from
// src/shell/tool-copy.ts). The budget is there to catch the shell growing or a
// tool leaking into the eager graph, not to police registry lines, so it grows
// with the tool count: a per-tool allowance above the real cost, on top of a
// fixed shell allowance. Anything chunk-shaped still trips it — the smallest
// tool chunk is ~2.3 KiB gzipped.
const SHELL_KIB = 65.9
const PER_TOOL_KIB = 0.08
const BUDGET_KIB = SHELL_KIB + PER_TOOL_KIB * required.length
const budget = BUDGET_KIB * 1024

if (bytes > budget) {
  throw new Error(
    `Main bundle is ${(bytes / 1024).toFixed(2)} KiB gzipped; budget is ${BUDGET_KIB.toFixed(2)} KiB ` +
      `(${SHELL_KIB} shell + ${PER_TOOL_KIB} × ${required.length} tools). ` +
      'Something outside shell/ reached the entry chunk, or the shell itself grew.',
  )
}


if (required.length === 0) throw new Error('Could not read any tool slugs from the registry.')

const sources = Object.keys(manifest)
for (const slug of required) {
  if (!sources.some((source) => source.includes(`/tools/${slug}/`))) {
    throw new Error(`Missing lazy build entry for /${slug} — is it imported outside its own chunk?`)
  }
}

// The service worker carries its precache list inlined, which is also what
// makes sw.js differ between deploys. A worker that still has the placeholder,
// or that never learned this build's entry chunk, would install and cache
// nothing — and would look perfectly healthy doing it.
const sw = readFileSync('dist/sw.js', 'utf8')

if (sw.includes('__SW_MANIFEST__')) {
  throw new Error('dist/sw.js still contains the __SW_MANIFEST__ placeholder.')
}
if (!sw.includes(entry.file)) {
  throw new Error(`dist/sw.js does not reference the entry chunk ${entry.file}; precache list is wrong.`)
}

// Every page draws icons, so the icon font is precached with the shell. That is
// only affordable because it is a subset (`npm run icon-font`); the full font is
// 3.9 MB, and putting it back would make every install download it.
const ICON_FONT_BUDGET_KIB = 64
const core = JSON.parse(/"core":(\[[^\]]*\])/.exec(sw)?.[1] ?? '[]')
const fonts = readdirSync('dist/assets').filter((file) => /^MaterialSymbolsOutlined-.*\.woff2$/.test(file))
if (fonts.length !== 1) throw new Error(`Expected one icon font in dist/assets, found ${fonts.length}.`)
const [font] = fonts
const fontBytes = statSync(`dist/assets/${font}`).size
if (!core.some((url) => url.endsWith(`/assets/${font}`))) {
  throw new Error(`dist/sw.js does not precache the icon font ${font}; icons would be words offline.`)
}
if (fontBytes > ICON_FONT_BUDGET_KIB * 1024) {
  throw new Error(
    `Icon font is ${(fontBytes / 1024).toFixed(1)} KiB, over its ${ICON_FONT_BUDGET_KIB} KiB budget — ` +
      'is src/shell/MaterialSymbolsOutlined.woff2 the full font again? Run `npm run icon-font`.',
  )
}

// The display face (hero, brands) is a subset too (`npm run display-font`).
const DISPLAY_FONT_BUDGET_KIB = 32
const displayFonts = readdirSync('dist/assets').filter((file) => /^InterTight-display-.*\.woff2$/.test(file))
if (displayFonts.length !== 1) throw new Error(`Expected one display font in dist/assets, found ${displayFonts.length}.`)
const displayBytes = statSync(`dist/assets/${displayFonts[0]}`).size
if (!core.some((url) => url.endsWith(`/assets/${displayFonts[0]}`))) {
  throw new Error(`dist/sw.js does not precache the display font ${displayFonts[0]}.`)
}
if (displayBytes > DISPLAY_FONT_BUDGET_KIB * 1024) {
  throw new Error(`Display font is ${(displayBytes / 1024).toFixed(1)} KiB, over its ${DISPLAY_FONT_BUDGET_KIB} KiB budget — run \`npm run display-font\`.`)
}

// The palette is how people get around; it is precached so search works
// offline before anyone has opened it (scripts/sw-manifest.ts, isShellChunk).
const palette = manifest['src/shell/CommandPalette.tsx']?.file
if (!palette || !core.some((url) => url.endsWith(`/${palette}`))) {
  throw new Error(`dist/sw.js does not precache the command palette chunk (${palette ?? 'not found'}).`)
}

// Every tool has its own page (vite.config.ts, toolPages) so /<slug> is served
// with a 200 and its own canonical — the same URL the sitemap lists.
const origin = (() => {
  try {
    const host = readFileSync('public/CNAME', 'utf8').trim()
    return host ? `https://${host}` : 'https://theswissknife.com'
  } catch {
    return 'https://theswissknife.com'
  }
})()
const sitemap = readFileSync('dist/sitemap.xml', 'utf8')
const indexHtml = readFileSync('dist/index.html', 'utf8')
const toolPages = required.map((slug) => `dist/${slug}.html`)
for (const [i, page] of toolPages.entries()) {
  let html
  try {
    html = readFileSync(page, 'utf8')
  } catch {
    throw new Error(`${page} is missing — /${required[i]} would be served as a 404.`)
  }
  const url = `${origin}/${required[i]}`
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]
  if (canonical !== url) throw new Error(`${page}: canonical is ${canonical}, expected ${url}`)
  if (!sitemap.includes(`<loc>${url}</loc>`)) throw new Error(`sitemap.xml does not list ${url}, the canonical of ${page}`)
  if (inlineScripts(html).join('\0') !== inlineScripts(indexHtml).join('\0')) {
    throw new Error(`${page}: inline scripts differ from dist/index.html`)
  }
}

// The served pages, not just the source: a blocked theme script would make
// every load paint unthemed until React starts.
for (const page of ['dist/index.html', 'dist/404.html', ...toolPages]) {
  const problems = cspProblems(readFileSync(page, 'utf8'))
  if (problems.length) throw new Error(`${page}: ${problems.join('; ')}`)
}

console.log(
  `main bundle ${(bytes / 1024).toFixed(2)} KiB gzip (${((budget - bytes) / 1024).toFixed(2)} KiB under the ${BUDGET_KIB.toFixed(2)} KiB budget) · ${required.length} lazy tool chunks and pages · sw.js ${(sw.length / 1024).toFixed(2)} KiB · icon font ${(fontBytes / 1024).toFixed(1)} KiB · display font ${(displayBytes / 1024).toFixed(1)} KiB precached`,
)
