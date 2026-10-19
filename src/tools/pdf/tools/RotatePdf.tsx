import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import type { Rotation } from '../ops/organize'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { OptionGroup } from '../components/OptionGroup'

export function RotatePdf() {
  const [files, setFiles] = useState<File[]>([])
  const [rotation, setRotation] = useState<Rotation>(90)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleRotate() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await runPdfJob('rotate', { bytes: await readBytes(files[0]), rotation }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="rotate_right" color="#0891b2" title="Rotate PDF" description="Rotate all pages by the chosen angle" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <OptionGroup
        label="Rotation angle"
        value={rotation}
        onChange={setRotation}
        options={[
          { value: 90 as Rotation, label: '90° CW', icon: 'rotate_90_degrees_cw' },
          { value: 180 as Rotation, label: '180°', icon: 'flip' },
          { value: 270 as Rotation, label: '90° CCW', icon: 'rotate_90_degrees_ccw' },
        ]}
      />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRotate}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Rotating...' : 'Rotate PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="rotated.pdf" outputBytes={result} />
      )}
    </div>
  )
}
