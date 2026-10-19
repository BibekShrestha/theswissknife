import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function ReorderPages() {
  const [files, setFiles] = useState<File[]>([])
  const [order, setOrder] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleReorder() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await runPdfJob('reorder', { bytes: await readBytes(files[0]), spec: order }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="swap_vert" color="#d946ef" title="Reorder Pages" description="Rearrange PDF pages by specifying a new order" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-reorder">New page order, listing every page once (e.g. 3,1,2,4 or 10-1)</label>
        <input id="pdf-reorder" className="pdf-text-input" type="text" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="3,1,2,4" aria-describedby="pdf-reorder-hint" />
        <p className="pdf-form-hint" id="pdf-reorder-hint">Links, bookmarks, form fields and page labels move with their pages.</p>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || !order || processing} onClick={handleReorder}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Reordering...' : 'Reorder Pages'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="reordered.pdf" outputBytes={result} />
      )}
    </div>
  )
}
