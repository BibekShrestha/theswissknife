import { useEffect, useRef } from 'react'
import { DELIMITERS } from './csvparse'
import { ENCODING_LABELS } from './decode'
import {
  describeDelimiter,
  FORMAT_LABELS,
  type Analysis,
  type DataFormat,
  type DataSource,
  type ImportProgress,
  type RaggedReport,
  type ReadOptions,
} from './importer'
import { IMPORT_STALL_MS } from './runner'
import { formatBytes, formatCell } from './sql'

export interface DraftItem {
  key: number
  source: DataSource
  options: ReadOptions
  table: string
  analysis: Analysis | null
  error: string | null
  loading: boolean
}

export type ImportTarget = 'current' | 'new'

export interface ImportRun {
  progress: ImportProgress | null
  cancelling: boolean
}

interface Props {
  items: DraftItem[]
  target: ImportTarget
  /** The open database's name, or null when none is open. */
  currentName: string | null
  /** The open database has edits that replacing it would lose. */
  currentDirty: boolean
  emptyAsNull: boolean
  /** Per item key: why its table name can't be used. */
  problems: Record<number, string | null>
  running: ImportRun | null
  /** Shown under the buttons: a cancel or a failure. */
  outcome: string | null
  onTarget: (target: ImportTarget) => void
  onEmptyAsNull: (value: boolean) => void
  onOptions: (key: number, patch: Partial<ReadOptions>) => void
  onRename: (key: number, table: string) => void
  onRemove: (key: number) => void
  onAddFiles: () => void
  onImport: () => void
  onCancel: () => void
  onClose: () => void
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function raggedText(r: RaggedReport, header: boolean): string {
  const parts: string[] = []
  const against = header ? 'the header' : 'the first row'
  if (r.short) parts.push(`${plural(r.short, 'row')} ${r.short === 1 ? 'has' : 'have'} fewer than the ${r.width} fields of ${against} — the missing fields become NULL`)
  if (r.long) parts.push(`${plural(r.long, 'row')} ${r.long === 1 ? 'has' : 'have'} more — the extra fields go into added columns`)
  const examples = r.examples.map((e) => `record ${e.record.toLocaleString()} (${plural(e.fields, 'field')})`).join(', ')
  return `${parts.join('; ')}. First: ${examples}${r.short + r.long > r.examples.length ? ', …' : ''}.`
}

function formatLabel(a: Analysis): string {
  const what = a.format === 'csv' && a.delimiter ? `${a.delimiter === '\t' ? 'TSV' : 'CSV'} · ${describeDelimiter(a.delimiter)}` : FORMAT_LABELS[a.format]
  return `${what} · ${ENCODING_LABELS[a.encoding]}${a.fromBom ? ' (BOM)' : ' (detected)'}`
}

function ItemCard({ item, problem, disabled, onOptions, onRename, onRemove }: {
  item: DraftItem
  problem: string | null
  disabled: boolean
  onOptions: Props['onOptions']
  onRename: Props['onRename']
  onRemove: Props['onRemove']
}) {
  const { analysis: a, options, key } = item
  const id = `sqlite-import-${key}`
  return (
    <section className="sqlite-import-item" aria-labelledby={`${id}-name`}>
      <header className="sqlite-import-item-head">
        <strong id={`${id}-name`} title={item.source.name}>{item.source.name}</strong>
        <span className="sqlite-meta">
          {formatBytes(item.source.bytes.length)}
          {a && ` · ${formatLabel(a)}`}
        </span>
        <button type="button" className="sqlite-import-remove" onClick={() => onRemove(key)} disabled={disabled} aria-label={`Remove ${item.source.name}`} title="Remove from the import">
          <span className="material-symbols-outlined" aria-hidden>close</span>
        </button>
      </header>

      <div className="sqlite-import-fields">
        <label className="sqlite-import-field">
          <span>Table</span>
          <input
            type="text"
            value={item.table}
            onChange={(event) => onRename(key, event.target.value)}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
          />
        </label>
        <label className="sqlite-import-field">
          <span>Format</span>
          <select value={options.format} onChange={(event) => onOptions(key, { format: event.target.value as ReadOptions['format'] })} disabled={disabled}>
            <option value="auto">Auto{a ? ` (${FORMAT_LABELS[a.format]})` : ''}</option>
            {(Object.keys(FORMAT_LABELS) as DataFormat[]).map((f) => (
              <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
            ))}
          </select>
        </label>
        {a?.format === 'csv' && (
          <>
            <label className="sqlite-import-field">
              <span>Separator</span>
              <select value={options.delimiter} onChange={(event) => onOptions(key, { delimiter: event.target.value })} disabled={disabled}>
                <option value="auto">Auto{a.delimiter ? ` (${describeDelimiter(a.delimiter)})` : ''}</option>
                {DELIMITERS.map((d) => (
                  <option key={d} value={d}>{describeDelimiter(d)}</option>
                ))}
              </select>
            </label>
            <label className="sqlite-import-field">
              <span>Header</span>
              <select value={options.header} onChange={(event) => onOptions(key, { header: event.target.value as ReadOptions['header'] })} disabled={disabled}>
                <option value="auto">Auto ({a.headerGuess ? 'first row' : 'none'})</option>
                <option value="yes">First row names the columns</option>
                <option value="no">No header row</option>
              </select>
            </label>
          </>
        )}
        {a?.format === 'json' && (a.jsonArrays.length > 0 || options.jsonRows !== '') && (
          <label className="sqlite-import-field">
            <span>Rows</span>
            <select value={options.jsonRows} onChange={(event) => onOptions(key, { jsonRows: event.target.value })} disabled={disabled}>
              <option value="">The object itself (one row)</option>
              {a.jsonArrays.map((k) => (
                <option key={k} value={k}>Items of “{k}”</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {problem && <p id={`${id}-problem`} className="sqlite-import-problem">{problem}</p>}

      {item.loading && <p className="sqlite-empty">Reading…</p>}
      {item.error && <p className="sqlite-error" role="alert">{item.error}</p>}
      {a && !item.loading && (
        <>
          <p className="sqlite-meta">
            {plural(a.rows, 'row')} · {plural(a.columns.length, 'column')}
            {a.format === 'csv' && (a.header ? ' · first row used as column names' : ' · no header row')}
          </p>
          {(a.ragged || a.issues.length > 0) && (
            <ul className="sqlite-import-issues">
              {a.ragged && <li>{raggedText(a.ragged, Boolean(a.header))}</li>}
              {a.issues.map((issue, i) => <li key={i}>{issue}</li>)}
            </ul>
          )}
          {a.columns.length > 0 && (
            <div className="sqlite-grid-wrap sqlite-import-cols">
              <table className="sqlite-grid">
                <thead>
                  <tr>
                    <th scope="col">Column</th>
                    <th scope="col">Type</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {a.columns.map((c, i) => (
                    <tr key={i}>
                      <td>
                        {c.name}
                        {c.source.trim() !== c.name && <span className="sqlite-import-from"> from {c.source ? JSON.stringify(c.source) : 'an empty name'}</span>}
                      </td>
                      <td className="sqlite-import-type">{c.type}</td>
                      <td className="sqlite-import-note">{c.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {a.sample.length > 0 && (
            <details className="sqlite-import-sample">
              <summary>First {plural(a.sample.length, 'row')} as stored</summary>
              <div className="sqlite-grid-wrap">
                <table className="sqlite-grid">
                  <thead>
                    <tr>{a.columns.map((c, i) => <th key={i} scope="col">{c.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {a.sample.map((row, r) => (
                      <tr key={r}>
                        {row.map((value, c) => {
                          const cell = formatCell(value)
                          return <td key={c} className={`sqlite-cell-${cell.kind}`} title={cell.title}>{cell.kind === 'null' ? 'NULL' : cell.text}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function progressText(p: ImportProgress | null, cancelling: boolean): string {
  if (cancelling) return 'Cancelling — rolling back…'
  if (!p) return 'Starting…'
  const of = p.files > 1 ? ` (file ${p.file + 1} of ${p.files})` : ''
  if (p.phase === 'reading') return `Reading the file for ${p.table}${of}…`
  return `Inserting into ${p.table}: ${p.done.toLocaleString()} of ${plural(p.total, 'row')}${of}`
}

export function ImportPanel(props: Props) {
  const { items, target, currentName, currentDirty, emptyAsNull, problems, running, outcome } = props
  const dialog = useRef<HTMLDivElement>(null)
  const busy = running !== null
  const ready = items.length > 0 && items.every((item) => item.analysis && !item.loading && !item.error && item.analysis.columns.length > 0 && !problems[item.key])
  const p = running?.progress ?? null
  // Progress across the whole batch: files done plus the share of the current one.
  const fraction = p && p.total > 0 ? (p.file + p.done / p.total) / p.files : p ? p.file / p.files : 0

  useEffect(() => {
    dialog.current?.focus()
  }, [])

  return (
    <div className="sqlite-import-backdrop">
      <div
        ref={dialog}
        className="sqlite-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sqlite-import-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) props.onClose()
        }}
      >
        <header className="sqlite-import-top">
          <h2 id="sqlite-import-title">Import data as tables</h2>
          <button type="button" onClick={props.onClose} disabled={busy} aria-label="Close import">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <p className="sqlite-import-lede">
          CSV, TSV, JSON (an array of objects, or one object) and JSON Lines — one table per file, read in this tab. Nothing is uploaded.
        </p>

        <fieldset className="sqlite-import-target" disabled={busy}>
          <legend>Into</legend>
          {currentName !== null && (
            <label>
              <input type="radio" name="sqlite-import-target" checked={target === 'current'} onChange={() => props.onTarget('current')} />
              <span>the open database, <strong>{currentName}</strong></span>
            </label>
          )}
          <label>
            <input type="radio" name="sqlite-import-target" checked={target === 'new'} onChange={() => props.onTarget('new')} />
            <span>
              a new empty in-memory database
              {currentName !== null && target === 'new' && (
                <em className="sqlite-import-warn"> — closes {currentName}{currentDirty ? ', and its unsaved edits are lost' : ''}</em>
              )}
            </span>
          </label>
          <label className="sqlite-import-check">
            <input type="checkbox" checked={emptyAsNull} onChange={(event) => props.onEmptyAsNull(event.target.checked)} />
            <span>Empty CSV fields become NULL (otherwise empty text)</span>
          </label>
        </fieldset>

        <div className="sqlite-import-items">
          {items.map((item) => (
            <ItemCard key={item.key} item={item} problem={problems[item.key] ?? null} disabled={busy} onOptions={props.onOptions} onRename={props.onRename} onRemove={props.onRemove} />
          ))}
          {items.length === 0 && <p className="sqlite-empty">No files left to import.</p>}
        </div>

        <footer className="sqlite-import-foot">
          {running ? (
            <>
              <div className="sqlite-import-progress" role="status" aria-live="polite">
                <progress value={fraction} max={1} aria-label="Import progress" />
                <span>{progressText(p, running.cancelling)}</span>
              </div>
              <button type="button" onClick={props.onCancel} disabled={running.cancelling}>
                {running.cancelling ? 'Cancelling…' : 'Cancel import'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="sqlite-primary" onClick={props.onImport} disabled={!ready}>
                Import {items.length === 1 ? 'table' : `${items.length} tables`}
              </button>
              <button type="button" onClick={props.onAddFiles}>Add files…</button>
              <button type="button" onClick={props.onClose}>Close</button>
            </>
          )}
          <p className="sqlite-fine sqlite-import-fine">
            All files go in one transaction with prepared inserts. Cancel stops at the next batch of rows and rolls the
            whole import back — nothing is half-inserted. A long import is only stopped if it reports no progress for{' '}
            {IMPORT_STALL_MS / 1000} s.
          </p>
          {outcome && <p className="sqlite-import-outcome" role="alert">{outcome}</p>}
        </footer>
      </div>
    </div>
  )
}
