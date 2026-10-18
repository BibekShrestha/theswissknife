import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { removePages } from '../ops/organize'

export function RemovePages() {
  const [files, setFiles] = useState<File[]>([])
  const [pagesToRemove, setPagesToRemove] = useState('1,3,5')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleRemove() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await removePages(await readBytes(files[0]), pagesToRemove))
    } catch (e) {
      setError(describeError(e))
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
        <label className="pdf-form-label" htmlFor="pdf-remove-pages">Pages to remove (e.g. 1,3,5 or 2-4,7-)</label>
        <input id="pdf-remove-pages" className="pdf-text-input" type="text" value={pagesToRemove} onChange={(e) => setPagesToRemove(e.target.value)} />
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRemove}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Removing pages...' : 'Remove Pages'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="trimmed.pdf" outputBytes={result} />
      )}
    </div>
  )
}
