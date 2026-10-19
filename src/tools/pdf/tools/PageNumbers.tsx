import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import type { Corner as Position, NumberStyle } from '../ops/edit'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { OptionGroup, type Option } from '../components/OptionGroup'
import { NumberField, parseWhole } from '../components/NumberField'

export function PageNumbers() {
  const [files, setFiles] = useState<File[]>([])
  const [position, setPosition] = useState<Position>('bottom-center')
  const [style, setStyle] = useState<NumberStyle>('numeric')
  const [prefix, setPrefix] = useState('Page ')
  const [startFrom, setStartFrom] = useState('1')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  const positions: Option<Position>[] = [
    { value: 'top-left', label: 'Top Left', icon: 'format_align_left' },
    { value: 'top-center', label: 'Top Center', icon: 'format_align_center' },
    { value: 'top-right', label: 'Top Right', icon: 'format_align_right' },
    { value: 'bottom-left', label: 'Bottom Left', icon: 'format_align_left' },
    { value: 'bottom-center', label: 'Bottom Center', icon: 'format_align_center' },
    { value: 'bottom-right', label: 'Bottom Right', icon: 'format_align_right' },
  ]

  const styles: Option<NumberStyle>[] = [
    { value: 'numeric', label: '1, 2, 3…' },
    { value: 'roman', label: 'i, ii, iii…' },
    { value: 'custom', label: 'Custom prefix' },
  ]

  async function handleAddNumbers() {
    if (files.length === 0) return
    const start = parseWhole(startFrom)
    if (start === null) {
      setError('Enter a whole number, 1 or more, for “Start from”.')
      return
    }
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult(await runPdfJob('page-numbers', { bytes: await readBytes(files[0]), options: { position, style, prefix, startFrom: start } }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="format_list_numbered" color="#d97706" title="Page Numbers" description="Add page numbers to your PDF" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <OptionGroup label="Position" value={position} onChange={setPosition} options={positions} rows={2} />

      <OptionGroup label="Style" value={style} onChange={setStyle} options={styles} />

      {style === 'custom' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label" htmlFor="pdf-numbers-prefix">Prefix</label>
          <input id="pdf-numbers-prefix" className="pdf-text-input" type="text" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      )}

      <NumberField id="pdf-numbers-start" label="Start from" value={startFrom} onChange={setStartFrom} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleAddNumbers}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Adding numbers...' : 'Add Page Numbers'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="numbered.pdf" outputBytes={result} />
      )}
    </div>
  )
}
