import { useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'

type WatermarkPosition = 'center' | 'tile' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function Watermark() {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('DRAFT')
  const [opacity, setOpacity] = useState(30)
  const [position, setPosition] = useState<WatermarkPosition>('center')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)

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

    try {
      const buf = await files[0].arrayBuffer()
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true })
      const font = await pdf.embedFont(StandardFonts.HelveticaBold)
      const alpha = opacity / 100
      const pages = pdf.getPages()

      for (const page of pages) {
        const { width, height } = page.getSize()
        const fontSize = position === 'tile' ? 20 : Math.min(width, height) * 0.1
        const textWidth = font.widthOfTextAtSize(text, fontSize)

        if (position === 'tile') {
          const stepX = textWidth + 100
          const stepY = 100
          for (let x = 0; x < width; x += stepX) {
            for (let y = 0; y < height; y += stepY) {
              page.drawText(text, {
                x, y, size: fontSize, font,
                color: rgb(0, 0, 0),
                opacity: alpha * 0.5,
              })
            }
          }
        } else {
          const posMap: Record<string, { x: number; y: number }> = {
            'center': { x: (width - textWidth) / 2, y: height / 2 },
            'top-left': { x: 40, y: height - 40 - fontSize },
            'top-right': { x: width - textWidth - 40, y: height - 40 - fontSize },
            'bottom-left': { x: 40, y: 40 },
            'bottom-right': { x: width - textWidth - 40, y: 40 },
          }
          const pos = posMap[position]
          page.drawText(text, {
            x: pos.x, y: pos.y, size: fontSize, font,
            color: rgb(0, 0, 0),
            opacity: alpha,
          })
        }
      }

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

      {result && (
        <ProcessedPdfActions fileName="watermarked.pdf" outputBytes={result} />
      )}
    </div>
  )
}
