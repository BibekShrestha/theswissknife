import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { PageCard, PageGrid, PagesLoading, SelectionBar, usePageSelection } from '../components/PageGrid'
import { usePdfDocument } from '../components/usePdfDocument'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { describePages } from '../lib/pages'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

export function RemovePages() {
  const [files, setFiles] = useState<File[]>([])
  const { doc, error: loadError, loading } = usePdfDocument(files[0])
  const { selected, toggle, set } = usePageSelection(doc)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ bytes: Uint8Array; spec: string; doc: unknown } | null>(null)
  const [error, setError] = useState('')

  const total = doc?.numPages ?? 0
  const spec = describePages([...selected].sort((a, b) => a - b))
  const left = total - selected.size

  async function handleRemove() {
    if (files.length === 0 || selected.size === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult({ bytes: await runPdfJob('remove-pages', { bytes: await readBytes(files[0]), spec }), spec, doc })
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="delete" color="#e11d48" title="Remove Pages" description="Click the pages you don't want, then save the rest as a new PDF" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <PagesLoading loading={loading} />
      <ErrorText message={loadError} />

      {doc && (
        <>
          <SelectionBar total={total} selected={selected} onSet={set} noun="marked to remove" />
          <p className="pdf-form-hint">Click a page to mark it; Shift-click marks every page up to it. Links and bookmarks that lead to removed pages go with them, and so do form fields that appear only on them.</p>
          <PageGrid label="Pages">
            {Array.from({ length: total }, (_, i) => (
              <PageCard
                key={i}
                doc={doc}
                page={i}
                tone="remove"
                pressed={selected.has(i)}
                label={`Page ${i + 1}`}
                onClick={(e) => toggle(i, e.shiftKey)}
              />
            ))}
          </PageGrid>

          <button className="pdf-action-btn" disabled={selected.size === 0 || left === 0 || processing} onClick={handleRemove}>
            <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
            {processing
              ? 'Removing pages...'
              : selected.size === 0
                ? 'Click the pages to remove'
                : left === 0
                  ? 'Leave at least one page'
                  : `Remove ${selected.size} page${selected.size === 1 ? '' : 's'}, keep ${left}`}
          </button>
        </>
      )}

      <ErrorText message={error} />

      {/* a result is shown only for the file and pages it was made from */}
      {result && result.spec === spec && result.doc === doc && (
        <ProcessedPdfActions fileName="trimmed.pdf" outputBytes={result.bytes} />
      )}
    </div>
  )
}
