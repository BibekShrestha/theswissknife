/**
 * Service worker registration and the update prompt.
 *
 * Imported lazily from main.tsx so none of it lands in the entry chunk, which
 * scripts/check-bundle.mjs holds to a budget. That is also why the banner is
 * plain DOM rather than a React component: rendering it from App.tsx would pull
 * this module into the entry, where only react and the shell belong.
 */

const BASE = import.meta.env.BASE_URL

/** Indirection so the tests can watch reloads (jsdom cannot navigate). */
export const page = { reload: () => location.reload() }

/** Set when the user asks for the update, so clients.claim() on a first install can't trigger a reload. */
let updateRequested = false
let reloading = false
/** Whether a worker already ran this page — a controllerchange without one is a first install's claim. */
let controlled = Boolean(navigator.serviceWorker.controller)

function reloadNow() {
  if (reloading) return
  reloading = true
  page.reload()
}

/** The banner, created on first use; reused (and re-shown after "Later") when its message changes. */
function banner(): { label: HTMLSpanElement; reload: HTMLButtonElement } {
  let root = document.querySelector<HTMLDivElement>('.pwa-update')
  if (!root) {
    root = document.createElement('div')
    root.className = 'pwa-update'
    root.role = 'status'

    const label = document.createElement('span')
    const reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Reload'

    const later = document.createElement('button')
    later.type = 'button'
    later.className = 'pwa-update-later'
    later.textContent = 'Later'
    later.onclick = () => root?.remove()

    root.append(label, reload, later)
  }
  if (!root.isConnected) document.body.append(root)
  return { label: root.querySelector('span')!, reload: root.querySelector('button')! }
}

function showUpdateBanner(worker: ServiceWorker) {
  if (document.querySelector('.pwa-update')) return
  const { label, reload } = banner()
  label.textContent = 'A new version is ready.'
  reload.onclick = () => {
    reload.disabled = true
    updateRequested = true
    worker.postMessage('SKIP_WAITING')
  }
}

/**
 * Another tab took the update: this page is now controlled by the new worker,
 * which has pruned the runtime entries the old build relied on. Asking that
 * worker to skip waiting would do nothing, so Reload just reloads.
 */
function showActivatedBanner() {
  const { label, reload } = banner()
  label.textContent = 'A new version is active.'
  reload.disabled = false
  reload.onclick = reloadNow
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
  const wasControlled = controlled
  controlled = true
  if (updateRequested) reloadNow()
  else if (wasControlled) showActivatedBanner()
})

register().catch((error) => {
  // Not fatal — the site works online without a worker, and browsers without
  // service worker support never get here.
  console.warn('Service worker registration failed:', error)
})
