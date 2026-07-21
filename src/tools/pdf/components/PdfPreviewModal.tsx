import { useEffect, useRef, useState } from 'react'
import { getPdfJs } from '../lib/pdfjs'

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

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const pdfjs = await getPdfJs()
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
        if (cancelled) return
        setTotalPages(doc.numPages)

        const page = await doc.getPage(pageNum)
        if (cancelled) return

        const viewport = page.getViewport({ scale: 1.5 })

        const canvas = canvasRef.current
        if (!canvas) return

        canvas.height = viewport.height
        canvas.width = viewport.width
        const ctx = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport } as any).promise

        page.cleanup()
      } catch (e) {
        if (!cancelled) setError('Failed to render preview')
      }
    }

    render()
    return () => { cancelled = true }
  }, [bytes, pageNum])

  return (
    <>
      <div className="pdf-preview-backdrop" onClick={onClose} />
      <div className="pdf-preview-modal" role="dialog" aria-modal="true" aria-label="PDF Preview">
        <div className="pdf-preview-head">
          <h3>{fileName}</h3>
          <div className="pdf-preview-controls">
            <button onClick={() => setPageNum((p) => Math.max(1, p - 1))} disabled={pageNum <= 1}>
              <span className="material-symbols-outlined">chevron_left</span>
            </button>
            <span className="pdf-preview-page">
              {pageNum} / {totalPages || '?'}
            </span>
            <button onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))} disabled={pageNum >= totalPages}>
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
            <button onClick={onClose} aria-label="Close preview">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div className="pdf-preview-body">
          {error ? (
            <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>
          ) : (
            <canvas ref={canvasRef} />
          )}
        </div>
      </div>
    </>
  )
}
