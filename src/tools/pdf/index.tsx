import { lazy, Suspense, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { pdfTools, categories, type PdfToolId } from './lib/utils'
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

  const activeTool = subtool ? pdfTools.find((t) => t.id === subtool) : null

  return (
    <div className="pdf-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent" style={{ background: 'var(--accent)', color: '#fff', width: 22, height: 22, fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>PDF</span> PDF Buddy</>}
        localLabel="local, no-upload"
      >
        {subtool && (
          <button onClick={() => setSubtool(null)}>
            <span className="material-symbols-outlined">apps</span> All Tools
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
                      <button key={t.id} className={`pdf-sidebar-item${subtool === t.id ? ' on' : ''}`} onClick={() => setSubtool(t.id)}>
                        <span className="material-symbols-outlined">{t.icon}</span>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
            <div className="pdf-content">
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
                    <h3>{cat.name}</h3>
                    <p>{cat.description}</p>
                    <div className="pdf-landing-grid">
                      {catTools.map((t) => (
                        <div key={t.id} className="pdf-tool-card" onClick={() => setSubtool(t.id)}>
                          <div className="pdf-tool-card-icon">
                            <span className="material-symbols-outlined" style={{ color: t.color }}>{t.icon}</span>
                          </div>
                          <h4>{t.name}</h4>
                          <p>{t.description}</p>
                        </div>
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
