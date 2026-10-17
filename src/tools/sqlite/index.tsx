import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { ROW_CAP, type DbInfo, type Page, type ResultSet, type SchemaObject, type ScriptResult } from './engine'
import { ResultGrid } from './ResultGrid'
import { createSqliteRunner, QUERY_TIMEOUT_MS, SqliteTimeoutError, type SqliteRunner } from './runner'
import { Schema } from './Schema'
import { fileStem, formatBytes, nextSort, parseHeader, quoteIdent, rejectReason, toCsv, toJson, type Cell, type FileHeader, type Sort } from './sql'
import './sqlite.css'

const PAGE_SIZE = 100
const ACCEPT = '.db,.sqlite,.sqlite3,.db3,.s3db,.sl3,application/vnd.sqlite3,application/x-sqlite3'

const EMPTY_SQL = `CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO notes (title, body) VALUES
  ('Hello', 'This database lives only in this tab'),
  ('NULL vs ''NULL''', NULL),
  ('The string', 'NULL');
SELECT * FROM notes;`

interface Opened {
  name: string
  /** null for a new empty database. */
  size: number | null
  header: FileHeader | null
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function SqliteTool() {
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const runnerRef = useRef<SqliteRunner | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [opened, setOpened] = useState<Opened | null>(null)
  const [opening, setOpening] = useState(false)
  const [info, setInfo] = useState<DbInfo | null>(null)
  const [schema, setSchema] = useState<SchemaObject[]>([])
  const [counts, setCounts] = useState<Record<string, number | null | undefined>>({})
  const [tab, setTab] = useState<'browse' | 'sql'>('sql')
  const [table, setTable] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort | null>(null)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<Page | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [sql, setSql] = useState('')
  const [script, setScript] = useState<ScriptResult | null>(null)
  const [running, setRunning] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Bumped whenever the data may have changed, so the browser refetches its page. */
  const [generation, setGeneration] = useState(0)
  const countRun = useRef(0)

  useEffect(() => {
    const runner = createSqliteRunner(
      () => new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' }),
    )
    runnerRef.current = runner
    return () => {
      runnerRef.current = null
      runner.dispose()
    }
  }, [])

  /** Re-reads the schema, then counts each table's rows one by one in the background. */
  const refresh = useCallback(async () => {
    const runner = runnerRef.current
    if (!runner) return
    const objects = await runner.call('schema', {})
    setSchema(objects)
    setInfo(await runner.call('info', {}))
    setGeneration((g) => g + 1)
    const run = ++countRun.current
    setCounts({})
    for (const object of objects) {
      if (object.type !== 'table') continue
      let count: number | null
      try {
        count = await runner.call('count', { table: object.name })
      } catch (error) {
        if (error instanceof SqliteTimeoutError) throw error
        count = null
      }
      if (run !== countRun.current) return
      setCounts((prev) => ({ ...prev, [object.name]: count }))
    }
  }, [])

  const report = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(message)
      if (error instanceof SqliteTimeoutError) {
        // The runner reopens the original bytes on the next call; re-read what that database holds.
        setDirty(false)
        void refresh().catch((e) => setNotice(e instanceof Error ? e.message : String(e)))
      }
    },
    [refresh],
  )

  const openBytes = useCallback(
    async (name: string, bytes: Uint8Array | null) => {
      const runner = runnerRef.current
      if (!runner) return
      if (bytes) {
        const reason = rejectReason(bytes)
        if (reason) {
          setNotice(`${name}: ${reason}`)
          return
        }
      }
      setOpening(true)
      setNotice(null)
      try {
        await runner.open(bytes)
        countRun.current++
        setOpened({ name, size: bytes ? bytes.length : null, header: bytes ? parseHeader(bytes) : null })
        setDirty(false)
        setScript(null)
        setTable(null)
        setPage(null)
        setSort(null)
        setOffset(0)
        setSchema([])
        const objects = await runner.call('schema', {})
        const first = objects.find((o) => o.type === 'table') ?? objects.find((o) => o.type === 'view')
        setSql(bytes ? (first ? `SELECT * FROM ${quoteIdent(first.name)} LIMIT 100;` : 'SELECT * FROM sqlite_master;') : EMPTY_SQL)
        if (first && bytes) {
          setTable(first.name)
          setTab('browse')
        } else {
          setTab('sql')
        }
        await refresh()
      } catch (error) {
        setOpened(null)
        setNotice(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setOpening(false)
      }
    },
    [refresh],
  )

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      // Read into memory here; the bytes go to a worker in this tab, never over the network.
      const bytes = new Uint8Array(await file.arrayBuffer())
      await openBytes(file.name, bytes)
    },
    [openBytes],
  )

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    void openFile(event.target.files?.[0])
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFile(event.dataTransfer.files?.[0])
  }

  // ---- browse ------------------------------------------------------------

  const selectTable = (name: string) => {
    setTab('browse')
    if (name !== table) {
      setTable(name)
      setSort(null)
      setOffset(0)
      setPage(null)
    }
  }

  const browsed = schema.find((o) => o.name === table && (o.type === 'table' || o.type === 'view'))

  useEffect(() => {
    const runner = runnerRef.current
    if (!runner || !opened || !table || !browsed) return
    let live = true
    setPageError(null)
    const fetchPage = async () => {
      const knownTotal = counts[table]
      const rows = typeof knownTotal === 'number' ? knownTotal : await runner.call('count', { table })
      const next = await runner.call('page', { table, limit: PAGE_SIZE, offset, sort })
      if (!live) return
      setTotal(rows)
      setPage(next)
    }
    fetchPage().catch((error) => {
      if (!live) return
      if (error instanceof SqliteTimeoutError) report(error)
      else setPageError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      live = false
    }
    // counts is read, not tracked: a count landing mid-browse shouldn't refetch the page.
  }, [opened, table, browsed?.name, offset, sort, generation, report])

  useEffect(() => {
    // The browsed table was dropped or renamed by a statement.
    if (table && schema.length > 0 && !browsed) {
      setTable(null)
      setPage(null)
    }
  }, [schema, table, browsed])

  // ---- sql ---------------------------------------------------------------

  const editor = useRef<HTMLTextAreaElement>(null)

  const runSql = async () => {
    const runner = runnerRef.current
    if (!runner || running) return
    const el = editor.current
    const selection = el && el.selectionStart !== el.selectionEnd ? sql.slice(el.selectionStart, el.selectionEnd) : ''
    const text = selection.trim() ? selection : sql
    if (!text.trim()) return
    setRunning(true)
    setNotice(null)
    try {
      const result = await runner.call('exec', { sql: text })
      setScript(result)
      if (result.changed) {
        setDirty(true)
        await refresh()
      }
    } catch (error) {
      setScript(null)
      report(error)
    } finally {
      setRunning(false)
    }
  }

  const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void runSql()
    }
  }

  // ---- export ------------------------------------------------------------

  const stem = opened && opened.size !== null ? fileStem(opened.name) : 'database'

  const exportDb = async () => {
    const runner = runnerRef.current
    if (!runner) return
    try {
      const bytes = await runner.call('export', {})
      const name = dirty && opened?.size !== null ? `${stem}-edited.sqlite` : `${stem}.sqlite`
      download(bytes as Uint8Array<ArrayBuffer>, name, 'application/vnd.sqlite3')
      showToast(`Saved ${name} · ${formatBytes(bytes.length)}`)
    } catch (error) {
      report(error)
    }
  }

  const close = () => {
    countRun.current++
    setOpened(null)
    setInfo(null)
    setSchema([])
    setCounts({})
    setTable(null)
    setPage(null)
    setScript(null)
    setDirty(false)
    setNotice(null)
  }

  const exportBar = (columns: string[], rows: Cell[][], name: string) => (
    <span className="sqlite-export">
      <button type="button" onClick={() => void copy(toCsv(columns, rows), 'CSV')} title="Copy as CSV">Copy CSV</button>
      <button type="button" onClick={() => void copy(toJson(columns, rows), 'JSON')} title="Copy as JSON">Copy JSON</button>
      <button type="button" onClick={() => download(toCsv(columns, rows), `${name}.csv`, 'text/csv')} title="Download CSV">
        <span className="material-symbols-outlined" aria-hidden>download</span>CSV
      </button>
      <button type="button" onClick={() => download(toJson(columns, rows), `${name}.json`, 'application/json')} title="Download JSON">
        <span className="material-symbols-outlined" aria-hidden>download</span>JSON
      </button>
    </span>
  )

  const resultBlock = (result: ResultSet, i: number) => (
    <section key={i} className="sqlite-result" aria-label={`Statement ${i + 1}`}>
      <header>
        <code className="sqlite-result-sql" title={result.sql}>{result.sql}</code>
        <span className="sqlite-meta">
          {result.rowsModified === null
            ? `${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? '' : 's'}`
            : `${result.rowsModified.toLocaleString()} row${result.rowsModified === 1 ? '' : 's'} affected`}
          {' · '}
          {result.elapsedMs.toFixed(1)} ms
        </span>
        {result.columns.length > 0 && exportBar(result.columns, result.rows, `${stem}-result-${i + 1}`)}
      </header>
      {result.truncated && (
        <p className="sqlite-truncated">
          Only the first {ROW_CAP.toLocaleString()} rows are kept — add a LIMIT or narrow the query. Exports contain these rows only.
        </p>
      )}
      {result.columns.length > 0 && <ResultGrid columns={result.columns} rows={result.rows} />}
    </section>
  )

  // ---- render ------------------------------------------------------------

  const header = opened?.header
  const pageCount = total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageIndex = Math.floor(offset / PAGE_SIZE)

  return (
    <div
      className={`sqlite-app${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={onDrop}
    >
      <ToolHeader
        brand={<><span className="tool-mark-accent">SQL</span> SQLite viewer</>}
        localLabel="local database"
      >
        <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={onPick} />
        <button type="button" onClick={() => fileInput.current?.click()} title="Open a SQLite file">
          <span className="material-symbols-outlined" aria-hidden>folder_open</span>
          <span className="sqlite-btn-label">Open</span>
        </button>
        {opened && (
          <>
            <button type="button" onClick={() => void exportDb()} title="Download this in-browser copy as a .sqlite file">
              <span className="material-symbols-outlined" aria-hidden>download</span>
              <span className="sqlite-btn-label">Export .sqlite</span>
            </button>
            <button type="button" onClick={close} aria-label="Close database" title="Close database">
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
          </>
        )}
      </ToolHeader>

      {notice && (
        <div className="sqlite-notice" role="alert">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </div>
      )}

      {!opened ? (
        <main id="main-content" className="sqlite-start">
          <div className="sqlite-drop">
            <span className="material-symbols-outlined sqlite-drop-icon" aria-hidden>database</span>
            <h2>Open a SQLite database</h2>
            <p>Drop a <code>.db</code>, <code>.sqlite</code> or <code>.sqlite3</code> file here, or pick one. It is read in this tab by SQLite compiled to WebAssembly — nothing is uploaded.</p>
            <div className="sqlite-start-actions">
              <button type="button" className="sqlite-primary" onClick={() => fileInput.current?.click()} disabled={opening}>
                {opening ? 'Opening…' : 'Choose file'}
              </button>
              <button type="button" onClick={() => void openBytes('New database', null)} disabled={opening}>
                New empty database
              </button>
            </div>
            <p className="sqlite-fine">Edits only ever change the copy in this tab; the original file is never written. Export a <code>.sqlite</code> file to keep them.</p>
          </div>
        </main>
      ) : (
        <div className="sqlite-body">
          <aside className="sqlite-side" aria-label="Schema">
            <div className="sqlite-file">
              <strong title={opened.name}>{opened.name}</strong>
              <span>{opened.size === null ? 'in memory' : formatBytes(opened.size)}</span>
            </div>
            <Schema schema={schema} counts={counts} selected={tab === 'browse' ? table : null} onSelect={selectTable} />
          </aside>

          <main id="main-content" className="sqlite-main">
            <dl className="sqlite-info">
              {info && (
                <>
                  <div><dt>Page size</dt><dd>{info.pageSize.toLocaleString()} B</dd></div>
                  <div><dt>Pages</dt><dd>{info.pageCount.toLocaleString()}</dd></div>
                  <div><dt>Encoding</dt><dd>{info.encoding}</dd></div>
                  <div><dt>Journal</dt><dd>{info.journalMode}{header?.writeVersion === 2 ? ' (WAL in header)' : ''}</dd></div>
                  {header && <div><dt>Written by</dt><dd>SQLite {header.version}</dd></div>}
                  {info.userVersion !== 0 && <div><dt>user_version</dt><dd>{info.userVersion}</dd></div>}
                  <div><dt>Engine</dt><dd>SQLite {info.engineVersion} (wasm)</dd></div>
                </>
              )}
            </dl>
            <p className={`sqlite-copy-note${dirty ? ' is-dirty' : ''}`}>
              <span className="material-symbols-outlined" aria-hidden>{dirty ? 'edit_note' : 'lock'}</span>
              {dirty
                ? 'Edited — changes live only in this tab. Export .sqlite to keep them; the original file is untouched.'
                : opened.size === null
                  ? 'New in-memory database — it disappears when you close the tab unless you export it.'
                  : 'Working on an in-browser copy — statements never change the original file.'}
            </p>

            <div className="sqlite-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'browse'} className={tab === 'browse' ? 'on' : ''} onClick={() => setTab('browse')}>
                Browse{table ? `: ${table}` : ''}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'sql'} className={tab === 'sql' ? 'on' : ''} onClick={() => setTab('sql')}>
                SQL
              </button>
            </div>

            {tab === 'browse' ? (
              <section className="sqlite-panel" aria-label="Table data">
                {!table || !browsed ? (
                  <p className="sqlite-empty">Pick a table or view in the schema list.</p>
                ) : (
                  <>
                    <header className="sqlite-pager">
                      <button type="button" onClick={() => setOffset(0)} disabled={pageIndex === 0} aria-label="First page">
                        <span className="material-symbols-outlined" aria-hidden>first_page</span>
                      </button>
                      <button type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={pageIndex === 0} aria-label="Previous page">
                        <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
                      </button>
                      <span className="sqlite-meta">
                        {total === null
                          ? '…'
                          : total === 0
                            ? 'no rows'
                            : `rows ${(offset + 1).toLocaleString()}–${Math.min(offset + PAGE_SIZE, total).toLocaleString()} of ${total.toLocaleString()}`}
                      </span>
                      <button type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={pageIndex >= pageCount - 1} aria-label="Next page">
                        <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
                      </button>
                      <button type="button" onClick={() => setOffset((pageCount - 1) * PAGE_SIZE)} disabled={pageIndex >= pageCount - 1} aria-label="Last page">
                        <span className="material-symbols-outlined" aria-hidden>last_page</span>
                      </button>
                      {sort && <span className="sqlite-meta">sorted by {sort.column} {sort.dir === 'asc' ? '↑' : '↓'}</span>}
                      {page && <span className="sqlite-meta">{page.elapsedMs.toFixed(1)} ms</span>}
                      {page && exportBar(page.columns, page.rows, `${fileStem(table)}-page-${pageIndex + 1}`)}
                    </header>
                    {pageError ? (
                      <p className="sqlite-error" role="alert">{pageError}</p>
                    ) : page ? (
                      page.columns.length > 0 && (
                        <ResultGrid
                          key={`${table}:${offset}`}
                          columns={page.columns}
                          rows={page.rows}
                          firstRow={offset + 1}
                          sort={sort}
                          onSort={(column) => {
                            setSort(nextSort(sort, column))
                            setOffset(0)
                          }}
                        />
                      )
                    ) : (
                      <p className="sqlite-empty">Loading…</p>
                    )}
                  </>
                )}
              </section>
            ) : (
              <section className="sqlite-panel" aria-label="SQL editor">
                <div className="sqlite-editor">
                  <textarea
                    ref={editor}
                    value={sql}
                    onChange={(event) => setSql(event.target.value)}
                    onKeyDown={onEditorKey}
                    spellCheck={false}
                    aria-label="SQL statements"
                    placeholder="SELECT * FROM …;  — several statements run in order"
                  />
                  <div className="sqlite-editor-bar">
                    <button type="button" className="sqlite-primary" onClick={() => void runSql()} disabled={running}>
                      {running ? 'Running…' : 'Run'} <kbd>{isMac ? '⌘' : 'Ctrl'}↵</kbd>
                    </button>
                    <span className="sqlite-meta">
                      Runs the selection if there is one. Each statement keeps up to {ROW_CAP.toLocaleString()} rows; a batch is stopped after {QUERY_TIMEOUT_MS / 1000} s.
                    </span>
                  </div>
                </div>
                <div className="sqlite-results">
                  {script && (
                    <>
                      <p className="sqlite-meta sqlite-summary">
                        {script.results.length} statement{script.results.length === 1 ? '' : 's'} · {script.elapsedMs.toFixed(1)} ms
                      </p>
                      {script.results.map(resultBlock)}
                      {script.error && (
                        <div className="sqlite-error" role="alert">
                          <strong>{script.error.message}</strong>
                          {script.error.sql && <code>{script.error.sql}</code>}
                          {script.results.length > 0 && <span>Statements before this one were applied.</span>}
                        </div>
                      )}
                      {script.results.length === 0 && !script.error && <p className="sqlite-empty">Nothing to run — only comments or whitespace.</p>}
                    </>
                  )}
                </div>
              </section>
            )}
          </main>
        </div>
      )}

      {dragging && <div className="sqlite-dropveil">Drop a SQLite file</div>}
      <Toast message={toast} />
    </div>
  )
}
