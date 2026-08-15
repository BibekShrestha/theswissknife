import { describe, expect, it } from 'vitest'
import {
  buildSwManifest,
  buildWebManifest,
  ICON_FILES,
  injectPwaTags,
  inlineSwManifest,
  WEB_MANIFEST_FILE,
  type BundleEntry,
} from '../../scripts/sw-manifest'
// the same file the build transpiles, read as text rather than imported
import swSource from '../sw.ts?raw'

/**
 * A bundle shaped like the real one: an entry chunk with a shared runtime and
 * its CSS, a tool reached only by dynamic import, and the binaries that make
 * offline support worth having.
 */
const bundle: Record<string, BundleEntry> = {
  'assets/index-aaa.js': {
    type: 'chunk',
    isEntry: true,
    imports: ['assets/rolldown-runtime-bbb.js'],
    viteMetadata: { importedCss: ['assets/index-ccc.css'] },
  },
  'assets/rolldown-runtime-bbb.js': { type: 'chunk', imports: [] },
  'assets/index-ccc.css': { type: 'asset' },
  // dynamic: reachable only through registry.ts's load() thunk
  'assets/jq-ddd.js': { type: 'chunk', imports: ['assets/rolldown-runtime-bbb.js'] },
  'assets/jq-eee.wasm': { type: 'asset' },
  'assets/MaterialSymbolsOutlined-fff.woff2': { type: 'asset' },
}

const extraCore = [WEB_MANIFEST_FILE, ...ICON_FILES].map((file) => `/${file}`)

describe('buildSwManifest', () => {
  const manifest = buildSwManifest(bundle, '/', extraCore)

  it('precaches the shell and nothing else', () => {
    expect(manifest.core).toEqual([
      '/',
      '/assets/index-aaa.js',
      '/assets/rolldown-runtime-bbb.js',
      '/assets/index-ccc.css',
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/maskable-512.png',
      '/icons/apple-touch-icon.png',
    ])
  })

  /**
   * The guard that matters. A tool's chunk arriving in `core` would turn a
   * first visit into a multi-megabyte download — the jq wasm alone is 929 KB.
   */
  it('leaves dynamically imported tools out of the precache', () => {
    expect(manifest.core).not.toContain('/assets/jq-ddd.js')
    expect(manifest.core).not.toContain('/assets/jq-eee.wasm')
  })

  it('serves the navigation shell from base, not index.html', () => {
    // Vite's HTML plugin also emits during generateBundle, so index.html may
    // not be in the bundle yet when the list is built.
    expect(manifest.core[0]).toBe('/')
  })

  /**
   * These are the files a precache list built from dist/.vite/manifest.json
   * misses, and each one is a tool that silently stops working offline.
   */
  it('owns the assets no Vite manifest would list', () => {
    expect(manifest.assets).toContain('/assets/jq-eee.wasm')
    expect(manifest.assets).toContain('/assets/MaterialSymbolsOutlined-fff.woff2')
    expect(manifest.assets).toContain('/assets/jq-ddd.js')
  })

  it('covers every emitted file plus the shell', () => {
    for (const file of Object.keys(bundle)) expect(manifest.assets).toContain(`/${file}`)
    for (const url of manifest.core) expect(manifest.assets).toContain(url)
  })

  it('follows base so a project-path deploy still resolves', () => {
    const scoped = buildSwManifest(bundle, '/theswissknife/', ['/theswissknife/manifest.webmanifest'])
    expect(scoped.core[0]).toBe('/theswissknife/')
    expect(scoped.core).toContain('/theswissknife/assets/index-aaa.js')
    expect(scoped.assets.every((url) => url.startsWith('/theswissknife/'))).toBe(true)
  })

  it('throws instead of shipping a worker that caches nothing', () => {
    expect(() => buildSwManifest({ 'assets/x.css': { type: 'asset' } }, '/')).toThrow(/no entry chunk/)
  })
})

describe('buildSwManifest across deploys', () => {
  const next: Record<string, BundleEntry> = {
    ...bundle,
    'assets/index-zzz.js': bundle['assets/index-aaa.js'],
  }
  delete next['assets/index-aaa.js']

  const before = buildSwManifest(bundle, '/', extraCore)
  const after = buildSwManifest(next, '/', extraCore)

  /**
   * The version names the caches, and it is also what makes sw.js differ
   * byte-wise between deploys — without that the browser never notices there
   * is an update at all.
   */
  it('changes the version when any file name changes', () => {
    expect(after.version).not.toBe(before.version)
  })

  /**
   * index.html and the icons keep the same URL forever, so a deploy that only
   * edits them leaves every hashed name untouched. Without the contents in the
   * hash, sw.js comes out byte-identical and the update is invisible.
   */
  it('changes the version when a file that is not content-addressed changes', () => {
    const a = buildSwManifest(bundle, '/', extraCore, 'icons-v1')
    const b = buildSwManifest(bundle, '/', extraCore, 'icons-v2')
    expect(a.version).not.toBe(b.version)
    expect(a.core).toEqual(b.core)
  })

  it('drops the replaced chunk from the owned set so activate can prune it', () => {
    expect(after.assets).not.toContain('/assets/index-aaa.js')
    expect(after.assets).toContain('/assets/index-zzz.js')
  })

  /** Unchanged chunks keep their hashed name, so a deploy must not evict them. */
  it('keeps unchanged chunks owned, so a cached tool survives a deploy', () => {
    expect(after.assets).toContain('/assets/jq-ddd.js')
    expect(after.assets).toContain('/assets/jq-eee.wasm')
  })
})

describe('inlineSwManifest', () => {
  const manifest = buildSwManifest(bundle, '/', extraCore)

  it('inlines the manifest and strips the module marker', () => {
    const out = inlineSwManifest('const M = __SW_MANIFEST__;\nexport {};\n', manifest)
    expect(out).toContain('"/assets/index-aaa.js"')
    expect(out).not.toContain('__SW_MANIFEST__')
    expect(out).not.toMatch(/^\s*export\b/m)
  })

  it('throws rather than shipping a worker with the placeholder still in it', () => {
    expect(() => inlineSwManifest('const M = {};', manifest)).toThrow(/__SW_MANIFEST__/)
  })

  /**
   * A worker split across files cannot be loaded by a classic registration, so
   * a surviving import means the build produced something that would fail to
   * install in the browser rather than here.
   */
  it('throws when the worker is not self-contained', () => {
    expect(() => inlineSwManifest("import x from './x'\nconst M = __SW_MANIFEST__", manifest)).toThrow(
      /self-contained/,
    )
  })

  it('keeps the real service worker source and the placeholder in agreement', () => {
    expect(swSource).toContain('__SW_MANIFEST__')
  })
})

describe('buildWebManifest', () => {
  it('resolves start_url, scope and icons against base', () => {
    const data = JSON.parse(buildWebManifest({ base: '/theswissknife/', description: 'tools' }))
    expect(data.start_url).toBe('/theswissknife/')
    expect(data.scope).toBe('/theswissknife/')
    expect(data.icons.map((i: { src: string }) => i.src)).toEqual([
      '/theswissknife/icons/icon-192.png',
      '/theswissknife/icons/icon-512.png',
      '/theswissknife/icons/maskable-512.png',
    ])
  })

  it('ships a maskable icon so an installed launcher does not letterbox it', () => {
    const data = JSON.parse(buildWebManifest({ base: '/', description: 'tools' }))
    expect(data.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  })
})

describe('injectPwaTags', () => {
  const html = '<head>\n    <title>x</title>\n  </head>'

  it('links the manifest and the iOS icon', () => {
    const out = injectPwaTags(html, '/')
    expect(out).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(out).toContain('href="/icons/apple-touch-icon.png"')
    expect(out).toContain('<title>x</title>')
  })

  it('is idempotent, so dev transforms cannot stack tags', () => {
    expect(injectPwaTags(injectPwaTags(html, '/'), '/')).toBe(injectPwaTags(html, '/'))
  })

  it('throws instead of silently shipping a site that cannot be installed', () => {
    expect(() => injectPwaTags('<html></html>', '/')).toThrow(/no <\/head>/)
  })
})
