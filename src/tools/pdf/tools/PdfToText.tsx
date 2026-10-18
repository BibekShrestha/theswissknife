import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { getPdfJs } from '../lib/pdfjs'
import { extractText } from '../ops/read'

export function PdfToText() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleExtract() {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setText(null)
    setCopied(false)

    try {
      const pages = await extractText(await getPdfJs(), new Uint8Array(await files[0].arrayBuffer()))
      setText(pages.join('\n\n').trim())
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text ?? '')
      setCopied(true)
    } catch { /* ignore */ }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#f1f5f9' }}>
          <span className="material-symbols-outlined" style={{ color: '#64748b' }}>text_snippet</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>PDF to Text</h2>
          <p>Extract text content from PDF files</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleExtract}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Extracting...' : 'Extract Text'}
      </button>

      <ErrorText message={error} />

      {text === '' && (
        <ErrorText message="No text found. The pages may be scanned images — this tool reads embedded text and does not do OCR." />
      )}

      {text && (
        <div className="pdf-processed">
          <div className="pdf-processed-header">
            <span className="material-symbols-outlined" style={{ color: '#059669' }}>check_circle</span>
            <div className="pdf-processed-info">
              <h4>Text extracted ({text.length.toLocaleString()} chars)</h4>
            </div>
          </div>
          <div className="pdf-processed-actions">
            <button className="pdf-processed-preview" onClick={copyText}>
              <span className="material-symbols-outlined">content_copy</span> {copied ? 'Copied' : 'Copy Text'}
            </button>
          </div>
          <pre style={{
            marginTop: 12, padding: 12, fontSize: 12, lineHeight: 1.5,
            maxHeight: 300, overflow: 'auto', border: '1px solid var(--pdf-border)',
            borderRadius: 'var(--pdf-radius)', background: 'var(--pdf-canvas)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{text}</pre>
        </div>
      )}
    </div>
  )
}
