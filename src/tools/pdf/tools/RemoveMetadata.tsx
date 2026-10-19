import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { describeError } from '../lib/errors'
import { readBytes } from '../lib/files'
import type { MetadataFinding, MetadataKind, MetadataReport } from '../ops/metadata'
import { runPdfJob } from '../runner'

const kinds: { kind: MetadataKind; label: string; what: string }[] = [
  { kind: 'info', label: 'Document properties', what: 'Title, author, subject, keywords, creator and producer apps, dates (the Info dictionary)' },
  { kind: 'xmp', label: 'XMP metadata', what: 'XML metadata packets on the document, pages, images or fonts, and orphaned ones' },
  { kind: 'piece-info', label: 'Application data', what: 'Private data editing apps store (/PieceInfo) and last-modified dates' },
  { kind: 'thumbnail', label: 'Page thumbnails', what: 'Small preview images stored with pages (/Thumb)' },
  { kind: 'attachments', label: 'Attachments', what: 'Embedded files and file-attachment annotations' },
  { kind: 'javascript', label: 'JavaScript', what: 'Document scripts and script actions on open, links, pages and form fields' },
  { kind: 'image-metadata', label: 'Photo metadata in images', what: 'EXIF/XMP inside embedded JPEG photos — images are kept byte for byte' },
]

const countOf = (list: MetadataFinding[], kind: MetadataKind) => list.find((f) => f.kind === kind)?.count ?? 0

function Summary({ report }: { report: MetadataReport }) {
  const targeted = new Set(report.targeted)
  const found = report.found.filter((f) => targeted.has(f.kind)).reduce((n, f) => n + f.count, 0)
  const remain = report.remain.filter((f) => targeted.has(f.kind)).reduce((n, f) => n + f.count, 0)
  const ok = remain === 0 && report.contentKept
  return (
    <div className={`pdf-meta-verdict${ok ? ' ok' : ' bad'}`} role="status">
      <span className="material-symbols-outlined" aria-hidden="true">{ok ? 'check_circle' : 'warning'}</span>
      <div>
        <strong>
          {found === 0 ? 'None of the metadata this tool removes was found' : `${found} found → ${remain} remain`}
        </strong>
        <p>
          {remain === 0
            ? 'Checked by reading the cleaned file again, not from the stripper’s own list.'
            : 'Reading the cleaned file again still finds what is listed below.'}{' '}
          {report.contentKept
            ? `Page content of all ${report.pages} page${report.pages === 1 ? '' : 's'} is byte-for-byte unchanged.`
            : 'The page content did not compare equal after re-reading — check the file before you use it.'}
        </p>
      </div>
    </div>
  )
}

function FindingsTable({ report }: { report: MetadataReport }) {
  const targeted = new Set(report.targeted)
  const rows = kinds.filter((k) => countOf(report.found, k.kind) > 0 || countOf(report.remain, k.kind) > 0)
  if (rows.length === 0) return null
  return (
    <div className="pdf-meta-table-wrap">
      <table className="pdf-meta-table">
        <caption className="pdf-meta-caption">What the file carried, and what is left after re-reading the cleaned file</caption>
        <thead>
          <tr>
            <th scope="col">Metadata</th>
            <th scope="col">Found</th>
            <th scope="col">Remain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ kind, label }) => {
            const found = report.found.find((f) => f.kind === kind)
            const remain = countOf(report.remain, kind)
            const kept = !targeted.has(kind)
            return (
              <tr key={kind}>
                <th scope="row">
                  {label}
                  {found && found.details.length > 0 && (
                    <ul className="pdf-meta-details">
                      {found.details.map((d) => <li key={d}>{d}</li>)}
                    </ul>
                  )}
                </th>
                <td>{found?.count ?? 0}</td>
                <td className={kept ? 'pdf-meta-kept' : remain > 0 ? 'pdf-meta-left' : 'pdf-meta-gone'}>
                  {kept ? `${remain} (kept)` : remain}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function RemoveMetadata() {
  const [files, setFiles] = useState<File[]>([])
  const [attachments, setAttachments] = useState(false)
  const [javascript, setJavascript] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [report, setReport] = useState<MetadataReport | null>(null)
  const [error, setError] = useState('')

  async function handleRemove() {
    if (files.length === 0) return
    setProcessing(true)
    setReport(null)
    setError('')
    try {
      setReport(await runPdfJob('remove-metadata', { bytes: await readBytes(files[0]), options: { attachments, javascript } }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader
        icon="visibility_off"
        color="#475569"
        title="Remove Metadata"
        description="Strip what a PDF records about itself and its makers, then check the result by reading it again"
      />

      <FileDropzone files={files} onFilesChange={setFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={setFiles} />

      <ul className="pdf-meta-scope">
        {kinds.slice(0, 4).map((k) => (
          <li key={k.kind}><strong>{k.label}</strong> — {k.what}</li>
        ))}
      </ul>
      <p className="pdf-form-hint">
        The file is rewritten whole, so earlier saved revisions and unreferenced leftovers are dropped too. Page content, form fields, bookmarks and
        comments (with their author names) are not changed, and photos inside the PDF keep their own EXIF — they are listed if found.
      </p>

      <div className="pdf-form-group">
        <label className="pdf-checkbox pdf-meta-option">
          <input type="checkbox" checked={attachments} onChange={(e) => setAttachments(e.target.checked)} /> Also remove attachments (embedded files)
        </label>
        <label className="pdf-checkbox pdf-meta-option">
          <input type="checkbox" checked={javascript} onChange={(e) => setJavascript(e.target.checked)} /> Also remove JavaScript (scripts and script actions)
        </label>
      </div>

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleRemove}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Removing...' : 'Remove metadata'}
      </button>

      <ErrorText message={error} />

      {report && (
        <>
          <Summary report={report} />
          <FindingsTable report={report} />
          {report.notes.length > 0 && (
            <ul className="pdf-notes">
              {report.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <ProcessedPdfActions fileName="cleaned.pdf" outputBytes={report.bytes} />
        </>
      )}
    </div>
  )
}
