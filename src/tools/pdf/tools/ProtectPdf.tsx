import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function ProtectPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  const mismatch = confirm !== '' && confirm !== password

  async function handleProtect() {
    if (files.length === 0 || !password) return
    if (confirm !== password) {
      setError('The two passwords do not match.')
      return
    }
    setProcessing(true)
    setError('')
    setResult(null)

    try {
      setResult(await runPdfJob('protect', { bytes: await readBytes(files[0]), password }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="lock" color="#9333ea" title="Protect PDF" description="Add password protection to your PDF" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-protect-password">Password</label>
        <input
          id="pdf-protect-password"
          className="pdf-text-input"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter a password"
          aria-describedby="pdf-protect-hint"
        />
        <p className="pdf-form-hint" id="pdf-protect-hint">This password will be required to open the PDF. It is encrypted with AES-256.</p>
      </div>

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-protect-confirm">Confirm password</label>
        <input
          id="pdf-protect-confirm"
          className="pdf-text-input"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it again"
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? 'pdf-protect-mismatch' : undefined}
        />
        {mismatch && (
          <p className="pdf-form-hint pdf-form-invalid" id="pdf-protect-mismatch">
            The passwords do not match.
          </p>
        )}
        <label className="pdf-checkbox">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
        </label>
        {/[^\x20-\x7e]/.test(password) && (
          <p className="pdf-form-hint">
            Characters outside plain ASCII are encoded the PDF 2.0 way (UTF-8). pdf.js reads them, but some viewers — macOS Preview among them — cannot open such files; an ASCII password works everywhere.
          </p>
        )}
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !password || confirm !== password || processing} onClick={handleProtect}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Protecting...' : 'Protect PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="protected.pdf" outputBytes={result} encrypted />
      )}
    </div>
  )
}
