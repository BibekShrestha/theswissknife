import { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
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

  async function handleSplit() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const zip = new JSZip()
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const total = pdf.getPageCount()

      let pageSets: number[][] = []

      if (mode === 'every') {
        for (let i = 0; i < total; i += pagesPerFile) {
          const end = Math.min(i + pagesPerFile, total)
          pageSets.push(Array.from({ length: end - i }, (_, j) => i + j))
        }
      } else if (mode === 'first') {
        const firstEnd = Math.min(firstFilePages, total)
        pageSets.push(Array.from({ length: firstEnd }, (_, j) => j))
        if (firstEnd < total) {
          pageSets.push(Array.from({ length: total - firstEnd }, (_, j) => firstEnd + j))
        }
      } else if (mode === 'ranges') {
        const parts = ranges.split(',').map((s) => s.trim())
        for (const part of parts) {
          if (part.includes('-')) {
            const [a, b] = part.split('-').map((s) => parseInt(s.trim()))
            pageSets.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i))
          } else {
            pageSets.push([parseInt(part) - 1])
          }
        }
      }

      for (let i = 0; i < pageSets.length; i++) {
        const indices = pageSets[i].filter((p) => p >= 0 && p < total)
        if (indices.length === 0) continue
        const newPdf = await PDFDocument.create()
        const pages = await newPdf.copyPages(pdf, indices)
        pages.forEach((p) => newPdf.addPage(p))
        const bytes = await newPdf.save()
        zip.file(`split-${i + 1}.pdf`, bytes)
      }

      const zipBytes = await zip.generateAsync({ type: 'uint8array' })
      setResult(zipBytes)
    } catch (e) {
      console.error(e)
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
          <p>Split a PDF into multiple files</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

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
          <label className="pdf-form-label">Page ranges (e.g., 1-3,4-6,7-9)</label>
          <input className="pdf-text-input" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} />
        </div>
      )}

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleSplit}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Splitting...' : 'Split PDF'}
      </button>

      {result && (
        <ProcessedPdfActions fileName="split.zip" outputBytes={result} />
      )}
    </div>
  )
}
