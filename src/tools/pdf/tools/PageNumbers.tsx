import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { addPageNumbers, type Corner as Position, type NumberStyle } from '../ops/edit'

export function PageNumbers() {
  const [files, setFiles] = useState<File[]>([])
  const [position, setPosition] = useState<Position>('bottom-center')
  const [style, setStyle] = useState<NumberStyle>('numeric')
  const [prefix, setPrefix] = useState('Page ')
  const [startFrom, setStartFrom] = useState(1)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  const positions: { id: Position; label: string; icon: string }[] = [
    { id: 'top-left', label: 'Top Left', icon: 'format_align_left' },
    { id: 'top-center', label: 'Top Center', icon: 'format_align_center' },
    { id: 'top-right', label: 'Top Right', icon: 'format_align_right' },
    { id: 'bottom-left', label: 'Bottom Left', icon: 'format_align_left' },
    { id: 'bottom-center', label: 'Bottom Center', icon: 'format_align_center' },
    { id: 'bottom-right', label: 'Bottom Right', icon: 'format_align_right' },
  ]

  const styles: { id: NumberStyle; label: string }[] = [
    { id: 'numeric', label: '1, 2, 3…' },
    { id: 'roman', label: 'i, ii, iii…' },
    { id: 'custom', label: 'Custom prefix' },
  ]

  async function handleAddNumbers() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await addPageNumbers(await readBytes(files[0]), { position, style, prefix, startFrom }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#fef3c7' }}>
          <span className="material-symbols-outlined" style={{ color: '#d97706' }}>format_list_numbered</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Page Numbers</h2>
          <p>Add page numbers to your PDF</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Position</label>
        <div className="pdf-option-grid">
          {positions.slice(0, 3).map((p) => (
            <div key={p.id} className={`pdf-option-card${position === p.id ? ' on' : ''}`} onClick={() => setPosition(p.id)}>
              <span className="material-symbols-outlined">{p.icon}</span>
              <span>{p.label}</span>
            </div>
          ))}
        </div>
        <div className="pdf-option-grid" style={{ marginTop: 8 }}>
          {positions.slice(3).map((p) => (
            <div key={p.id} className={`pdf-option-card${position === p.id ? ' on' : ''}`} onClick={() => setPosition(p.id)}>
              <span className="material-symbols-outlined">{p.icon}</span>
              <span>{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pdf-form-group">
        <label className="pdf-form-label">Style</label>
        <div className="pdf-option-grid">
          {styles.map((s) => (
            <div key={s.id} className={`pdf-option-card${style === s.id ? ' on' : ''}`} onClick={() => setStyle(s.id)}>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {style === 'custom' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label">Prefix</label>
          <input className="pdf-text-input" type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      )}

      <div className="pdf-form-group">
        <label className="pdf-form-label">Start from</label>
        <input className="pdf-number-input" type="number" min={1} value={startFrom} onChange={(e) => setStartFrom(Math.max(1, parseInt(e.target.value) || 1))} />
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleAddNumbers}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Adding numbers...' : 'Add Page Numbers'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="numbered.pdf" outputBytes={result} />
      )}
    </div>
  )
}
