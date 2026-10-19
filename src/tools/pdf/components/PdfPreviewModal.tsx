import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { getPdfJs } from '../lib/pdfjs'
import { renderScale } from '../ops/read'

interface PdfPreviewModalProps {
  bytes: Uint8Array
  fileName: string
  onClose: () => void
}

export function PdfPreviewModal({ bytes, fileName, onClose }: PdfPreviewModalProps) {
  const [pageNum, setPageNum] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  // a modal dialog: focus moves in, stays in, and goes back to the opener on close
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    return () => opener?.focus()
  }, [])

  // reaching the first or last page disables the button that had focus; keep focus inside
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) closeButton.current?.focus()
  }, [pageNum, totalPages])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Parse once per output, not once per page turn, and free pdf.js's copy on close.
  useEffect(() => {
    let task: PDFDocumentLoadingTask | null = null
    let cancelled = false
    getPdfJs().then((pdfjs) => {
      if (cancelled) return
      task = pdfjs.getDocument({ data: bytes.slice() })
      task.promise.then(
        (d) => {
          if (cancelled) return
          setDoc(d)
          setTotalPages(d.numPages)
        },
        () => !cancelled && setError('Failed to render preview'),
      )
    })
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [bytes])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let renderTask: RenderTask | null = null

    async function render(d: PDFDocumentProxy) {
      try {
        const page = await d.getPage(pageNum)
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const viewport = page.getViewport({ scale: renderScale(page.view[2] - page.view[0], page.view[3] - page.view[1], 1.5) })
        canvas.height = viewport.height
        canvas.width = viewport.width
        renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
        await renderTask.promise
      } catch (e) {
        // a page turn cancels the render in flight; only real failures are errors
        if (!cancelled && (e as { name?: string }).name !== 'RenderingCancelledException') setError('Failed to render preview')
      }
    }

    render(doc)
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, pageNum])

  return (
    <>
      <div className="pdf-preview-backdrop" onClick={onClose} />
      <div className="pdf-preview-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-preview-title" ref={dialog} onKeyDown={onKeyDown}>
        <div className="pdf-preview-head">
          <h3 id="pdf-preview-title">Preview: {fileName}</h3>
          <div className="pdf-preview-controls">
            <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1} aria-label="Previous page">
              <span className="material-symbols-outlined" aria-hidden="true">chevron_left</span>
            </button>
            <span className="pdf-preview-page" aria-live="polite">
              {pageNum} / {totalPages || '?'}
            </span>
            <button onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))} disabled={pageNum >= totalPages} aria-label="Next page">
              <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
            <button ref={closeButton} onClick={onClose} aria-label="Close preview">
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
        <div className="pdf-preview-body">
          {error ? (
            <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>
          ) : (
            <canvas ref={canvasRef} role="img" aria-label={`Page ${pageNum} of ${totalPages || '?'}`} />
          )}
        </div>
      </div>
    </>
  )
}
