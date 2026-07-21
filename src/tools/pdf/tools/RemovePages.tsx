import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

export function RemovePages() {
  const [files, setFiles] = useState<File[]>([])
  const [pagesToRemove, setPagesToRemove] = useState('1,3,5')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)

  async function handleRemove() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const total = pdf.getPageCount()
      const removeIndices = new Set(
        pagesToRemove.split(',').map((s) => parseInt(s.trim()) - 1).filter((i) => i >= 0 && i < total)
      )
      const keepIndices = Array.from({ length: total }, (_, i) => i).filter((i) => !removeIndices.has(i))
      const newPdf = await PDFDocument.create()
      const pages = await newPdf.copyPages(pdf, keepIndices)
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
        <div className="pdf-subtool-icon" style={{ background: '#ffe4e6' }}>
          <span className="material-symbols-outlined" style={{ color: '#e11d48' }}>delete</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Remove Pages</h2>
          <p>Delete unwanted pages from your PDF</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Pages to remove (comma-separated, e.g., 1,3,5)</label>
        <input className="pdf-text-input" type="text" value={pagesToRemove} onChange={(e) => setPagesToRemove(e.target.value)} />
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRemove}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Removing pages...' : 'Remove Pages'}
      </button>

      {result && (
        <ProcessedPdfActions fileName="trimmed.pdf" outputBytes={result} />
      )}
    </div>
  )
}
