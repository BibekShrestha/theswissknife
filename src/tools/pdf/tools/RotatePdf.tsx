import { useState } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

type Rotation = 90 | 180 | 270

export function RotatePdf() {
  const [files, setFiles] = useState<File[]>([])
  const [rotation, setRotation] = useState<Rotation>(90)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)

  async function handleRotate() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const pages = pdf.getPages()
      pages.forEach((p) => {
        p.setRotation(degrees((p.getRotation().angle + rotation) % 360))
      })
      const bytes = await pdf.save()
      setResult(bytes)
    } catch (e) {
      console.error(e)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <div className="pdf-subtool-header">
        <div className="pdf-subtool-icon" style={{ background: '#cffafe' }}>
          <span className="material-symbols-outlined" style={{ color: '#0891b2' }}>rotate_right</span>
        </div>
        <div className="pdf-subtool-info">
          <h2>Rotate PDF</h2>
          <p>Rotate all pages by the chosen angle</p>
        </div>
      </div>

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <div className="pdf-form-group">
        <label className="pdf-form-label">Rotation angle</label>
        <div className="pdf-option-grid">
          {[
            { value: 90 as Rotation, label: '90° CW', icon: 'rotate_90_degrees_ccw' },
            { value: 180 as Rotation, label: '180°', icon: 'flip' },
            { value: 270 as Rotation, label: '90° CCW', icon: 'rotate_90_degrees_cw' },
          ].map((opt) => (
            <div key={opt.value} className={`pdf-option-card${rotation === opt.value ? ' on' : ''}`} onClick={() => setRotation(opt.value)}>
              <span className="material-symbols-outlined">{opt.icon}</span>
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRotate}>
        <span className="material-symbols-outlined pdf-spinner" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Rotating...' : 'Rotate PDF'}
      </button>

      {result && (
        <ProcessedPdfActions fileName="rotated.pdf" outputBytes={result} />
      )}
    </div>
  )
}
