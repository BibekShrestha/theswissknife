import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { PageCard, PageGrid, PagesLoading } from '../components/PageGrid'
import { useDocState, usePdfDocument } from '../components/usePdfDocument'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

/** The extra turn as the person reads it. */
const turnName = (deg: number) => (deg === 90 ? 'turned right' : deg === 180 ? 'upside down' : deg === 270 ? 'turned left' : 'as it is')

export function RotatePdf() {
  const [files, setFiles] = useState<File[]>([])
  const { doc, error: loadError, loading } = usePdfDocument(files[0])
  // the extra clockwise turn per page, kept unwrapped (450 rather than 90) so the thumbnails turn the short way round
  const [turns, setTurns] = useDocState(doc, (n) => Array<number>(n).fill(0))
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ bytes: Uint8Array; spec: string; doc: unknown } | null>(null)
  const [error, setError] = useState('')

  const rotation = turns.map((t) => ((t % 360) + 360) % 360)
  const spec = rotation.join(',')
  const changed = rotation.filter((t) => t !== 0).length

  const turn = (page: number, by: number) => setTurns((ts) => ts.map((t, i) => (i === page ? t + by : t)))
  const turnAll = (by: number) => setTurns((ts) => ts.map((t) => t + by))

  async function handleRotate() {
    if (files.length === 0 || changed === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      setResult({ bytes: await runPdfJob('rotate', { bytes: await readBytes(files[0]), rotation }), spec, doc })
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="rotate_right" color="#0891b2" title="Rotate PDF" description="Turn single pages or all of them, then save" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <PagesLoading loading={loading} />
      <ErrorText message={loadError} />

      {doc && (
        <>
          <div className="pdf-page-bar">
            <span className="pdf-page-bar-count" role="status">
              {changed === 0 ? 'No pages turned yet' : `${changed} of ${turns.length} page${turns.length === 1 ? '' : 's'} turned`}
            </span>
            <div className="pdf-page-bar-actions" role="group" aria-label="Turn every page">
              <button type="button" onClick={() => turnAll(-90)}>
                <span className="material-symbols-outlined" aria-hidden="true">rotate_left</span> All left
              </button>
              <button type="button" onClick={() => turnAll(90)}>
                <span className="material-symbols-outlined" aria-hidden="true">rotate_right</span> All right
              </button>
              <button type="button" onClick={() => setTurns(turns.map(() => 0))} disabled={changed === 0}>Reset</button>
            </div>
          </div>
          <p className="pdf-form-hint">Click a page to turn it right, or use the arrows under it.</p>
          <PageGrid label="Pages">
            {turns.map((t, i) => (
              <PageCard
                key={i}
                doc={doc}
                page={i}
                rotation={t}
                label={`Page ${i + 1}, ${turnName(rotation[i])}. Turn right`}
                onClick={() => turn(i, 90)}
                className={rotation[i] ? 'is-turned' : undefined}
                tools={
                  <span className="pdf-page-tools">
                    <button type="button" onClick={() => turn(i, -90)} aria-label={`Turn page ${i + 1} left`}>
                      <span className="material-symbols-outlined" aria-hidden="true">rotate_left</span>
                    </button>
                    <button type="button" onClick={() => turn(i, 90)} aria-label={`Turn page ${i + 1} right`}>
                      <span className="material-symbols-outlined" aria-hidden="true">rotate_right</span>
                    </button>
                  </span>
                }
              />
            ))}
          </PageGrid>

          <button className="pdf-action-btn" disabled={changed === 0 || processing} onClick={handleRotate}>
            <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
            {processing ? 'Rotating...' : changed === 0 ? 'Turn a page to rotate it' : `Save with ${changed} page${changed === 1 ? '' : 's'} turned`}
          </button>
        </>
      )}

      <ErrorText message={error} />

      {result && result.spec === spec && result.doc === doc && (
        <ProcessedPdfActions fileName="rotated.pdf" outputBytes={result.bytes} />
      )}
    </div>
  )
}
