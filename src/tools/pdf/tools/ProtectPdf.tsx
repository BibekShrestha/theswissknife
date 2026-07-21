import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

export function ProtectPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [password, setPassword] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleProtect() {
    if (files.length === 0 || !password) return
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const bytes = await pdf.save({ userPassword: password, ownerPassword: password } as any)
      setResult(bytes)
    } catch (e) {
      setError('Failed to protect PDF')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#f3e8ff' }}>
          <span className="material-symbols-outlined" style={{ color: '#9333ea' }}>lock</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Protect PDF</h2>
          <p>Add password protection to your PDF</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Password</label>
        <input className="pdf-text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter a password" />
        <p className="pdf-form-hint">This password will be required to open the PDF.</p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !password || processing} onClick={handleProtect}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Protecting...' : 'Protect PDF'}
      </button>

      {error && <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>}

      {result && (
        <ProcessedPdfActions fileName="protected.pdf" outputBytes={result} />
      )}
    </div>
  )
}
