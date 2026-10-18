import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { unlockPdf } from '../ops/security'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function UnlockPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [password, setPassword] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function handleUnlock() {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setResult(null)
    setNote('')

    try {
      const unlocked = await unlockPdf(await readBytes(files[0]), password)
      setResult(unlocked.bytes)
      setNote(unlocked.note ?? '')
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="lock_open" color="#db2777" title="Unlock PDF" description="Remove password from a protected PDF" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-unlock-password">Current password</label>
        <input id="pdf-unlock-password" className="pdf-text-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter the PDF password" />
        <p className="pdf-form-hint">The output PDF will not be password protected. Leave the password empty for a PDF that opens without one but restricts printing or editing.</p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleUnlock}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Unlocking...' : 'Unlock PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <>
          {note && <p className="pdf-notes">{note}</p>}
          <ProcessedPdfActions fileName="unlocked.pdf" outputBytes={result} />
        </>
      )}
    </div>
  )
}
