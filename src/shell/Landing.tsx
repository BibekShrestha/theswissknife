import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BladeMark } from './BladeMark'
import { openPalette, paletteKeyLabel } from './palette'
import { tools, type ToolMeta } from './registry'
import { Link } from './router'
import { toolMatches, useTaglines } from './taglines'
import { useTheme } from './theme'

export interface Category { id: ToolMeta['category']; name: string; short: string }

/** Every registry category must be represented here so no tool becomes undiscoverable. */
export const categories: Category[] = [
  { id: 'data', name: 'Data', short: 'DATA' },
  { id: 'security', name: 'Security', short: 'SEC' },
  { id: 'text', name: 'Text', short: 'TEXT' },
  { id: 'docs', name: 'Docs', short: 'DOCS' },
  { id: 'time', name: 'Time', short: 'TIME' },
  { id: 'pdf', name: 'PDF', short: 'PDF' },
  { id: 'image', name: 'Images', short: 'IMG' },
]

function ToolIndex({ query }: { query: string }) {
  const taglines = useTaglines(query)
  const groups = categories
    .map((category) => ({
      category,
      number: categories.indexOf(category) + 1,
      list: tools.filter((tool) => tool.category === category.id && toolMatches(tool, query, taglines, category.name)),
    }))
    .filter(({ list }) => list.length)

  return (
    <nav className="landing-index-list" aria-label="Tool index">
      {groups.length ? groups.map(({ category, number, list }) => (
        <section key={category.id} className="landing-index-group">
          <div className="landing-index-heading">
            <span>{String(number).padStart(2, '0')}</span>
            <strong>{category.name}</strong>
            <span>{list.length}</span>
          </div>
          {list.map((tool) => (
            <Link key={tool.slug} to={`/${tool.slug}`}>
              <span>{tool.name}</span>
              <span className="landing-index-mark">{tool.mark}</span>
            </Link>
          ))}
        </section>
      )) : <p className="landing-index-empty">No tools match “{query}”.</p>}
    </nav>
  )
}

/**
 * The blade fan is artwork, drawn only on wide screens: it loads as its own
 * small shell chunk (precached like the palette) to keep it off first paint.
 * Its box is reserved by .landing-knife-wrap, so nothing shifts when it lands,
 * and a chunk that fails to load leaves the box empty rather than the page broken.
 */
const Knife = lazy(() => import('./Knife').catch(() => ({ default: () => null })))

export function Landing() {
  const [theme, toggleTheme] = useTheme()
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const indexRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const focusFilter = (event: KeyboardEvent) => {
      if (event.key !== '/' || ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return
      event.preventDefault()
      filterRef.current?.focus()
    }
    window.addEventListener('keydown', focusFilter)
    return () => window.removeEventListener('keydown', focusFilter)
  }, [])

  return (
    <div className="landing">
      <header className="landing-header">
        <Link to="/" className="landing-brand" title="The Swiss Knife home">
          <span className="landing-brand-mark"><BladeMark /></span>
          <span><strong>The Swiss Knife</strong><small>theswissknife.com</small></span>
        </Link>
        <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer" className="landing-gh-link">
          <span className="material-symbols-outlined" aria-hidden>code</span><span>GitHub</span>
        </a>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined" aria-hidden>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </header>

      {/* One column of content: the hero, then the index. Wide screens pin the
          index to the left as a sidebar; narrow ones stack it under the hero,
          so a phone gets the whole list without opening anything. */}
      <main id="main-content" className="landing-stage">
        <div className="landing-grid-bg" aria-hidden />
        <div className="landing-hero">
          <div className="landing-copy">
            <div className="landing-eyebrow"><span>The Swiss Knife</span><i /><span>{tools.length} utilities</span></div>
            <h1>One <br />toolbox<span>.</span></h1>
            <p className="landing-promise">Free developer tools that run entirely in your browser. Nothing you paste leaves your machine.</p>
            <div className="landing-find">
              <span className="material-symbols-outlined" aria-hidden>search</span>
              <input
                ref={filterRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // Enter opens the first match, the way the palette does.
                onKeyDown={(event) => { if (event.key === 'Enter') indexRef.current?.querySelector('a')?.click() }}
                placeholder="Filter tools…"
                aria-label="Filter tools"
              />
              <button type="button" onClick={openPalette} aria-label="Open the command palette"><kbd>{paletteKeyLabel()}</kbd></button>
            </div>
          </div>
          <div className="landing-knife-wrap"><Suspense><Knife categories={categories} /></Suspense></div>
        </div>
        <div ref={indexRef} className="landing-index">
          <ToolIndex query={query} />
        </div>
        <footer className="landing-foot">
          <span>Open source · works offline for tools you've opened</span>
        </footer>
      </main>
    </div>
  )
}
