import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { splitPdf } from '../ops/organize'
import JSZip from 'jszip'

type SplitMode = 'every' | 'first' | 'ranges'

export function SplitPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<SplitMode>('every')
  const [pagesPerFile, setPagesPerFile] = useState(1)
  const [firstFilePages, setFirstFilePages] = useState(1)
  const [ranges, setRanges] = useState('1-3,4-6,7-9')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleSplit() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      const bytes = await readBytes(files[0])
      const parts = await splitPdf(
        bytes,
        mode === 'every' ? { kind: 'every', pages: pagesPerFile } : mode === 'first' ? { kind: 'first', pages: firstFilePages } : { kind: 'ranges', ranges },
      )
      const zip = new JSZip()
      for (const part of parts) zip.file(part.name, part.bytes)
      setResult(await zip.generateAsync({ type: 'uint8array' }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#ffedd5' }}>
          <span className="material-symbols-outlined" style={{ color: '#ea580c' }}>content_cut</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Split PDF</h2>
          <p>Split a PDF into multiple files, downloaded together as a ZIP</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <p className="pdf-form-hint">
        Each file keeps the document properties and the bookmarks, links, form fields and page labels of its own pages; links and bookmarks that lead
        to pages in another file are removed.
      </p>

      <div className="pdf-form-group">
        <label className="pdf-form-label">Split mode</label>
        <div className="pdf-option-grid">
          {[
            { id: 'every' as const, label: 'Every N pages', icon: 'view_column' },
            { id: 'first' as const, label: 'First X pages', icon: 'first_page' },
            { id: 'ranges' as const, label: 'Page ranges', icon: 'format_list_numbered' },
          ].map((opt) => (
            <div key={opt.id} className={`pdf-option-card${mode === opt.id ? ' on' : ''}`} onClick={() => setMode(opt.id)}>
              <span className="material-symbols-outlined">{opt.icon}</span>
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      </div>

      {mode === 'every' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label">Pages per file</label>
          <input className="pdf-number-input" type="number" min={1} value={pagesPerFile} onChange={(e) => setPagesPerFile(Math.max(1, parseInt(e.target.value) || 1))} />
        </div>
      )}

      {mode === 'first' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label">Pages in first file</label>
          <input className="pdf-number-input" type="number" min={1} value={firstFilePages} onChange={(e) => setFirstFilePages(Math.max(1, parseInt(e.target.value) || 1))} />
        </div>
      )}

      {mode === 'ranges' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label" htmlFor="pdf-split-ranges">Page ranges, one file each (e.g. 1-3,5,7-)</label>
          <input id="pdf-split-ranges" className="pdf-text-input" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} />
        </div>
      )}

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleSplit}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Splitting...' : 'Split PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="split.zip" outputBytes={result} mimeType="application/zip" />
      )}
    </div>
  )
}
