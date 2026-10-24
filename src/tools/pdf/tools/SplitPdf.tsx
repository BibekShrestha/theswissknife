import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { describePages } from '../lib/pages'
import { runPdfJob } from '../runner'
import JSZip from 'jszip'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { OptionGroup } from '../components/OptionGroup'
import { parseWhole } from '../components/NumberField'
import { PageCard, PageGrid, PagesLoading, SelectionBar, usePageSelection } from '../components/PageGrid'
import { useDocState, usePdfDocument } from '../components/usePdfDocument'

type SplitMode = 'parts' | 'extract'

/** Page runs between the cuts, as "1-3,4,5-9" — one file each. */
function runsOf(total: number, cuts: ReadonlySet<number>): [number, number][] {
  const runs: [number, number][] = []
  let start = 0
  for (let i = 0; i < total; i++) {
    if (cuts.has(i) || i === total - 1) {
      runs.push([start, i])
      start = i + 1
    }
  }
  return runs
}

export function SplitPdf() {
  const [files, setFiles] = useState<File[]>([])
  const { doc, error: loadError, loading } = usePdfDocument(files[0])
  const [mode, setMode] = useState<SplitMode>('parts')
  // a cut after page i (0-based) starts a new file at page i + 1
  const [cuts, setCuts] = useDocState(doc, () => new Set<number>() as ReadonlySet<number>)
  const { selected, toggle, set } = usePageSelection(doc)
  const [every, setEvery] = useState('1')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ bytes: Uint8Array; spec: string; doc: unknown; zip: boolean } | null>(null)
  const [error, setError] = useState('')

  const total = doc?.numPages ?? 0
  const runs = runsOf(total, cuts)
  const fileOf: number[] = []
  runs.forEach(([a, b], f) => {
    for (let i = a; i <= b; i++) fileOf[i] = f
  })
  const picked = [...selected].sort((a, b) => a - b)
  const spec =
    mode === 'parts'
      ? `parts:${runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}-${b + 1}`)).join(',')}`
      : `extract:${describePages(picked)}`
  const ready = mode === 'parts' ? runs.length > 1 : picked.length > 0

  function toggleCut(after: number) {
    setCuts((c) => {
      const next = new Set(c)
      if (!next.delete(after)) next.add(after)
      return next
    })
  }

  function cutEvery() {
    const n = parseWhole(every)
    if (n === null) {
      setError('Enter a whole number of pages, 1 or more, for “Pages per file”.')
      return
    }
    setError('')
    setCuts(new Set(Array.from({ length: Math.ceil(total / n) - 1 }, (_, k) => (k + 1) * n - 1)))
  }

  async function handleSplit() {
    if (files.length === 0 || !ready) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      const bytes = await readBytes(files[0])
      if (mode === 'parts') {
        const ranges = spec.slice('parts:'.length)
        const parts = await runPdfJob('split', { bytes, mode: { kind: 'ranges', ranges } })
        const zip = new JSZip()
        for (const part of parts) zip.file(part.name, part.bytes)
        setResult({ bytes: await zip.generateAsync({ type: 'uint8array' }), spec, doc, zip: true })
      } else {
        // extracting = removing every page that was not picked; order and links are kept as they were
        const others = describePages(Array.from({ length: total }, (_, i) => i).filter((i) => !selected.has(i)))
        const out = others ? await runPdfJob('remove-pages', { bytes, spec: others }) : bytes
        setResult({ bytes: out, spec, doc, zip: false })
      }
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="content_cut" color="#ea580c" title="Split PDF" description="Cut a PDF into several files, or pull chosen pages out into a new one" />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />
      <PagesLoading loading={loading} />
      <ErrorText message={loadError} />

      {doc && (
        <>
          <OptionGroup
            label="What to do"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'parts' as const, label: 'Split into files', icon: 'content_cut' },
              { value: 'extract' as const, label: 'Extract pages', icon: 'checklist' },
            ]}
          />

          {mode === 'parts' ? (
            <>
              <div className="pdf-page-bar">
                <span className="pdf-page-bar-count" role="status">
                  {runs.length === 1 ? 'No split points yet' : `${runs.length} files: ${runs.map(([a, b]) => (a === b ? a + 1 : `${a + 1}–${b + 1}`)).join(' · ')}`}
                </span>
                <div className="pdf-page-bar-actions" role="group" aria-label="Split points">
                  <label className="pdf-page-bar-every">
                    Pages per file
                    <input className="pdf-number-input" type="number" inputMode="numeric" min={1} step={1} value={every} onChange={(e) => setEvery(e.target.value)} />
                  </label>
                  <button type="button" onClick={cutEvery}>Split evenly</button>
                  <button type="button" onClick={() => setCuts(new Set())} disabled={cuts.size === 0}>Clear</button>
                </div>
              </div>
              <p className="pdf-form-hint">
                Click the scissors between two pages to start a new file there. Each file keeps the document properties and the bookmarks, links, form fields and page labels of its own pages; links and bookmarks that lead to pages in another file are removed.
              </p>
              <PageGrid label="Pages" className="pdf-pages-cuttable">
                {Array.from({ length: total }, (_, i) => (
                  <PageCard
                    key={i}
                    doc={doc}
                    page={i}
                    badge={runs.length > 1 && (i === 0 || cuts.has(i - 1)) ? `File ${fileOf[i] + 1}` : undefined}
                    className={fileOf[i] % 2 ? 'is-alt' : undefined}
                    after={
                      i < total - 1 && (
                        <button
                          type="button"
                          className={`pdf-page-cut${cuts.has(i) ? ' on' : ''}`}
                          aria-pressed={cuts.has(i)}
                          aria-label={`Split between page ${i + 1} and ${i + 2}`}
                          onClick={() => toggleCut(i)}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">content_cut</span>
                        </button>
                      )
                    }
                  />
                ))}
              </PageGrid>
            </>
          ) : (
            <>
              <SelectionBar total={total} selected={selected} onSet={set} />
              <p className="pdf-form-hint">Click the pages to put in the new PDF; Shift-click picks every page up to it. They keep their order, links and bookmarks among themselves.</p>
              <PageGrid label="Pages">
                {Array.from({ length: total }, (_, i) => (
                  <PageCard key={i} doc={doc} page={i} pressed={selected.has(i)} label={`Page ${i + 1}`} onClick={(e) => toggle(i, e.shiftKey)} />
                ))}
              </PageGrid>
            </>
          )}

          <button className="pdf-action-btn" disabled={!ready || processing} onClick={handleSplit}>
            <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
            {processing
              ? 'Splitting...'
              : mode === 'parts'
                ? ready ? `Split into ${runs.length} files` : 'Add a split point between pages'
                : ready ? `Extract ${picked.length} page${picked.length === 1 ? '' : 's'}` : 'Click the pages to extract'}
          </button>
        </>
      )}

      <ErrorText message={error} />

      {result && result.spec === spec && result.doc === doc && (
        result.zip
          ? <ProcessedPdfActions fileName="split.zip" outputBytes={result.bytes} mimeType="application/zip" />
          : <ProcessedPdfActions fileName="extracted.pdf" outputBytes={result.bytes} />
      )}
    </div>
  )
}
