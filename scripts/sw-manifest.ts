/**
 * The build-time half of the PWA: what the service worker precaches, what the
 * webmanifest says, and the tags that point index.html at both.
 *
 * Everything here is pure — the Vite plugin passes the bundle in — so
 * src/shell/sw-manifest.test.ts can exercise it against a fake one, the same
 * way scripts/tool-meta.ts is tested.
 *
 * Why the bundle and not dist/.vite/manifest.json: the Vite manifest lists
 * source-to-chunk entries, and misses the things that actually cost a user
 * their offline session — the jq wasm, the pdf.js worker, the icon font. The
 * Rollup bundle is every emitted file, so the precache list is derived there.
 */
/**
 * Small content hash (cyrb53). Not cryptographic — it only has to change when
 * the file list does. Hand-rolled rather than node:crypto because
 * src/shell/sw-manifest.test.ts pulls this module into the app's tsc program,
 * which carries DOM types and no node ones.
 */
function hash(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/** Structural subset of Rollup's OutputBundle — enough to avoid depending on its types. */
export interface BundleEntry {
  type: 'chunk' | 'asset'
  isEntry?: boolean
  /** Static imports only. Dynamic ones live in `dynamicImports` and are deliberately not walked. */
  imports?: readonly string[]
  viteMetadata?: { importedCss?: Iterable<string> }
}

export interface SwManifest {
  /** Changes whenever `core` or `assets` does; names the caches. */
  version: string
  /** Precached during install — the shell, and nothing else. */
  core: string[]
  /** Every URL this build owns. Anything else in the runtime cache is stale. */
  assets: string[]
}

const withBase = (base: string, file: string) => `${base.replace(/\/$/, '')}/${file}`

/**
 * Walks the entry chunk's *static* import graph. Dynamic imports — every tool,
 * every PDF subtool, the command palette — are left out on purpose: that split
 * is what keeps the install cheap and defers a tool's chunk, worker and wasm to
 * the first time someone actually opens it.
 */
function eagerGraph(bundle: Record<string, BundleEntry>): { files: string[]; css: string[] } {
  const files: string[] = []
  const css = new Set<string>()
  const seen = new Set<string>()

  const visit = (file: string) => {
    const entry = bundle[file]
    if (!entry || entry.type !== 'chunk' || seen.has(file)) return
    seen.add(file)
    files.push(file)
    for (const id of entry.viteMetadata?.importedCss ?? []) css.add(id)
    for (const imported of entry.imports ?? []) visit(imported)
  }

  for (const [file, entry] of Object.entries(bundle)) {
    if (entry.type === 'chunk' && entry.isEntry) visit(file)
  }
  return { files, css: [...css] }
}

/**
 * @param extraCore  Files outside the bundle that the shell still needs offline
 *                   — the webmanifest and the icons, copied from public/.
 * @param fingerprint  Contents of the precached files whose names are *not*
 *                   content-addressed: index.html, the webmanifest, the icons.
 *                   Without it, editing an icon or the HTML leaves every hashed
 *                   asset name untouched, so sw.js comes out byte-identical and
 *                   no browser ever notices there was a deploy.
 */
export function buildSwManifest(
  bundle: Record<string, BundleEntry>,
  base: string,
  extraCore: readonly string[] = [],
  fingerprint = '',
): SwManifest {
  const { files, css } = eagerGraph(bundle)
  if (files.length === 0) {
    // Loud failure: an empty precache list ships a service worker that caches nothing.
    throw new Error('sw-manifest: no entry chunk found in the bundle')
  }

  // The navigation shell is cached under base itself, not index.html — Vite's
  // HTML plugin also emits during generateBundle, so bundle['index.html'] may
  // not exist yet when this runs.
  const shell = base.endsWith('/') ? base : `${base}/`
  const core = [shell, ...[...files, ...css].map((f) => withBase(base, f)), ...extraCore]

  const assets = [
    ...new Set([...core, ...Object.keys(bundle).map((f) => withBase(base, f))]),
  ].sort()

  return {
    version: hash(JSON.stringify([core, assets, fingerprint])),
    core: [...new Set(core)],
    assets,
  }
}

const PLACEHOLDER = '__SW_MANIFEST__'

/**
 * Inlines the manifest into the transpiled worker. This is also what makes
 * sw.js differ byte-wise between deploys — a byte-identical sw.js is a service
 * worker the browser will never notice has changed.
 */
export function inlineSwManifest(code: string, manifest: SwManifest): string {
  if (!code.includes(PLACEHOLDER)) {
    throw new Error(`sw-manifest: ${PLACEHOLDER} not found in the service worker source`)
  }
  // TypeScript's module marker; without it sw.js would have to register as a
  // module worker, which older browsers cannot do.
  const out = code
    .replaceAll(PLACEHOLDER, JSON.stringify(manifest))
    .replace(/^[ \t]*export\s*\{\s*\}\s*;?[ \t]*$/m, '')
  const stray = /^[ \t]*(?:import|export)\b/m.exec(out)
  if (stray) {
    throw new Error(
      `sw-manifest: service worker still has a top-level "${stray[0].trim()}" — it must be self-contained`,
    )
  }
  return out
}

export interface WebManifestOptions {
  base: string
  description: string
}

/**
 * Generated rather than shipped as a static public/ file so start_url, scope
 * and the icon paths follow config.base — correct on the apex domain and on a
 * GitHub Pages project path alike.
 */
export function buildWebManifest({ base, description }: WebManifestOptions): string {
  const icon = (file: string, size: number, purpose: 'any' | 'maskable') => ({
    src: withBase(base, `icons/${file}`),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose,
  })
  return `${JSON.stringify(
    {
      name: 'The Swiss Knife',
      short_name: 'Swiss Knife',
      description,
      start_url: base,
      scope: base,
      display: 'standalone',
      // Matches the <meta name="theme-color"> default in index.html; the app
      // swaps that meta at runtime, but a manifest colour has to be static.
      theme_color: '#f4f1ea',
      background_color: '#f4f1ea',
      icons: [
        icon('icon-192.png', 192, 'any'),
        icon('icon-512.png', 512, 'any'),
        icon('maskable-512.png', 512, 'maskable'),
      ],
    },
    null,
    2,
  )}\n`
}

/** Files under public/icons/ that the shell precaches, relative to the bundle root. */
export const ICON_FILES = [
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
]

export const WEB_MANIFEST_FILE = 'manifest.webmanifest'

const HEAD_CLOSE = '</head>'

/**
 * Injected rather than written into index.html by hand so the hrefs pick up
 * base. Kept out of the CSP's way: these are links, not inline script, so the
 * hash-pinned script-src is untouched.
 */
export function injectPwaTags(html: string, base: string): string {
  if (!html.includes(HEAD_CLOSE)) {
    // Loud failure: a silent no-op would ship a site that cannot be installed.
    throw new Error('sw-manifest: no </head> found in index.html')
  }
  if (html.includes('rel="manifest"')) return html
  const tags = [
    `<link rel="manifest" href="${withBase(base, WEB_MANIFEST_FILE)}" />`,
    `<link rel="apple-touch-icon" href="${withBase(base, 'icons/apple-touch-icon.png')}" />`,
    `<meta name="apple-mobile-web-app-title" content="Swiss Knife" />`,
  ]
  return html.replace(HEAD_CLOSE, `  ${tags.join('\n    ')}\n  ${HEAD_CLOSE}`)
}
