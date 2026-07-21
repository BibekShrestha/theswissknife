import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { getPdfJs } from '../lib/pdfjs'

export function PdfToText() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  async function handleExtract() {
    if (files.length === 0) return
    setProcessing(true)
    setError('')
    setText('')

    try {
      const pdfjs = await getPdfJs()
      const buf = await files[0].arrayBuffer()
      const doc = await pdfjs.getDocument({ data: buf.slice() }).promise
      let allText = ''

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        const pageText = content.items.map((item) => {
          if ('str' in item) return item.str
          return ''
        }).join(' ')
        allText += pageText + '\n\n'
        page.cleanup()
      }
      setText(allText.trim())
    } catch (e) {
      setError('Failed to extract text')
    } finally {
      setProcessing(false)
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
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

      {error && <p style={{ color: 'var(--pdf-muted)' }}>{error}</p>}

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
              <span className="material-symbols-outlined">content_copy</span> Copy Text
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
