import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  buildSitemap,
  injectJsonLd,
  injectMeta,
  originFromCname,
  parseToolMeta,
} from './scripts/tool-meta'

const read = (relative: string) => {
  try {
    return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
  } catch {
    return undefined
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

export default defineConfig({
  plugins: [react(), toolSeo()],
  // GitHub Pages serves project sites under /<repo-name>/ — the deploy
  // workflow sets BASE_PATH accordingly; local dev stays at /.
  base: process.env.BASE_PATH || '/',
  build: { target: 'es2022', manifest: true },
  worker: { format: 'es' },
})
