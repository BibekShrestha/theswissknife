import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

const IMAGE_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
}

export function ImageToPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)

  async function handleConvert() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const pdf = await PDFDocument.create()
      for (const file of files) {
        const buf = await file.arrayBuffer()
        let image
        if (file.type === 'image/png') {
          image = await pdf.embedPng(buf)
        } else {
          image = await pdf.embedJpg(buf)
        }
        const page = pdf.addPage([image.width, image.height])
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
      }
      const bytes = await pdf.save()
      setResult(bytes)
    } catch (e) {
      console.error(e)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#d1fae5' }}>
          <span className="material-symbols-outlined" style={{ color: '#059669' }}>photo_library</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Image to PDF</h2>
          <p>Convert images to a PDF document</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} accept={IMAGE_ACCEPT} label="Drop images here" description="PNG, JPG, or WebP" />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleConvert}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Converting...' : `Convert ${files.length} image${files.length !== 1 ? 's' : ''} to PDF`}
      </button>

      {result && (
        <ProcessedPdfActions fileName="images.pdf" outputBytes={result} />
      )}
    </div>
  )
}
