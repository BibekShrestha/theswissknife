/**
 * Service worker registration and the update prompt.
 *
 * Imported lazily from main.tsx so none of it lands in the entry chunk —
 * scripts/check-bundle.mjs leaves about a kilobyte of headroom under the 64 KiB
 * budget. That is also why the banner is plain DOM rather than a React
 * component: rendering it from App.tsx would pull this module into the entry.
 */

const BASE = import.meta.env.BASE_URL

/** Set when the user asks for the update, so clients.claim() on a first install can't trigger a reload. */
let updateRequested = false
let reloading = false

function showUpdateBanner(worker: ServiceWorker) {
  if (document.querySelector('.pwa-update')) return

  const banner = document.createElement('div')
  banner.className = 'pwa-update'
  banner.role = 'status'

  const label = document.createElement('span')
  label.textContent = 'A new version is ready.'

  const reload = document.createElement('button')
  reload.type = 'button'
  reload.textContent = 'Reload'
  reload.onclick = () => {
    reload.disabled = true
    updateRequested = true
    worker.postMessage('SKIP_WAITING')
  }

  const later = document.createElement('button')
  later.type = 'button'
  later.className = 'pwa-update-later'
  later.textContent = 'Later'
  later.onclick = () => banner.remove()

  banner.append(label, reload, later)
  document.body.append(banner)
}

async function register() {
  const registration = await navigator.serviceWorker.register(`${BASE}sw.js`, {
    scope: BASE,
    // Don't let the HTTP cache decide when an update is visible; a stale sw.js
    // is a deploy nobody ever sees.
    updateViaCache: 'none',
  })

  // A controller means an older worker is already running this page, so an
  // installed-but-waiting worker is genuinely an update rather than a first install.
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(registration.waiting)
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    if (!installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBanner(installing)
      }
    })
  })
}

navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!updateRequested || reloading) return
  reloading = true
  location.reload()
})

register().catch((error) => {
  // Not fatal — the site works online without a worker, and browsers without
  // service worker support never get here.
  console.warn('Service worker registration failed:', error)
})
