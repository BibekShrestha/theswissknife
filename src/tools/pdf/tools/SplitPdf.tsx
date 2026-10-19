import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import JSZip from 'jszip'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { OptionGroup } from '../components/OptionGroup'
import { NumberField, parseWhole } from '../components/NumberField'

type SplitMode = 'every' | 'first' | 'ranges'

export function SplitPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<SplitMode>('every')
  const [pagesPerFile, setPagesPerFile] = useState('1')
  const [firstFilePages, setFirstFilePages] = useState('1')
  const [ranges, setRanges] = useState('1-3,4-6,7-9')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleSplit() {
    if (files.length === 0) return
    const count = mode === 'ranges' ? 1 : parseWhole(mode === 'every' ? pagesPerFile : firstFilePages)
    if (count === null) {
      setError(`Enter a whole number of pages, 1 or more, for “${mode === 'every' ? 'Pages per file' : 'Pages in first file'}”.`)
      return
    }
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      const bytes = await readBytes(files[0])
      const parts = await runPdfJob('split', {
        bytes,
        mode: mode === 'ranges' ? { kind: 'ranges', ranges } : { kind: mode, pages: count },
      })
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
      <SubtoolHeader icon="content_cut" color="#ea580c" title="Split PDF" description="Split a PDF into multiple files, downloaded together as a ZIP" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <p className="pdf-form-hint">
        Each file keeps the document properties and the bookmarks, links, form fields and page labels of its own pages; links and bookmarks that lead
        to pages in another file are removed.
      </p>

      <OptionGroup
        label="Split mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'every' as const, label: 'Every N pages', icon: 'view_column' },
          { value: 'first' as const, label: 'First X pages', icon: 'first_page' },
          { value: 'ranges' as const, label: 'Page ranges', icon: 'format_list_numbered' },
        ]}
      />

      {mode === 'every' && <NumberField id="pdf-split-every" label="Pages per file" value={pagesPerFile} onChange={setPagesPerFile} />}

      {mode === 'first' && <NumberField id="pdf-split-first" label="Pages in first file" value={firstFilePages} onChange={setFirstFilePages} />}

      {mode === 'ranges' && (
        <div className="pdf-form-group">
          <label className="pdf-form-label" htmlFor="pdf-split-ranges">Page ranges, one file each (e.g. 1-3,5,7-)</label>
          <input id="pdf-split-ranges" className="pdf-text-input" type="text" value={ranges} onChange={(e) => setRanges(e.target.value)} />
        </div>
      )}

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleSplit}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Splitting...' : 'Split PDF'}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="split.zip" outputBytes={result} mimeType="application/zip" />
      )}
    </div>
  )
}
