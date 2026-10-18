import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { unlockPdf } from '../ops/security'

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
      setResult(await unlockPdf(await readBytes(files[0]), password))
    } catch (e) {
      setError(describeError(e))
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
        <label className="pdf-form-label" htmlFor="pdf-unlock-password">Current password</label>
        <input id="pdf-unlock-password" className="pdf-text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter the PDF password" />
        <p className="pdf-form-hint">The output PDF will not be password protected. Leave the password empty for a PDF that opens without one but restricts printing or editing.</p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleUnlock}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Unlocking...' : 'Unlock PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="unlocked.pdf" outputBytes={result} />
      )}
    </div>
  )
}
