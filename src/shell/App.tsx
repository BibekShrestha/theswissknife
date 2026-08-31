import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import { Landing } from './Landing'
import { tools, type ToolMeta } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { emit, Link, usePath } from './router'
import { isPaletteKey, onOpenPalette } from './palette'
import { onOpenSidebar } from './sidebar'
import { ToolSidebar } from './ToolSidebar'

const cache = new Map<string, LazyExoticComponent<ComponentType>>()

/** Lazy like a tool: the palette is only worth downloading once it is asked for. */
const CommandPalette = lazy(() => import('./CommandPalette'))

function toolComponent(tool: ToolMeta) {
  let c = cache.get(tool.slug)
  if (!c) {
    c = lazy(tool.load)
    cache.set(tool.slug, c)
  }
  return c
}

function NotFound({ path }: { path: string }) {
  return (
    <div className="shell-notfound">
      <h1>404</h1>
      <p>
        No tool lives at <code>/{path}</code>.
      </p>
      <Link to="/" className="shell-home-btn">
        <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
      </Link>
    </div>
  )
}

export default function App() {
  const path = usePath()
  const tool = tools.find((t) => t.slug === path)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const onPopState = () => emit()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = tool ? `${tool.name} · The Swiss Knife` : path ? 'Not found · The Swiss Knife' : 'The Swiss Knife'
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
  useEffect(() => onOpenSidebar(() => setSidebarOpen(true)), [])
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
          <ErrorBoundary>
            <Suspense fallback={<div className="tool-loading" role="status">Loading {tool.name}…</div>}>
              <Tool />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    )
  }

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      {content}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette path={path} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
