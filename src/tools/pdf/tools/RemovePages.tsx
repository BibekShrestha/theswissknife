import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

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
      setResult(await runPdfJob('remove-pages', { bytes: await readBytes(files[0]), spec: pagesToRemove }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="delete" color="#e11d48" title="Remove Pages" description="Delete unwanted pages from your PDF" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-remove-pages">Pages to remove (e.g. 1,3,5 or 2-4,7-)</label>
        <input id="pdf-remove-pages" className="pdf-text-input" type="text" value={pagesToRemove} onChange={(e) => setPagesToRemove(e.target.value)} aria-describedby="pdf-remove-hint" />
        <p className="pdf-form-hint" id="pdf-remove-hint">
          Links and bookmarks that lead to removed pages are removed with them, and so are form fields that appear only on them.
        </p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRemove}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Removing pages...' : 'Remove Pages'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="trimmed.pdf" outputBytes={result} />
      )}
    </div>
  )
}
