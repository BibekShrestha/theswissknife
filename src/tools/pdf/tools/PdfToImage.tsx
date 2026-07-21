import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { getPdfJs } from '../lib/pdfjs'
import JSZip from 'jszip'

export function PdfToImage() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState('')

  async function handleConvert() {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setImages([])

    try {
      const pdfjs = await getPdfJs()
      const buf = await files[0].arrayBuffer()
      const doc = await pdfjs.getDocument({ data: buf.slice() }).promise
      const urls: string[] = []

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport } as any).promise
        urls.push(canvas.toDataURL('image/png'))
        page.cleanup()
      }
      setImages(urls)
    } catch (e) {
      setError('Failed to convert PDF to images')
    } finally {
      setProcessing(false)
    }
  }

  async function downloadAll() {
    if (images.length === 0) return
    if (images.length === 1) {
      const blob = await (await fetch(images[0])).blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'page-1.png'
      a.click()
      URL.revokeObjectURL(url)
      return
    }

    const zip = new JSZip()
    for (let i = 0; i < images.length; i++) {
      const data = images[i].split(',')[1]
      zip.file(`page-${i + 1}.png`, data, { base64: true })
    }
    const zipBytes = await zip.generateAsync({ type: 'uint8array' })
    const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pdf-images.zip'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#dcfce7' }}>
          <span className="material-symbols-outlined" style={{ color: '#16a34a' }}>image</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>PDF to Image</h2>
          <p>Convert each PDF page to a PNG image</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleConvert}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Converting...' : 'Convert to Images'}
      </button>

      {processing && (
        <div className="pdf-progress">
          <div className="pdf-progress-bar">
            <div className="pdf-progress-fill" style={{ width: '100%' }} />
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>}

      {images.length > 0 && (
        <div className="pdf-processed">
          <div className="pdf-processed-header">
            <span className="material-symbols-outlined" style={{ color: '#059669' }}>check_circle</span>
            <div className="pdf-processed-info">
              <h4>{images.length} page{images.length !== 1 ? 's' : ''} converted</h4>
              <p>Each page rendered as a separate PNG image</p>
            </div>
          </div>
          <div className="pdf-processed-actions">
            <button className="pdf-processed-download" onClick={downloadAll}>
              <span className="material-symbols-outlined">download</span> Download All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
