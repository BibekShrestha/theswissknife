/**
 * The Swiss Knife service worker.
 *
 * Shell eager, tools on use: install precaches only the app shell, and each
 * tool's chunk, worker and wasm is cached the first time someone opens that
 * tool. Precaching everything would mean a ~7.8 MB download for a visitor who
 * only wanted to decode a JWT; the jq wasm alone is 929 KB and the pdf.js
 * worker 1.26 MB.
 *
 * Deliberately self-contained — no imports. The build transpiles this file and
 * emits it verbatim as /sw.js (see scripts/sw-manifest.ts), so it cannot be
 * code-split into a module graph that a classic worker registration can't load.
 * The interesting logic — deriving what goes in MANIFEST — lives on the build
 * side, where it is a pure function and unit-tested.
 *
 * The worker globals below are declared locally: TypeScript's DOM lib carries
 * Cache/CacheStorage/caches but not ServiceWorkerGlobalScope, and pulling in
 * the WebWorker lib would apply it to the whole program and collide with DOM.
 */

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  respondWith(response: Response | Promise<Response>): void
}

interface ServiceWorkerScope {
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  skipWaiting(): Promise<void>
  readonly clients: { claim(): Promise<void> }
}

interface SwManifest {
  version: string
  core: string[]
  assets: string[]
}

/** Replaced at build time with this build's real list. */
declare const __SW_MANIFEST__: SwManifest

const MANIFEST = __SW_MANIFEST__

const sw = self as unknown as ServiceWorkerScope

const CORE_CACHE = `tsk-core-${MANIFEST.version}`
/** Not versioned: pruning keeps it honest, so unchanged chunks survive a deploy. */
const RUNTIME_CACHE = 'tsk-runtime'

/** Every URL this build owns. Anything else is either stale or none of our business. */
const OWNED = new Set(MANIFEST.assets)

/** The navigation shell — base itself, precached so deep links work offline. */
const SHELL = MANIFEST.core[0]

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE).then((cache) =>
      // 'reload' so a stale HTTP cache can't seed the precache with old bytes.
      cache.addAll(MANIFEST.core.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  )
  // No skipWaiting(): the page offers the user a reload instead of pulling the
  // rug out from under whatever they were in the middle of typing.
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('tsk-core-') && name !== CORE_CACHE) await caches.delete(name)
      }

      // Drop runtime entries this build no longer owns. Chunks whose content
      // didn't change keep their hashed name, so a deploy doesn't force a
      // re-download of tools the user already has offline.
      const runtime = await caches.open(RUNTIME_CACHE)
      for (const request of await runtime.keys()) {
        if (!OWNED.has(new URL(request.url).pathname)) await runtime.delete(request)
      }

      await sw.clients.claim()
    })(),
  )
})

/** Cache-first, populating the runtime cache on a miss. This is "tools on use". */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

/**
 * Network-first so a deploy is picked up immediately, falling back to the
 * precached shell. Routing is history-based, so an offline reload of /jq
 * arrives here as a navigation for a path that was never a real file.
 */
async function shellFirst(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch {
    return (await caches.match(SHELL, { cacheName: CORE_CACHE })) ?? Response.error()
  }
}

sw.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(shellFirst(request))
    return
  }

  // No filtering on request.destination or client type: the jq wasm is fetched
  // from inside a dedicated worker, and the image tool's GIF encoder is a
  // dynamic import made from worker scope.
  if (OWNED.has(url.pathname)) event.respondWith(cacheFirst(request))
})

sw.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void sw.skipWaiting()
})

// Keeps this a module so the declarations above stay local rather than becoming
// globals for the whole program. The build strips the marker again — sw.js has
// to load as a classic worker.
export {}
