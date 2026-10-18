import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { mergePdfs } from '../ops/organize'

export function MergePdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleMerge() {
    if (files.length < 2) return
    setProcessing(true)
    setProgress(0)
    setResult(null)
    setError('')

    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await readBytes(f) })))
      setResult(await mergePdfs(inputs, (done) => setProgress((done / files.length) * 100)))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#fee2e2' }}>
          <span className="material-symbols-outlined" style={{ color: '#dc2626' }}>merge</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Merge PDF</h2>
          <p>Combine multiple PDFs into one document, in the order listed</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length < 2 || processing} onClick={handleMerge}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
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
        <ProcessedPdfActions fileName="merged.pdf" outputBytes={result} />
      )}
    </div>
  )
}
