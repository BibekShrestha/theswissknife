import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BladeMark } from './BladeMark'
import { openPalette, paletteKeyLabel } from './palette'
import { tools, type ToolMeta } from './registry'
import { Link } from './router'
import { useTheme } from './theme'

/** Every registry category must be represented here so no tool becomes undiscoverable. */
export const categories: { id: ToolMeta['category']; name: string; short: string }[] = [
  { id: 'data', name: 'Data', short: 'DATA' },
  { id: 'security', name: 'Security', short: 'SEC' },
  { id: 'text', name: 'Text', short: 'TEXT' },
  { id: 'time', name: 'Time', short: 'TIME' },
  { id: 'pdf', name: 'PDF', short: 'PDF' },
  { id: 'image', name: 'Images', short: 'IMG' },
]

const lengths = [368, 334, 386, 322, 376, 344]
const SPREAD = 55

function matches(tool: ToolMeta, query: string) {
  const value = query.trim().toLowerCase()
  return !value || `${tool.name} ${tool.tagline} ${tool.category}`.toLowerCase().includes(value)
}

function ToolIndex({ query }: { query: string }) {
  const groups = categories
    .map((category) => ({
      category,
      list: tools.filter((tool) => tool.category === category.id && matches(tool, query)),
    }))
    .filter(({ list }) => list.length)

  return (
    <nav className="landing-index-list" aria-label="Tool index">
      {groups.length ? groups.map(({ category, list }, index) => (
        <section key={category.id} className="landing-index-group">
          <div className="landing-index-heading">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{category.name}</strong>
            <span>{list.length}</span>
          </div>
          {list.map((tool) => (
            <Link key={tool.slug} to={`/${tool.slug}`}>
              <i aria-hidden />
              <span>{tool.name}</span>
              <span className="landing-index-mark">{tool.mark}</span>
            </Link>
          ))}
        </section>
      )) : <p className="landing-index-empty">No tools match “{query}”.</p>}
    </nav>
  )
}

function Knife() {
  const [open, setOpen] = useState(false)
  const [settled, setSettled] = useState(false)
  const [ripple, setRipple] = useState(0)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    const timer = window.setTimeout(() => setSettled(true), 1100)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [])

  const blades = useMemo(() => categories.map((category, index) => ({
    ...category,
    tool: tools.find((tool) => tool.category === category.id)!,
    length: lengths[index],
  })), [])
  const step = (SPREAD * 2) / (blades.length - 1)

  return (
    <div className="landing-knife-wrap">
      <div className="landing-knife">
        <svg viewBox="0 0 560 500" className="knife-guide" fill="none" aria-hidden>
          <path d="M 15 285 A 320 320 0 0 1 545 285" />
        </svg>

        {blades.map((blade, index) => {
          const angle = -90 - SPREAD + index * step
          const style = {
            '--blade-angle': `${angle}deg`,
            '--blade-width': `${blade.length}px`,
            '--blade-delay': settled ? '0ms' : `${index * 75}ms`,
            '--blade-z': index + 1,
          } as CSSProperties
          return (
            <Link
              key={blade.id}
              to={`/${blade.tool.slug}`}
              className={`knife-blade${open ? ' open' : ''}`}
              style={style}
              tabIndex={open ? 0 : -1}
              aria-label={`Open ${blade.name} tools`}
            >
              <span className="knife-blade-face">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{blade.short}</strong>
              </span>
            </Link>
          )
        })}

        {ripple > 0 && <span key={ripple} className="knife-ripple" />}

        <div className="knife-body">
          <BladeMark className="knife-body-mark" />
          <span /><span /><span />
        </div>
        <button
          type="button"
          className="knife-pivot"
          onClick={() => { setOpen((value) => !value); setRipple((value) => value + 1) }}
          aria-expanded={open}
          aria-label={open ? 'Close the tool blades' : 'Open the tool blades'}
        />
      </div>
      <p>{open ? 'pick a blade' : 'click the pivot to open'}</p>
    </div>
  )
}

export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusFilter = (event: KeyboardEvent) => {
      if (event.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return
      event.preventDefault()
      setMenuOpen(true)
      filterRef.current?.focus()
    }
    window.addEventListener('keydown', focusFilter)
    return () => window.removeEventListener('keydown', focusFilter)
  }, [])

  return (
    <div className="landing">
      <header className="landing-header">
        <button className="landing-menu-btn" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle tool index" aria-expanded={menuOpen}>
          <span className="material-symbols-outlined" aria-hidden>{menuOpen ? 'close' : 'menu'}</span>
        </button>
        <Link to="/" className="landing-brand" title="The Swiss Knife home">
          <span className="landing-brand-mark"><BladeMark /></span>
          <span><strong>The Swiss Knife</strong><small>theswissknife.com</small></span>
        </Link>

        <button className="landing-search" type="button" onClick={openPalette} aria-label="Search tools">
          <span className="material-symbols-outlined" aria-hidden>search</span>
          <span>Search tools…</span>
          <kbd>{paletteKeyLabel()}</kbd>
        </button>

        <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer" className="landing-gh-link">
          <span className="material-symbols-outlined" aria-hidden>code</span><span>GitHub</span>
        </a>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined" aria-hidden>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </header>

      <div className="landing-body">
        {menuOpen && <button className="landing-index-backdrop" onClick={() => setMenuOpen(false)} aria-label="Close tool index" />}
        <aside className={`landing-index${menuOpen ? ' open' : ''}`}>
          <label className="landing-filter">
            <span className="material-symbols-outlined" aria-hidden>search</span>
            <input ref={filterRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter tools…" aria-label="Filter tools" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear filter">×</button>}
          </label>
          <ToolIndex query={query} />
          <div className="landing-index-foot"><span>LOCAL ONLY</span><span>{tools.length} TOOLS</span></div>
        </aside>

        <main id="main-content" className="landing-stage">
          <div className="landing-grid-bg" aria-hidden />
          <div className="landing-hero">
            <div className="landing-copy">
              <div className="landing-eyebrow"><span>The Swiss Knife</span><i /><span>{tools.length} utilities</span></div>
              <h1>One<br />toolbox<span>.</span></h1>
              <h2>Every utility<br />you need.</h2>
              <button type="button" className="landing-command" onClick={openPalette}>
                <kbd>{paletteKeyLabel()}</kbd><span>opens any tool</span>
              </button>
            </div>
            <Knife />
          </div>
          <footer className="landing-foot">
            <span>Everything runs in your browser. Nothing is uploaded.</span>
            <span>Open source · PWA · offline-ready</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
