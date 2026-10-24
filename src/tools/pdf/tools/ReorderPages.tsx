import { useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { PagesLoading } from '../components/PageGrid'
import { PageThumb } from '../components/PageThumb'
import { Sortable } from '../components/Sortable'
import { pageRange, useDocState, usePdfDocument } from '../components/usePdfDocument'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

const idOf = (page: number) => `p${page}`

function SortablePage({ doc, page, position, total }: { doc: PDFDocumentProxy; page: number; position: number; total: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: idOf(page) })
  const moved = page !== position
  return (
    <li ref={setNodeRef} className={`pdf-page pdf-page-sortable${isDragging ? ' is-dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <div className="pdf-page-thumb" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Page ${page + 1}, at position ${position + 1} of ${total}`}>
        <PageThumb doc={doc} page={page} />
      </div>
      <div className="pdf-page-foot">
        <span className="pdf-page-num">{page + 1}</span>
        {moved && <span className="pdf-page-moved" aria-hidden="true">→ {position + 1}</span>}
      </div>
    </li>
  )
}

export function ReorderPages() {
  const [files, setFiles] = useState<File[]>([])
  const { doc, error: loadError, loading } = usePdfDocument(files[0])
  const [order, setOrder] = useDocState(doc, pageRange)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ bytes: Uint8Array; spec: string; doc: unknown } | null>(null)
  const [error, setError] = useState('')

  const spec = order.map((i) => i + 1).join(',')
  const changed = order.some((page, i) => page !== i)

  async function handleReorder() {
    if (files.length === 0 || !changed) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult({ bytes: await runPdfJob('reorder', { bytes: await readBytes(files[0]), spec }), spec, doc })
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="swap_vert" color="#d946ef" title="Reorder Pages" description="Drag pages into the order you want, then save" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <PagesLoading loading={loading} />
      <ErrorText message={loadError} />

      {doc && (
        <>
          <div className="pdf-page-bar">
            <span className="pdf-page-bar-count">{changed ? 'New order' : 'Original order'}</span>
            <div className="pdf-page-bar-actions" role="group" aria-label="Arrange pages">
              <button type="button" onClick={() => setOrder((o) => [...o].reverse())}>Reverse</button>
              <button type="button" onClick={() => setOrder(pageRange(order.length))} disabled={!changed}>Reset</button>
            </div>
          </div>
          <p className="pdf-form-hint">
            Drag a page to move it (on a touch screen, press and hold first). From the keyboard: focus a page, press Space, move it with the arrow keys and press Space again. Links, bookmarks, form fields and page labels move with their pages.
          </p>
          <Sortable items={order} idOf={idOf} nameOf={(p) => `Page ${p + 1}`} onReorder={setOrder} grid>
            <ul className="pdf-pages" aria-label="Pages, in their new order">
              {order.map((page, i) => (
                <SortablePage key={page} doc={doc} page={page} position={i} total={order.length} />
              ))}
            </ul>
          </Sortable>

          <button className="pdf-action-btn" disabled={!changed || processing} onClick={handleReorder}>
            <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
            {processing ? 'Reordering...' : changed ? 'Save in this order' : 'Move a page to change the order'}
          </button>
        </>
      )}

      <ErrorText message={error} />

      {result && result.spec === spec && result.doc === doc && (
        <ProcessedPdfActions fileName="reordered.pdf" outputBytes={result.bytes} />
      )}
    </div>
  )
}
