import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { addWatermark, type WatermarkPosition } from '../ops/edit'

export function Watermark() {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('DRAFT')
  const [opacity, setOpacity] = useState(30)
  const [position, setPosition] = useState<WatermarkPosition>('center')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  const positions: { id: WatermarkPosition; label: string; icon: string }[] = [
    { id: 'center', label: 'Center', icon: 'center_focus_strong' },
    { id: 'tile', label: 'Tile', icon: 'grid_view' },
    { id: 'top-left', label: 'Top Left', icon: 'format_align_left' },
    { id: 'top-right', label: 'Top Right', icon: 'format_align_right' },
    { id: 'bottom-left', label: 'Bottom Left', icon: 'format_align_left' },
    { id: 'bottom-right', label: 'Bottom Right', icon: 'format_align_right' },
  ]

  async function handleAdd() {
    if (files.length === 0 || !text) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await addWatermark(await readBytes(files[0]), { text, opacity: opacity / 100, position }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#ccfbf1' }}>
          <span className="material-symbols-outlined" style={{ color: '#0d9488' }}>water_drop</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Watermark</h2>
          <p>Add text watermark to your PDF pages</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Watermark text</label>
        <input className="pdf-text-input" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="DRAFT" />
      </div>

      <div className="pdf-form-group">
        <label className="pdf-form-label">Opacity: {opacity}%</label>
        <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value))} style={{ width: '100%' }} />
      </div>

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

      <button className="pdf-action-btn" disabled={files.length === 0 || !text || processing} onClick={handleAdd}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Adding watermark...' : 'Add Watermark'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="watermarked.pdf" outputBytes={result} />
      )}
    </div>
  )
}
