import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Landing } from './Landing'
import { tools, type ToolMeta } from './registry'
import { ErrorBoundary } from './ErrorBoundary'
import { emit, Link, navigate, usePath } from './router'
import { resolveShortcut } from './shortcuts'

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
      <div
        className="shortcut-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-shell-shortcuts
      >
        <div className="shortcut-head">
          <strong>Keyboard shortcuts</strong>
          <button onClick={onClose} aria-label="Close"><span className="material-symbols-outlined">close</span></button>
        </div>
        <div className="shortcut-body">
          <div className="shortcut-row">
            <kbd>H</kbd>
            <span>All tools</span>
          </div>
          {tools.slice(0, 9).map((t, i) => (
            <div className="shortcut-row" key={t.slug}>
              <kbd>{i + 1}</kbd>
              <span>{t.name}</span>
            </div>
          ))}
          <div className="shortcut-row">
            <kbd>?</kbd>
            <span>Show this panel</span>
          </div>
        </div>
        <p className="shortcut-note">
          Single keys, no ⌘ — the browser keeps ⌘1–⌘9 for its tabs and ⌘⇧H for Home.
          They stay quiet while you are typing in a field.
        </p>
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
    // A tool's own modal (image compare, PDF preview, share link) owns the
    // keyboard while it is open, including keys the shell would claim.
    if (document.querySelector('[aria-modal="true"]:not([data-shell-shortcuts])')) return
    const action = resolveShortcut(e, tools.length)
    if (!action) return
    e.preventDefault()
    if (action.type === 'help') {
      setShowShortcuts((v) => !v)
      return
    }
    setShowShortcuts(false)
    navigate(action.type === 'home' ? '/' : `/${tools[action.index].slug}`)
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
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
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
