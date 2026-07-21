import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Landing } from './Landing'
import { tools, type ToolMeta } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { emit, Link, navigate, usePath } from './router'

const cache = new Map<string, LazyExoticComponent<ComponentType>>()

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

function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="shortcut-backdrop" onClick={onClose} />
      <div className="shortcut-overlay" role="dialog" aria-label="Keyboard shortcuts">
        <div className="shortcut-head">
          <strong>Keyboard shortcuts</strong>
          <button onClick={onClose} aria-label="Close"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="shortcut-body">
          {[
            ['⌘1 – ⌘5', 'Jump to tool 1–5'],
            ['⌘⇧H', 'Back to home'],
            ['?', 'Show this panel'],
          ].map(([keys, desc]) => (
            <div className="shortcut-row" key={keys}>
              <kbd>{keys}</kbd>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function App() {
  const path = usePath()
  const tool = tools.find((t) => t.slug === path)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    const onPopState = () => emit()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    document.title = tool ? `${tool.name} · The Swiss Knife` : path ? 'Not found · The Swiss Knife' : 'The Swiss Knife'
  }, [path, tool])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === '?' && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      setShowShortcuts((v) => !v)
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'H') {
      e.preventDefault()
      navigate('')
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
      const idx = parseInt(e.key) - 1
      if (tools[idx]) navigate(`/${tools[idx].slug}`)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (!path) return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Landing />
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
    </>
  )
  if (!tool) return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <NotFound path={path} />
    </>
  )

  const Tool = toolComponent(tool)
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <ErrorBoundary>
        <Suspense fallback={<div className="tool-loading" role="status">Loading {tool.name}…</div>}>
          <Tool />
        </Suspense>
      </ErrorBoundary>
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
    </>
  )
}
