import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { addWatermark, type WatermarkPosition } from '../ops/edit'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { OptionGroup, type Option } from '../components/OptionGroup'

export function Watermark() {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('DRAFT')
  const [opacity, setOpacity] = useState(30)
  const [position, setPosition] = useState<WatermarkPosition>('center')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  const positions: Option<WatermarkPosition>[] = [
    { value: 'center', label: 'Center', icon: 'center_focus_strong' },
    { value: 'tile', label: 'Tile', icon: 'grid_view' },
    { value: 'top-left', label: 'Top Left', icon: 'format_align_left' },
    { value: 'top-right', label: 'Top Right', icon: 'format_align_right' },
    { value: 'bottom-left', label: 'Bottom Left', icon: 'format_align_left' },
    { value: 'bottom-right', label: 'Bottom Right', icon: 'format_align_right' },
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
      <SubtoolHeader icon="water_drop" color="#0d9488" title="Watermark" description="Add text watermark to your PDF pages" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-watermark-text">Watermark text</label>
        <input id="pdf-watermark-text" className="pdf-text-input" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="DRAFT" />
      </div>

      <div className="pdf-form-group">
        <label className="pdf-form-label" htmlFor="pdf-watermark-opacity">Opacity: {opacity}%</label>
        <input id="pdf-watermark-opacity" aria-valuetext={`${opacity}%`} type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value))} style={{ width: '100%' }} />
      </div>

      <OptionGroup label="Position" value={position} onChange={setPosition} options={positions} rows={2} />

      <button className="pdf-action-btn" disabled={files.length === 0 || !text || processing} onClick={handleAdd}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Adding watermark...' : 'Add Watermark'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="watermarked.pdf" outputBytes={result} />
      )}
    </div>
  )
}
