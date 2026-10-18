import { useState } from 'react'
import { saveAs } from 'file-saver'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ErrorText } from '../components/ErrorText'
import { describeError, PdfInputError } from '../lib/errors'
import { getPdfJs } from '../lib/pdfjs'
import { openPdf, renderScale } from '../ops/read'
import JSZip from 'jszip'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function PdfToImage() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  // Blobs, not data: URLs — the site CSP forbids fetch() of data: URLs, and base64 strings cost a third more memory
  const [images, setImages] = useState<Blob[]>([])
  const [error, setError] = useState('')

  async function handleConvert() {
    if (files.length === 0) return
    setProcessing(true)
    setProgress(0)
    setError('')
    setImages([])

    try {
      const { doc, close } = await openPdf(await getPdfJs(), new Uint8Array(await files[0].arrayBuffer()))
      try {
        const blobs: Blob[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: renderScale(base.width, base.height) })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
          if (!blob) throw new PdfInputError(`Page ${i} is too large to render in this browser.`)
          blobs.push(blob)
          page.cleanup()
          setProgress((i / doc.numPages) * 100)
        }
        setImages(blobs)
      } finally {
        await close()
      }
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  async function downloadAll() {
    if (images.length === 0) return
    if (images.length === 1) {
      saveAs(images[0], 'page-1.png')
      return
    }
    const zip = new JSZip()
    images.forEach((image, i) => zip.file(`page-${i + 1}.png`, image))
    saveAs(await zip.generateAsync({ type: 'blob' }), 'pdf-images.zip')
  }

  return (
    <div>
      <SubtoolHeader icon="image" color="#16a34a" title="PDF to Image" description="Convert each PDF page to a PNG image" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleConvert}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Converting...' : 'Convert to Images'}
      </button>

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
