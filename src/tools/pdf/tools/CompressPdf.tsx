import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { formatSize } from '../lib/utils'
import { compressPdf } from '../ops/edit'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function CompressPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [originalSize, setOriginalSize] = useState(0)
  const [error, setError] = useState('')

  async function handleCompress() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      const bytes = await readBytes(files[0])
      setOriginalSize(bytes.length)
      setResult(await compressPdf(bytes))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  const savedPct = result
    ? Math.round((1 - result.length / originalSize) * 100)
    : 0

  return (
    <div>
      <SubtoolHeader icon="compress" color="#2563eb" title="Compress PDF" description="Re-save with compressed object streams — lossless; images are not recompressed, so savings vary" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleCompress}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Compressing...' : 'Compress PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <>
          <div className="pdf-file-info">
            <span className="material-symbols-outlined" aria-hidden="true" style={{ color: 'var(--pdf-muted)' }}>storage</span>
            <span>{formatSize(originalSize)} → {formatSize(result.length)}</span>
            {savedPct > 0 ? (
              <span style={{ color: 'var(--ok)', fontWeight: 600, marginLeft: 'auto' }}>−{savedPct}%</span>
            ) : (
              <span style={{ color: 'var(--pdf-muted)', marginLeft: 'auto' }}>No smaller — keep your original</span>
            )}
          </div>
          <ProcessedPdfActions fileName="compressed.pdf" outputBytes={result} />
        </>
      )}
    </div>
  )
}
