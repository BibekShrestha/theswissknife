import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, transformWithOxc, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  buildDescription,
  buildSitemap,
  injectJsonLd,
  injectMeta,
  originFromCname,
  parseToolMeta,
} from './scripts/tool-meta'
import {
  buildSwManifest,
  buildWebManifest,
  ICON_FILES,
  injectPwaTags,
  inlineSwManifest,
  WEB_MANIFEST_FILE,
  type BundleEntry,
} from './scripts/sw-manifest'

const read = (relative: string) => {
  try {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  } catch {
    return undefined
  }
}

/** Binary-safe read, for hashing files whose URL never changes (the PNG icons). */
const readBytes = (relative: string) => {
  try {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url))).toString('base64')
  } catch {
    return ''
  }
}

/**
 * Generates sitemap.xml and the landing page's JSON-LD from the tool registry,
 * so adding a tool cannot leave the SEO metadata stale. The registry is re-read
 * per build (and per dev request) to pick up edits.
 */
function toolSeo(): Plugin {
  const meta = () => parseToolMeta(read('./src/shell/registry.ts') ?? '')
  const origin = () => originFromCname(read('./public/CNAME'))

  return {
    name: 'tool-seo',
    transformIndexHtml(html) {
      const tools = meta()
      return injectMeta(injectJsonLd(html, tools, origin()), tools)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: buildSitemap(meta(), origin()) })
    },
    configureServer(server) {
      // dev parity: sitemap.xml is emitted at build time, not a file on disk
      server.middlewares.use('/sitemap.xml', (_req, res) => {
        res.setHeader('Content-Type', 'application/xml')
        res.end(buildSitemap(meta(), origin()))
      })
    },
  }
}

/**
 * Makes the site installable and usable offline: emits manifest.webmanifest and
 * sw.js, and points index.html at them.
 *
 * The service worker is transpiled and emitted rather than made a Rollup input,
 * because a second input can pick up the shared rolldown runtime chunk — and a
 * service worker split across files is one a classic registration cannot load.
 * emitFile with an explicit fileName is also what pins it to the root, which is
 * what gives it root scope.
 */
function pwa(): Plugin {
  let base = '/'
  const description = () => buildDescription(parseToolMeta(read('./src/shell/registry.ts') ?? ''))

  return {
    name: 'pwa',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml(html) {
      return injectPwaTags(html, base)
    },
    async generateBundle(_options, bundle) {
      const extraCore = [WEB_MANIFEST_FILE, ...ICON_FILES].map((file) => `${base}${file}`)
      const webManifest = buildWebManifest({ base, description: description() })

      // index.html and the icons keep the same URL forever, so their contents
      // have to reach the version directly or a deploy that only touches them
      // produces a byte-identical sw.js that no browser treats as an update.
      const fingerprint = [
        webManifest,
        read('./index.html') ?? '',
        ...ICON_FILES.map((file) => readBytes(`./public/${file}`)),
      ].join('\0')

      const manifest = buildSwManifest(
        bundle as unknown as Record<string, BundleEntry>,
        base,
        extraCore,
        fingerprint,
      )

      const source = read('./src/sw.ts')
      if (!source) throw new Error('pwa: src/sw.ts not found')
      const { code } = await transformWithOxc(source, 'sw.ts', { lang: 'ts', target: 'es2022' })

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: inlineSwManifest(code, manifest) })
      this.emitFile({ type: 'asset', fileName: WEB_MANIFEST_FILE, source: webManifest })
    },
    configureServer(server) {
      // dev parity: the manifest is emitted at build time, not a file on disk.
      // sw.js deliberately has no dev equivalent — src/shell/pwa.ts only
      // registers in a production build.
      server.middlewares.use(`/${WEB_MANIFEST_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json')
        res.end(buildWebManifest({ base, description: description() }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), toolSeo(), pwa()],
  // GitHub Pages serves project sites under /<repo-name>/ — the deploy
  // workflow sets BASE_PATH accordingly; local dev stays at /.
  base: process.env.BASE_PATH || '/',
  build: { target: 'es2022', manifest: true },
  worker: { format: 'es' },
})
