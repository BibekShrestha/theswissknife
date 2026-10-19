import { useRef, useState } from 'react'
import { BladeMark } from './BladeMark'
import { useModalFocus } from './focus'
import { categories } from './Landing'
import { tools } from './registry'
import { Link, navigate } from './router'
import { toolMatches, useTaglines } from './taglines'

interface ToolSidebarProps {
  path: string
  open: boolean
  onClose: () => void
}

/** Below this width the sidebar is a drawer (theme.css) and behaves as a modal while open. */
const DRAWER_MEDIA = '(max-width: 960px)'

export function ToolSidebar({ path, open, onClose }: ToolSidebarProps) {
  const [query, setQuery] = useState('')
  const asideRef = useRef<HTMLElement>(null)
  const taglines = useTaglines(query)
  useModalFocus(asideRef, open, { onEscape: onClose, media: DRAWER_MEDIA, initial: 'container' })

  // Each category keeps its own number while filtering, so "06 PDF" stays 06.
  const groups = categories
    .map((category, index) => ({
      category,
      number: index + 1,
      list: tools.filter((tool) => tool.category === category.id && toolMatches(tool, query, taglines, category.name)),
    }))
    .filter(({ list }) => list.length)

  const surprise = () => {
    const candidates = tools.filter((tool) => tool.slug !== path)
    const tool = candidates[Math.floor(Math.random() * candidates.length)]
    if (tool) navigate(`/${tool.slug}`)
    onClose()
  }

  return (
    <>
      {open && <button type="button" className="tool-sidebar-backdrop" onClick={onClose} aria-label="Close tool index" />}
      <aside ref={asideRef} id="tool-sidebar" tabIndex={-1} className={`tool-sidebar${open ? ' open' : ''}`} aria-label="All tools">
        <Link to="/" className="tool-sidebar-brand" onClick={onClose}>
          <span><BladeMark /></span>
          <span><strong>The Swiss Knife</strong><small>theswissknife.com</small></span>
        </Link>

        <label className="tool-sidebar-filter">
          <span className="material-symbols-outlined" aria-hidden>search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter tools…" aria-label="Filter tools in sidebar" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear filter">×</button>}
        </label>

        <nav className="tool-sidebar-list" aria-label="Tools">
          {groups.length ? groups.map(({ category, number, list }) => (
            <section key={category.id}>
              <div className="tool-sidebar-heading">
                <span>{String(number).padStart(2, '0')}</span>
                <strong>{category.name}</strong>
                <span>{list.length}</span>
              </div>
              {list.map((tool) => (
                <Link key={tool.slug} to={`/${tool.slug}`} className={tool.slug === path ? 'active' : undefined} onClick={onClose} aria-current={tool.slug === path ? 'page' : undefined}>
                  <i aria-hidden />
                  <span>{tool.name}</span>
                </Link>
              ))}
            </section>
          )) : <p className="tool-sidebar-empty">No tools match “{query}”.</p>}
        </nav>

        <div className="tool-sidebar-foot">
          <button type="button" onClick={surprise}>
            <span className="material-symbols-outlined" aria-hidden>casino</span>
            Surprise me
          </button>
          <span>{tools.length} tools</span>
        </div>
      </aside>
    </>
  )
}
