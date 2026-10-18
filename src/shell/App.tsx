import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Landing } from './Landing'
import { tools, type ToolMeta } from './registry'
import { describeError, ErrorBoundary, isCssLoadError } from './ErrorBoundary'
import { useModalFocus } from './focus'
import { emit, Link, usePath } from './router'
import { isPaletteKey, onOpenPalette, openPalette, suggestForPath } from './palette'
import { openSidebar, setSidebarOpen, useSidebarOpen } from './sidebar'
import { ToolSidebar } from './ToolSidebar'

const cache = new Map<string, LazyExoticComponent<ComponentType>>()

/**
 * Lazy like a tool: the palette is only worth downloading once it is asked for.
 * A rejected lazy() stays rejected, so a failed load swaps in a fresh one and
 * the next open tries the network again.
 */
const paletteChunk = () => lazy(() => import('./CommandPalette'))
let CommandPalette = paletteChunk()

function toolComponent(tool: ToolMeta) {
  let c = cache.get(tool.slug)
  if (!c) {
    c = lazy(tool.load)
    cache.set(tool.slug, c)
  }
  return c
}

/**
 * Where the palette would be when its chunk can't load (offline before it was
 * ever cached, or a tab left open across a deploy). Without it the error would
 * unmount the whole app — and the tool someone was working in — to a blank page.
 */
function PaletteUnavailable({ error, onClose }: { error: Error; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, true, { onEscape: onClose })
  const view = describeError(error, navigator.onLine)
  const message = !navigator.onLine
    ? "Search isn't available offline yet — it downloads the first time you open it online."
    : view.reload
      ? 'The site was updated since this tab opened. Reload to get search back.'
      : 'Search ran into an error. Reload to try again.'
  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div ref={ref} className="palette palette-unavailable" role="alertdialog" aria-modal="true" aria-label="Search unavailable" data-shell-palette>
        <p>{message}</p>
        <div className="palette-unavailable-actions">
          {navigator.onLine && (
            <button type="button" onClick={() => window.location.reload()}>
              <span className="material-symbols-outlined" aria-hidden>refresh</span> Reload
            </button>
          )}
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  )
}

/**
 * Focus the content instead of following the link: a fragment navigation
 * would overwrite the state some tools keep in the URL fragment (#z=, #p=, …)
 * and flip /qr#scan back to the generator.
 */
export function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault()
  const target = document.getElementById('main-content')
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
  target.scrollIntoView?.({ block: 'start' })
}

function NotFound({ path }: { path: string }) {
  const suggestions = suggestForPath(tools, path)
  return (
    <main id="main-content" className="shell-notfound">
      <h1>404</h1>
      <p>
        No tool lives at <code>/{path}</code>.
      </p>
      {suggestions.length > 0 && (
        <p className="shell-notfound-suggest">
          Did you mean{' '}
          {suggestions.map((tool, i) => (
            <span key={tool.slug}>
              {i > 0 && (i === suggestions.length - 1 ? ' or ' : ', ')}
              <Link to={`/${tool.slug}`}>{tool.name}</Link>
            </span>
          ))}
          ?
        </p>
      )}
      <div className="shell-notfound-actions">
        <button type="button" onClick={openPalette}>
          <span className="material-symbols-outlined" aria-hidden>search</span> Search tools
        </button>
        <Link to="/" className="shell-home-btn">
          <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
        </Link>
      </div>
    </main>
  )
}

/**
 * Shown while a tool's chunk downloads. It waits 150 ms so a cached chunk
 * doesn't flash a placeholder, then draws a toolbar in the tool's place so
 * the page has its menu (and a name) while the rest arrives.
 */
function ToolLoading({ tool }: { tool: ToolMeta }) {
  const [visible, setVisible] = useState(false)
  const sidebarOpen = useSidebarOpen()
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150)
    return () => clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div className="tool-loading">
      <header className="shell-toolbar">
        <button type="button" className="shell-menu-toggle" onClick={openSidebar} aria-label="Open tool index" aria-expanded={sidebarOpen} aria-controls="tool-sidebar">
          <span className="material-symbols-outlined" aria-hidden>menu</span>
        </button>
        <div className="shell-tool-identity">
          <div className="shell-brand"><span className="tool-loading-mark" aria-hidden>{tool.mark}</span> {tool.name}</div>
          <span role="status">Loading…</span>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="tool-loading-body"><i aria-hidden /><i aria-hidden /><i aria-hidden /></main>
    </div>
  )
}

export default function App() {
  const path = usePath()
  const tool = tools.find((t) => t.slug === path)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const sidebarOpen = useSidebarOpen()
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  useEffect(() => {
    const onPopState = () => emit()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = tool ? `${tool.name} · The Swiss Knife` : path ? 'Not found · The Swiss Knife' : 'The Swiss Knife'
    // Each tool's page is built with its own canonical URL (scripts/tool-meta.ts);
    // keep it right as the router moves between them without a page load.
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (canonical) canonical.href = new URL(tool ? `/${tool.slug}` : '/', canonical.href).href
  }, [path, tool])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (!isPaletteKey(e)) return
    // A tool's own modal (image compare, PDF preview, share link) owns the
    // keyboard while it is open — no stacking a palette on top of it.
    if (document.querySelector('[aria-modal="true"]:not([data-shell-palette])')) return
    e.preventDefault()
    setPaletteOpen((v) => !v)
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  // The ⌘K buttons in the headers reach the palette through this.
  useEffect(() => onOpenPalette(() => setPaletteOpen(true)), [])
  useEffect(() => setSidebarOpen(false), [path])

  let content: ReactNode
  if (!path) {
    content = <Landing />
  } else if (!tool) {
    content = <NotFound path={path} />
  } else {
    const Tool = toolComponent(tool)
    content = (
      <div className="shell-workspace">
        <ToolSidebar path={path} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="shell-tool-canvas">
          {/* Keyed per tool so one tool's crash screen doesn't follow you to the
              next; a failed chunk is evicted so a later visit fetches it again.
              A failed stylesheet is not: Vite never retries one, so a second try
              would render the tool unstyled — the error screen's Reload is the
              retry that works. */}
          <ErrorBoundary key={tool.slug} onError={(error) => { if (!isCssLoadError(error)) cache.delete(tool.slug) }}>
            <Suspense fallback={<ToolLoading tool={tool} />}>
              <Tool />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    <>
      <a href="#main-content" className="skip-link" onClick={skipToContent}>Skip to content</a>
      {content}
      {paletteOpen && (
        <ErrorBoundary
          fallback={(error) => <PaletteUnavailable error={error} onClose={closePalette} />}
          onError={() => { CommandPalette = paletteChunk() }}
        >
          <Suspense fallback={null}>
            <CommandPalette path={path} onClose={closePalette} />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  )
}
