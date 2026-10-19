import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { pdfTools, categories, type PdfToolId } from './lib/utils'
import { closePdfRunner } from './runner'
import './pdf.css'

const subtoolComponents: Record<PdfToolId, React.LazyExoticComponent<React.ComponentType>> = {
  merge: lazy(() => import('./tools/MergePdf').then(m => ({ default: m.MergePdf }))),
  split: lazy(() => import('./tools/SplitPdf').then(m => ({ default: m.SplitPdf }))),
  rotate: lazy(() => import('./tools/RotatePdf').then(m => ({ default: m.RotatePdf }))),
  'remove-pages': lazy(() => import('./tools/RemovePages').then(m => ({ default: m.RemovePages }))),
  reorder: lazy(() => import('./tools/ReorderPages').then(m => ({ default: m.ReorderPages }))),
  'pdf-to-image': lazy(() => import('./tools/PdfToImage').then(m => ({ default: m.PdfToImage }))),
  'image-to-pdf': lazy(() => import('./tools/ImageToPdf').then(m => ({ default: m.ImageToPdf }))),
  'pdf-to-text': lazy(() => import('./tools/PdfToText').then(m => ({ default: m.PdfToText }))),
  compress: lazy(() => import('./tools/CompressPdf').then(m => ({ default: m.CompressPdf }))),
  'page-numbers': lazy(() => import('./tools/PageNumbers').then(m => ({ default: m.PageNumbers }))),
  watermark: lazy(() => import('./tools/Watermark').then(m => ({ default: m.Watermark }))),
  protect: lazy(() => import('./tools/ProtectPdf').then(m => ({ default: m.ProtectPdf }))),
  unlock: lazy(() => import('./tools/UnlockPdf').then(m => ({ default: m.UnlockPdf }))),
  'remove-metadata': lazy(() => import('./tools/RemoveMetadata').then(m => ({ default: m.RemoveMetadata }))),
}

function SubtoolView({ id }: { id: PdfToolId }) {
  const C = subtoolComponents[id]
  return (
    <Suspense fallback={<div className="tool-loading" role="status">Loading…</div>}>
      <C />
    </Suspense>
  )
}

export default function PdfTool() {
  const [subtool, setSubtool] = useState<PdfToolId | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const lastTool = useRef<PdfToolId | null>(null)

  // the worker (pdf-lib and whatever it holds) goes when PDF Buddy is left
  useEffect(() => closePdfRunner, [])

  // the clicked card or button disappears: move focus to what replaced it
  useEffect(() => {
    if (subtool) content.current?.focus({ preventScroll: true })
    else if (lastTool.current) document.getElementById(`pdf-card-${lastTool.current}`)?.closest('button')?.focus()
    lastTool.current = subtool
  }, [subtool])

  const activeTool = subtool ? pdfTools.find((t) => t.id === subtool) : null

  return (
    <div className="pdf-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent" style={{ background: 'var(--accent)', color: 'var(--on-accent)', width: 22, height: 22, fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)' }}>PDF</span> PDF Buddy</>}
        localLabel="local, no-upload"
      >
        {subtool && (
          <button onClick={() => setSubtool(null)}>
            <span className="material-symbols-outlined" aria-hidden="true">apps</span> All Tools
          </button>
        )}
      </ToolHeader>

      <main id="main-content" className="pdf-main">
        {subtool && activeTool ? (
          <div className="pdf-body">
            <nav className="pdf-sidebar" aria-label="PDF tool navigation">
              {categories.map((cat) => {
                const catTools = pdfTools.filter((t) => t.category === cat.id)
                if (catTools.length === 0) return null
                return (
                  <div className="pdf-sidebar-group" key={cat.id}>
                    <div className="pdf-sidebar-group-label">{cat.name}</div>
                    {catTools.map((t) => (
                      <button
                        key={t.id}
                        className={`pdf-sidebar-item${subtool === t.id ? ' on' : ''}`}
                        aria-current={subtool === t.id ? 'page' : undefined}
                        onClick={() => setSubtool(t.id)}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">{t.icon}</span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
            <div className="pdf-content" ref={content} tabIndex={-1} aria-label={activeTool.name}>
              <SubtoolView id={subtool} />
            </div>
          </div>
        ) : (
          <div className="pdf-content">
            <div className="pdf-landing-categories">
              {categories.map((cat) => {
                const catTools = pdfTools.filter((t) => t.category === cat.id)
                return (
                  <div className="pdf-landing-category" key={cat.id}>
                    <h2>{cat.name}</h2>
                    <p>{cat.description}</p>
                    <div className="pdf-landing-grid">
                      {catTools.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="pdf-tool-card"
                          aria-labelledby={`pdf-card-${t.id}`}
                          aria-describedby={`pdf-card-${t.id}-desc`}
                          onClick={() => setSubtool(t.id)}
                        >
                          <span className="pdf-tool-card-icon" style={{ '--pdf-tile': t.color } as CSSProperties}>
                            <span className="material-symbols-outlined" aria-hidden="true">{t.icon}</span>
                          </span>
                          <span className="pdf-tool-card-title" id={`pdf-card-${t.id}`}>{t.name}</span>
                          <span className="pdf-tool-card-desc" id={`pdf-card-${t.id}-desc`}>{t.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
