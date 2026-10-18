import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { protectPdf } from '../ops/security'

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
      setResult(await protectPdf(await readBytes(files[0]), password))
    } catch (e) {
      setError(describeError(e))
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
        <label className="pdf-form-label" htmlFor="pdf-protect-password">Password</label>
        <input id="pdf-protect-password" className="pdf-text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter a password" />
        <p className="pdf-form-hint">This password will be required to open the PDF. It is encrypted with AES-256.</p>
        {/[^\x20-\x7e]/.test(password) && (
          <p className="pdf-form-hint">
            Characters outside plain ASCII are encoded the PDF 2.0 way (UTF-8). pdf.js reads them, but some viewers — macOS Preview among them — cannot open such files; an ASCII password works everywhere.
          </p>
        )}
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !password || processing} onClick={handleProtect}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Protecting...' : 'Protect PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="protected.pdf" outputBytes={result} encrypted />
      )}
    </div>
  )
}
