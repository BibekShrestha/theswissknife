import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

export function UnlockPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [password, setPassword] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleUnlock() {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { password } as any)
      const bytes = await pdf.save()
      setResult(bytes)
    } catch (e) {
      setError('Incorrect password or PDF is not encrypted')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#fce7f3' }}>
          <span className="material-symbols-outlined" style={{ color: '#db2777' }}>lock_open</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Unlock PDF</h2>
          <p>Remove password from a protected PDF</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Current password</label>
        <input className="pdf-text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter the PDF password" />
        <p className="pdf-form-hint">The output PDF will not be password protected.</p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !password || processing} onClick={handleUnlock}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Unlocking...' : 'Unlock PDF'}
      </button>

      {error && <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>}

      {result && (
        <ProcessedPdfActions fileName="unlocked.pdf" outputBytes={result} />
      )}
    </div>
  )
}
