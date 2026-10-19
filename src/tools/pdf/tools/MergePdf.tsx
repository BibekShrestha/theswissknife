import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function MergePdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState('')

  async function handleMerge() {
    if (files.length < 2) return
    setProcessing(true)
    setProgress(0)
    setResult(null)
    setNotes([])
    setError('')

    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await readBytes(f) })))
      const merged = await runPdfJob('merge', { inputs }, { onProgress: (done) => setProgress((done / files.length) * 100) })
      setResult(merged.bytes)
      setNotes(merged.notes)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="merge" color="#dc2626" title="Merge PDF" description="Combine multiple PDFs into one document, in the order listed" />

      <FileDropzone files={files} onFilesChange={setFiles} />
      <FileList files={files} onFilesChange={setFiles} />
      <p className="pdf-form-hint">
        Links, bookmarks, form fields, page labels, attachments and accessibility tags of every file are kept. Title, author, XMP metadata and viewer
        settings come from the first file; those of the others are not carried over.
      </p>

      <button className="pdf-action-btn" disabled={files.length < 2 || processing} onClick={handleMerge}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Merging...' : files.length < 2 ? 'Select at least 2 PDFs' : `Merge ${files.length} PDFs`}
      </button>

      {progress > 0 && processing && (
        <div className="pdf-progress">
          <div className="pdf-progress-bar">
            <div className="pdf-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="pdf-progress-label"><span>Processing...</span><span>{Math.round(progress)}%</span></div>
        </div>
      )}

      <ErrorText message={error} />

      {result && (
        <>
          {notes.length > 0 && (
            <ul className="pdf-notes">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <ProcessedPdfActions fileName="merged.pdf" outputBytes={result} />
        </>
      )}
    </div>
  )
}
