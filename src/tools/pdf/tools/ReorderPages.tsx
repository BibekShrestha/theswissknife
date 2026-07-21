import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

export function ReorderPages() {
  const [files, setFiles] = useState<File[]>([])
  const [order, setOrder] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)

  async function handleReorder() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const total = pdf.getPageCount()
      const indices = order.split(',').map((s) => parseInt(s.trim()) - 1).filter((i) => i >= 0 && i < total)
      const newPdf = await PDFDocument.create()
      const pages = await newPdf.copyPages(pdf, indices)
      pages.forEach((p) => newPdf.addPage(p))
      const bytes = await newPdf.save()
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
        <div className="pdf-subtool-icon" style={{ background: '#fae8ff' }}>
          <span className="material-symbols-outlined" style={{ color: '#d946ef' }}>swap_vert</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Reorder Pages</h2>
          <p>Rearrange PDF pages by specifying a new order</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">New page order (comma-separated, e.g., 3,1,2,4)</label>
        <input className="pdf-text-input" type="text" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="3,1,2,4" />
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !order || processing} onClick={handleReorder}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Reordering...' : 'Reorder Pages'}
      </button>

      {result && (
        <ProcessedPdfActions fileName="reordered.pdf" outputBytes={result} />
      )}
    </div>
  )
}
