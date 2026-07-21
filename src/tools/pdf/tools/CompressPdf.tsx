import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { formatSize } from '../lib/utils'

export function CompressPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [originalSize, setOriginalSize] = useState(0)

  async function handleCompress() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      setOriginalSize(buf.byteLength)
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const pages = pdf.getPages()
      for (const page of pages) {
        const { width, height } = page.getSize()
        page.setMediaBox(0, 0, width, height)
        page.setCropBox(0, 0, width, height)
      }
      const bytes = await pdf.save({ useObjectStreams: true })
      setResult(bytes)
    } catch (e) {
      console.error(e)
    } finally {
      setProcessing(false)
    }
  }

  const savedPct = result
    ? Math.round((1 - result.length / originalSize) * 100)
    : 0

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#dbeafe' }}>
          <span className="material-symbols-outlined" style={{ color: '#2563eb' }}>compress</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Compress PDF</h2>
          <p>Reduce file size while maintaining quality</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleCompress}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Compressing...' : 'Compress PDF'}
      </button>

      {result && (
        <>
          <div className="pdf-file-info">
            <span className="material-symbols-outlined" style={{ color: 'var(--pdf-muted)' }}>storage</span>
            <span>{formatSize(originalSize)} → {formatSize(result.length)}</span>
            {savedPct > 0 && (
              <span style={{ color: '#059669', fontWeight: 600, marginLeft: 'auto' }}>−{savedPct}%</span>
            )}
          </div>
          <ProcessedPdfActions fileName="compressed.pdf" outputBytes={result} />
        </>
      )}
    </div>
  )
}
