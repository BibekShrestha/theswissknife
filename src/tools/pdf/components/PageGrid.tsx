import type { MouseEvent, ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PageThumb } from './PageThumb'
import { pageRange, useDocState } from './usePdfDocument'

/** The page thumbnails of one document, as a wrapping grid. */
export function PageGrid({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <ul className={className ? `pdf-pages ${className}` : 'pdf-pages'} aria-label={label}>
      {children}
    </ul>
  )
}

interface PageCardProps {
  doc: PDFDocumentProxy
  /** 0-based page index. */
  page: number
  /** Extra clockwise turn to show, in degrees. */
  rotation?: number
  /** The thumbnail button's accessible name — what clicking it does. */
  label?: string
  /** Without it the thumbnail is a picture, not a button. */
  onClick?: (e: MouseEvent) => void
  pressed?: boolean
  /** How a pressed page looks: picked (a check) or marked to go (a bin, struck). */
  tone?: 'pick' | 'remove'
  /** A short tag over the thumbnail's corner (Split's "File 2"). */
  badge?: string
  /** Controls after the page number, under the thumbnail. */
  tools?: ReactNode
  /** Something in the gap after the card (Split's scissors). */
  after?: ReactNode
  className?: string
}

export function PageCard({ doc, page, rotation, label, onClick, pressed, tone = 'pick', badge, tools, after, className }: PageCardProps) {
  const face = (
    <>
      <PageThumb doc={doc} page={page} rotation={rotation} />
      {pressed && (
        <span className="pdf-page-mark material-symbols-outlined" aria-hidden="true">
          {tone === 'remove' ? 'delete' : 'check'}
        </span>
      )}
      {badge && <span className="pdf-page-badge" aria-hidden="true">{badge}</span>}
    </>
  )
  const classes = ['pdf-page', pressed && `is-${tone}`, className].filter(Boolean).join(' ')
  return (
    <li className={classes}>
      {onClick ? (
        <button type="button" className="pdf-page-thumb" aria-label={label} aria-pressed={pressed} onClick={onClick}>
          {face}
        </button>
      ) : (
        <div className="pdf-page-thumb">{face}</div>
      )}
      <div className="pdf-page-foot">
        <span className="pdf-page-num">{page + 1}</span>
        {tools}
      </div>
      {after}
    </li>
  )
}

/**
 * A set of picked pages for one document. Clicking toggles a page;
 * Shift-click sets every page from the last one clicked to this one the
 * same way, like a file manager.
 */
export function usePageSelection(doc: PDFDocumentProxy | null, initial: 'none' | 'all' = 'none') {
  const [state, setState] = useDocState(doc, (n) => ({ pages: new Set<number>(initial === 'all' ? pageRange(n) : []), anchor: -1 }))

  function toggle(page: number, extend = false) {
    setState(({ pages, anchor }) => {
      const next = new Set(pages)
      const on = !pages.has(page)
      const [from, to] = extend && anchor >= 0 ? [Math.min(anchor, page), Math.max(anchor, page)] : [page, page]
      for (let i = from; i <= to; i++) {
        if (on) next.add(i)
        else next.delete(i)
      }
      return { pages: next, anchor: page }
    })
  }

  return {
    selected: state.pages as ReadonlySet<number>,
    toggle,
    set: (pages: Iterable<number>) => setState({ pages: new Set(pages), anchor: -1 }),
  }
}

/** Quick picks over a selection, and how many pages it holds. */
export function SelectionBar({ total, selected, onSet, noun = 'selected' }: { total: number; selected: ReadonlySet<number>; onSet: (pages: number[]) => void; noun?: string }) {
  const all = pageRange(total)
  return (
    <div className="pdf-page-bar">
      <span className="pdf-page-bar-count" role="status">
        {selected.size} of {total} page{total === 1 ? '' : 's'} {noun}
      </span>
      <div className="pdf-page-bar-actions" role="group" aria-label="Select pages">
        <button type="button" onClick={() => onSet(all)}>All</button>
        <button type="button" onClick={() => onSet([])}>None</button>
        <button type="button" onClick={() => onSet(all.filter((i) => i % 2 === 0))}>Odd pages</button>
        <button type="button" onClick={() => onSet(all.filter((i) => i % 2 === 1))}>Even pages</button>
        <button type="button" onClick={() => onSet(all.filter((i) => !selected.has(i)))}>Invert</button>
      </div>
    </div>
  )
}

/** "Reading pages…" while pdf.js opens the file, then its error if it could not. */
export function PagesLoading({ loading }: { loading: boolean }) {
  if (!loading) return null
  return (
    <p className="pdf-pages-loading" role="status">
      <span className="material-symbols-outlined pdf-spinner" aria-hidden="true">progress_activity</span> Reading pages…
    </p>
  )
}
