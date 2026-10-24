import { useState } from 'react'
import { saveAs } from 'file-saver'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ErrorText } from '../components/ErrorText'
import { describeError, PdfInputError } from '../lib/errors'
import { renderScale } from '../ops/read'
import JSZip from 'jszip'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { PageCard, PageGrid, PagesLoading, SelectionBar, usePageSelection } from '../components/PageGrid'
import { usePdfDocument } from '../components/usePdfDocument'

export function PdfToImage() {
  const [files, setFiles] = useState<File[]>([])
  const { doc, error: loadError, loading } = usePdfDocument(files[0])
  const { selected, toggle, set } = usePageSelection(doc, 'all')
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  // Blobs, not data: URLs — the site CSP forbids fetch() of data: URLs, and base64 strings cost a third more memory
  const [images, setImages] = useState<{ page: number; blob: Blob }[]>([])
  const [error, setError] = useState('')
  const picked = [...selected].sort((a, b) => a - b)

  async function handleConvert() {
    if (!doc || picked.length === 0) return
    setProcessing(true)
    setProgress(0)
    setError('')
    setImages([])

    try {
      const out: { page: number; blob: Blob }[] = []
      for (const [n, i] of picked.entries()) {
        const page = await doc.getPage(i + 1)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: renderScale(base.width, base.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        let blob: Blob | null
        try {
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        } finally {
          // release the bitmap now rather than whenever the canvas is collected (Safari caps total canvas memory)
          canvas.width = 0
          canvas.height = 0
        }
        if (!blob) throw new PdfInputError(`Page ${i + 1} is too large to render in this browser.`)
        out.push({ page: i, blob })
        page.cleanup()
        setProgress(((n + 1) / picked.length) * 100)
      }
      setImages(out)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  function changeFiles(next: File[]) {
    setFiles(next)
    setImages([])
  }

  async function downloadAll() {
    if (images.length === 0) return
    if (images.length === 1) {
      saveAs(images[0].blob, `page-${images[0].page + 1}.png`)
      return
    }
    const zip = new JSZip()
    for (const { page, blob } of images) zip.file(`page-${page + 1}.png`, blob)
    saveAs(await zip.generateAsync({ type: 'blob' }), 'pdf-images.zip')
  }

  return (
    <div>
      <SubtoolHeader icon="image" color="#16a34a" title="PDF to Image" description="Save the pages you pick as PNG images" />

      <FileDropzone files={files} onFilesChange={changeFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={changeFiles} />
      <PagesLoading loading={loading} />
      <ErrorText message={loadError} />

      {doc && (
        <>
          <SelectionBar total={doc.numPages} selected={selected} onSet={set} />
          <p className="pdf-form-hint">Every page is picked to start with; click a page to leave it out. Shift-click changes every page up to it.</p>
          <PageGrid label="Pages">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PageCard key={i} doc={doc} page={i} pressed={selected.has(i)} label={`Page ${i + 1}`} onClick={(e) => toggle(i, e.shiftKey)} />
            ))}
          </PageGrid>

          <button className="pdf-action-btn" disabled={picked.length === 0 || processing} onClick={handleConvert}>
            <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
            {processing ? 'Converting...' : picked.length === 0 ? 'Pick at least one page' : `Convert ${picked.length} page${picked.length === 1 ? '' : 's'} to PNG`}
          </button>
        </>
      )}

      {processing && (
        <div className="pdf-progress">
          <div className="pdf-progress-bar">
            <div className="pdf-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <ErrorText message={error} />

      {images.length > 0 && (
        <div className="pdf-processed">
          <div className="pdf-processed-header">
            <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--ok)' }}>check_circle</span>
            <div className="pdf-processed-info">
              <h4>{images.length} page{images.length !== 1 ? 's' : ''} converted</h4>
              <p>Each page rendered as a separate PNG image</p>
            </div>
          </div>
          <div className="pdf-processed-actions">
            <button className="pdf-processed-download" onClick={downloadAll}>
              <span className="material-symbols-outlined" aria-hidden="true">download</span> Download All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
