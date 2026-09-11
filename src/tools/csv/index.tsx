import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { Grid, type Cursor } from './Grid'
import { decodeBytes, ENCODING_LABELS, type Encoding } from './decode'
import {
  DELIMITERS,
  DELIMITER_LABELS,
  detectDelimiter,
  parseCsv,
  type ParseResult,
} from './parse'
import { FILE_META, serialize, type Format } from './serialize'
import {
  columnName,
  columnTypes,
  buildOrder,
  initialWidths,
  looksLikeHeader,
  measureColumn,
  type Sort,
} from './view'
import './csv.css'

const SAMPLE = `id,name,email,signed_up,plan,mrr,active,notes
1,"Alvarez, Renata",renata@example.com,2024-01-14,pro,49.00,true,"Moved off the legacy plan
on the second attempt"
2,Nikhil Bhatt,nikhil@example.com,2024-02-02,free,0.00,true,
3,"O'Neill, Sam",sam@example.com,2023-11-30,team,199.00,false,"Churned — said ""too many seats"""
4,Wei Chen,wei@example.com,2024-03-19,pro,49.00,true,Referred by #2
5,Amara Okafor,amara@example.com,2022-08-07,team,199.00,true,"Annual, invoiced"
6,Jonas Lindqvist,jonas@example.com,2024-04-01,free,0.00,false,
7,Priya Raman,priya@example.com,2023-05-22,pro,49.00,true,Renewal due
8,Tomás Ferreira,tomas@example.com,2024-05-11,team,199.00,true,"Two seats, one dormant"`

/** Past this, the raw text is shown read-only: a textarea that size locks up. */
const EDITABLE_CHARS = 2_000_000
/** Past this, a browser tab cannot hold the text and the parsed rows at once. */
const MAX_FILE_BYTES = 128 * 1024 * 1024

const EMPTY: ParseResult = { rows: [], width: 0, issues: [], raggedRows: 0 }

/** Where a keystroke or a paste belongs to the reader, not to the tool. */
const TYPING = 'input, textarea, [contenteditable="true"]'

const FORMATS: Format[] = ['csv', 'tsv', 'json', 'json-rows', 'markdown']

const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

interface Origin {
  name: string
  bytes: number
  encoding: Encoding
  fromBom: boolean
}

export default function CsvTool() {
  const [text, setText] = useState('')
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [dragging, setDragging] = useState(false)

  const [delimiterChoice, setDelimiterChoice] = useState('auto')
  const [quote, setQuote] = useState('"')
  const [comment, setComment] = useState('')
  const [skipEmptyLines, setSkipEmptyLines] = useState(true)
  const [trim, setTrim] = useState(false)
  const [headerChoice, setHeaderChoice] = useState<'auto' | 'yes' | 'no'>('auto')
  const [optionsOpen, setOptionsOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [searchColumn, setSearchColumn] = useState(-1)
  const [sort, setSort] = useState<Sort | null>(null)
  const [cursor, setCursor] = useState<Cursor | null>(null)

  const [format, setFormat] = useState<Format>('csv')
  const [inferTypes, setInferTypes] = useState(true)
  const [edits, setEdits] = useState(0)

  const [parsed, setParsed] = useState<ParseResult>(EMPTY)
  const [parsing, setParsing] = useState(false)
  const [parseMs, setParseMs] = useState(0)
  const [widths, setWidths] = useState<number[]>([])

  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Re-parsing a large paste on every keystroke would stutter; deferring keeps
  // typing smooth and lets React drop superseded work.
  const deferredText = useDeferredValue(text)
  const deferredQuery = useDeferredValue(query)

  const detection = useMemo(() => detectDelimiter(deferredText, quote), [deferredText, quote])
  const delimiter = delimiterChoice === 'auto' ? detection.delimiter : delimiterChoice

  useEffect(() => {
    if (!deferredText) {
      setParsed(EMPTY)
      setParseMs(0)
      setParsing(false)
      return
    }
    setParsing(true)
    let cancelled = false
    // One frame with "parsing…" on screen beats a silent freeze on a big file.
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const started = performance.now()
      const result = parseCsv(deferredText, { delimiter, quote, comment, skipEmptyLines, trim })
      setParsed(result)
      setParseMs(performance.now() - started)
      setParsing(false)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [deferredText, delimiter, quote, comment, skipEmptyLines, trim])

  const { rows, width } = parsed
  const autoHeader = useMemo(() => looksLikeHeader(rows, width), [rows, width])
  const hasHeaderRow = headerChoice === 'auto' ? autoHeader : headerChoice === 'yes'
  const bodyStart = hasHeaderRow && rows.length > 0 ? 1 : 0
  const headers = useMemo(
    () => (bodyStart ? Array.from({ length: width }, (_, c) => rows[0][c] ?? '') : null),
    [bodyStart, rows, width],
  )
  const types = useMemo(() => columnTypes(rows, width, bodyStart), [rows, width, bodyStart])

  const order = useMemo(
    () => buildOrder(rows, bodyStart, deferredQuery, { caseSensitive, column: searchColumn }, sort, types),
    [rows, bodyStart, deferredQuery, caseSensitive, searchColumn, sort, types],
  )

  // Widths follow the content. Sorting and searching leave them alone; a
  // re-parse re-measures, since the columns themselves may be different.
  useEffect(() => {
    setWidths(initialWidths(rows, width, bodyStart))
  }, [rows, width, bodyStart])

  useEffect(() => {
    if (searchColumn >= width) setSearchColumn(-1)
  }, [searchColumn, width])

  const hasData = rows.length > 0
  const showSource = !hasData || sourceOpen

  /* ---- loading ------------------------------------------------------- */

  /**
   * New data means every view decision taken about the old data is stale — a
   * search left running over a file that no longer has those words hides
   * everything, and a column scope points at a column that is now something
   * else entirely.
   */
  const load = useCallback((value: string, from: Origin | null) => {
    setText(value)
    setOrigin(from)
    setSort(null)
    setCursor(null)
    setEdits(0)
    setQuery('')
    setSearchColumn(-1)
    setSourceOpen(false)
  }, [])

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      if (file.size > MAX_FILE_BYTES) {
        showToast(`${file.name} is ${formatBytes(file.size)} — larger than a browser tab can hold`)
        return
      }
      const buffer = await file.arrayBuffer()
      const { text: decoded, encoding, fromBom } = decodeBytes(new Uint8Array(buffer))
      load(decoded, { name: file.name, bytes: file.size, encoding, fromBom })
      showToast(`${file.name} · ${formatBytes(file.size)} · ${ENCODING_LABELS[encoding]}`)
    },
    [load, showToast],
  )

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFile(event.dataTransfer.files?.[0])
  }

  // Paste anywhere — copying a block of cells out of a spreadsheet puts tabs
  // on the clipboard, and the delimiter sniffer picks those up on its own.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      // A paste aimed at a field the reader is typing into belongs to that
      // field. The target is not always an Element (document, window).
      const target = event.target
      if (target instanceof Element && target.closest(TYPING)) return
      const pasted = event.clipboardData?.getData('text/plain')
      if (!pasted?.trim()) return
      event.preventDefault()
      load(pasted, null)
      showToast(`Pasted ${formatBytes(new Blob([pasted]).size)} from the clipboard`)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [load, showToast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest(TYPING)) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---- grid callbacks ------------------------------------------------ */

  const onSort = (column: number) =>
    setSort((prev) =>
      prev?.column !== column
        ? { column, direction: 'asc' }
        : prev.direction === 'asc'
          ? { column, direction: 'desc' }
          : null,
    )

  const onResize = (column: number, next: number) =>
    setWidths((prev) => {
      const copyOf = prev.slice()
      copyOf[column] = next
      return copyOf
    })

  const onAutoFit = (column: number) =>
    setWidths((prev) => {
      const copyOf = prev.slice()
      copyOf[column] = measureColumn(rows, bodyStart, column, headers?.[column] ?? columnName(column))
      return copyOf
    })

  const onEdit = (row: number, column: number, value: string) => {
    setParsed((prev) => {
      if ((prev.rows[row]?.[column] ?? '') === value) return prev
      const next = prev.rows.slice()
      const cells = next[row].slice()
      while (cells.length <= column) cells.push('')
      cells[column] = value
      next[row] = cells
      return { ...prev, rows: next, width: Math.max(prev.width, cells.length) }
    })
    setEdits((count) => count + 1)
  }

  /* ---- export -------------------------------------------------------- */

  const buildOutput = () =>
    serialize(
      order.map((index) => rows[index]),
      { format, delimiter, quote: quote || '"', headers, types, inferTypes, width },
    )

  const baseName = (origin?.name ?? 'pasted.csv').replace(/\.[^.]+$/, '') || 'data'

  const download = () => {
    const { ext, mime } = FILE_META[format]
    const blob = new Blob([buildOutput()], { type: `${mime};charset=utf-8` })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${baseName}.${ext}`
    link.click()
    URL.revokeObjectURL(link.href)
    showToast(`Saved ${link.download}`)
  }

  /* ---- derived display ----------------------------------------------- */

  const needle = caseSensitive ? deferredQuery : deferredQuery.toLowerCase()
  const bodyCount = Math.max(0, rows.length - bodyStart)
  const filtered = deferredQuery.trim() !== '' || sort !== null
  const cursorRow = cursor !== null ? rows[order[cursor.index] ?? -1] : undefined
  const cursorValue = cursor && cursorRow ? (cursorRow[cursor.column] ?? '') : ''
  const cursorLabel = cursor
    ? `${headers?.[cursor.column]?.trim() || columnName(cursor.column)} · row ${cursor.index + 1}`
    : ''

  return (
    <div
      className={`csv-app${dragging ? ' dragging' : ''}`}
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
        brand={
          <>
            <span className="tool-mark-accent">▤</span> CSV viewer
          </>
        }
        localLabel="local parsing"
      >
        <button
          className={sourceOpen ? 'on' : ''}
          aria-pressed={sourceOpen}
          onClick={() => setSourceOpen((open) => !open)}
          disabled={!hasData}
          aria-label="Show the pasted text"
          title="Paste or edit the raw CSV"
        >
          <span className="material-symbols-outlined">content_paste</span>
        </button>
        <button onClick={() => load(SAMPLE, null)} aria-label="Load sample CSV" title="Load a sample CSV">
          <span className="material-symbols-outlined">table_view</span>
        </button>
        <button onClick={() => fileRef.current?.click()} aria-label="Open a CSV file" title="Open a .csv or .tsv file">
          <span className="material-symbols-outlined">folder_open</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.tab,.txt,text/csv,text/tab-separated-values,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void openFile(file)
          }}
        />
      </ToolHeader>

      <main id="main-content" className="csv-main">
        {showSource && (
          <section className="csv-source">
            <header>
              <span className="csv-step">01</span>
              <strong>Paste CSV</strong>
              <span className="csv-source-hint">
                or drop a file anywhere — copied spreadsheet cells paste as tabs and are detected
              </span>
              {/* The first load of a large file has no grid to report into yet. */}
              {parsing && <span className="csv-parsing">parsing…</span>}
              {hasData && (
                <button onClick={() => setSourceOpen(false)} aria-label="Close the paste pane">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </header>
            {text.length > EDITABLE_CHARS ? (
              <p className="csv-source-large">
                {origin?.name ?? 'The text'} is {formatBytes(origin?.bytes ?? text.length)} — too large
                to edit here, so it stays in the grid below. Open a smaller file or paste to replace it.
              </p>
            ) : (
              <textarea
                className="csv-textarea mono"
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                  setOrigin(null)
                }}
                spellCheck={false}
                aria-label="CSV text"
                placeholder={'name,role,started\nAda,engineer,2024-01-09\nGrace,compiler,2023-06-21'}
              />
            )}
            <footer>
              <button onClick={() => load(SAMPLE, null)}>Load sample</button>
              <button onClick={() => fileRef.current?.click()}>Open a file…</button>
              <div className="spacer" />
              <button onClick={() => load('', null)} disabled={!text}>
                Clear
              </button>
            </footer>
          </section>
        )}

        {hasData && (
          <>
            <div className="csv-bar">
              <label className="csv-search">
                <span className="material-symbols-outlined" aria-hidden>search</span>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setQuery('')
                  }}
                  placeholder="Search rows"
                  aria-label="Search rows"
                />
                <kbd>/</kbd>
              </label>
              <select
                value={searchColumn}
                onChange={(event) => setSearchColumn(Number(event.target.value))}
                aria-label="Search in column"
                title="Limit the search to one column"
              >
                <option value={-1}>every column</option>
                {Array.from({ length: width }, (_, c) => (
                  <option key={c} value={c}>
                    {headers?.[c]?.trim() || columnName(c)}
                  </option>
                ))}
              </select>

              <span className="csv-count">
                {deferredQuery ? (
                  <>
                    <strong>{order.length.toLocaleString()}</strong> of {bodyCount.toLocaleString()} rows
                  </>
                ) : (
                  <>
                    <strong>{bodyCount.toLocaleString()}</strong> row{bodyCount === 1 ? '' : 's'} ×{' '}
                    {width} col{width === 1 ? '' : 's'}
                  </>
                )}
              </span>

              <div className="spacer" />

              <select
                value={headerChoice}
                onChange={(event) => setHeaderChoice(event.target.value as 'auto' | 'yes' | 'no')}
                aria-label="Header row"
                title="Whether the first row names the columns"
              >
                <option value="auto">Header: auto ({autoHeader ? 'yes' : 'no'})</option>
                <option value="yes">Header: first row</option>
                <option value="no">Header: none</option>
              </select>
              <select
                value={delimiterChoice}
                onChange={(event) => setDelimiterChoice(event.target.value)}
                aria-label="Delimiter"
                title="The character that separates fields"
              >
                <option value="auto">Sep: auto ({DELIMITER_LABELS[detection.delimiter]})</option>
                {DELIMITERS.map((value) => (
                  <option key={value} value={value}>
                    Sep: {DELIMITER_LABELS[value]}
                  </option>
                ))}
              </select>
              <button
                className={optionsOpen ? 'on' : ''}
                aria-pressed={optionsOpen}
                onClick={() => setOptionsOpen((open) => !open)}
                title="Parsing options"
              >
                <span className="material-symbols-outlined">tune</span>
              </button>

              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as Format)}
                aria-label="Export format"
              >
                {FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {FILE_META[value].label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void copy(buildOutput(), FILE_META[format].label)}
                aria-label="Copy the rows on screen"
                title="Copy what is on screen — sort order, search and edits included"
              >
                <span className="material-symbols-outlined">content_copy</span>
              </button>
              <button onClick={download} aria-label="Download the rows on screen" title="Download">
                <span className="material-symbols-outlined">download</span>
              </button>
            </div>

            {optionsOpen && (
              <div className="csv-options">
                <label>
                  <span>Quote</span>
                  <select value={quote} onChange={(event) => setQuote(event.target.value)}>
                    <option value={'"'}>double "</option>
                    <option value={"'"}>single '</option>
                    <option value="">none</option>
                  </select>
                </label>
                <label>
                  <span>Comments</span>
                  <select value={comment} onChange={(event) => setComment(event.target.value)}>
                    <option value="">keep every line</option>
                    <option value="#">skip # lines</option>
                    <option value="//">skip // lines</option>
                  </select>
                </label>
                <label className="csv-check">
                  <input type="checkbox" checked={skipEmptyLines} onChange={(event) => setSkipEmptyLines(event.target.checked)} />
                  <span>Skip blank lines</span>
                </label>
                <label className="csv-check">
                  <input type="checkbox" checked={trim} onChange={(event) => setTrim(event.target.checked)} />
                  <span>Trim fields</span>
                </label>
                <label className="csv-check">
                  <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
                  <span>Case-sensitive search</span>
                </label>
                {(format === 'json' || format === 'json-rows') && (
                  <label className="csv-check" title="Write numbers, true/false and blanks as JSON scalars">
                    <input type="checkbox" checked={inferTypes} onChange={(event) => setInferTypes(event.target.checked)} />
                    <span>Infer JSON types</span>
                  </label>
                )}
                <span className="csv-options-note">
                  {origin
                    ? `${origin.name} · ${formatBytes(origin.bytes)} · ${ENCODING_LABELS[origin.encoding]}${origin.fromBom ? ' (BOM)' : ' (detected)'}`
                    : `pasted · ${text.length.toLocaleString()} chars`}
                  {` · parsed in ${parseMs < 1 ? '<1' : Math.round(parseMs)} ms`}
                </span>
              </div>
            )}

            {(parsed.raggedRows > 0 || parsed.issues.some((issue) => issue.kind === 'unterminated-quote') || !detection.found || detection.alternatives.length > 0) && (
              <div className="csv-issues" role="status">
                <span className="material-symbols-outlined" aria-hidden>report</span>
                <div>
                  {!detection.found && (
                    <p>
                      No separator found — nothing split this into more than one column, so it is
                      shown as a single column. Pick one above if you know better.
                    </p>
                  )}
                  {detection.alternatives.length > 0 && (
                    <p>
                      <strong>{DELIMITER_LABELS[detection.delimiter]}</strong> and{' '}
                      {detection.alternatives.map((value) => DELIMITER_LABELS[value]).join(', ')} split
                      this file equally well — check the columns, and switch separator if this is wrong.
                    </p>
                  )}
                  {parsed.issues
                    .filter((issue) => issue.kind === 'unterminated-quote')
                    .slice(0, 1)
                    .map((issue) => (
                      <p key={issue.row}>
                        Row {issue.row + 1}: {issue.detail}.
                      </p>
                    ))}
                  {parsed.raggedRows > 0 && (
                    <p>
                      <strong>{parsed.raggedRows.toLocaleString()}</strong>{' '}
                      {parsed.raggedRows === 1 ? 'row does' : 'rows do'} not have{' '}
                      {rows[0]?.length ?? 0} fields — first at row{' '}
                      {(parsed.issues.find((issue) => issue.kind === 'ragged')?.row ?? 0) + 1}. Their
                      extra columns are still shown, and short rows are padded.
                    </p>
                  )}
                </div>
              </div>
            )}

            <Grid
              rows={rows}
              order={order}
              width={width}
              headers={headers}
              types={types}
              widths={widths}
              sort={sort}
              needle={needle}
              caseSensitive={caseSensitive}
              cursor={cursor}
              editable
              onSort={onSort}
              onResize={onResize}
              onAutoFit={onAutoFit}
              onCursor={setCursor}
              onEdit={onEdit}
            />

            <footer className="csv-foot">
              {cursor ? (
                <>
                  <span className="csv-foot-label">{cursorLabel}</span>
                  <code className="csv-foot-value">{cursorValue || <em>empty</em>}</code>
                  <span className="csv-foot-meta">
                    {types[cursor.column]} · {cursorValue.length} chars
                  </span>
                  <button onClick={() => void copy(cursorValue, 'Cell')} disabled={!cursorValue}>
                    Copy cell
                  </button>
                </>
              ) : (
                <span className="csv-foot-label">
                  Click a cell to inspect it · double-click to edit · drag a header edge to resize
                </span>
              )}
              <div className="spacer" />
              {edits > 0 && <span className="csv-foot-edits">{edits} edit{edits === 1 ? '' : 's'}</span>}
              {parsing && <span className="csv-foot-meta">parsing…</span>}
              {filtered && <span className="csv-foot-meta">export follows this view</span>}
            </footer>
          </>
        )}
      </main>

      {dragging && <div className="csv-dropveil">Drop a CSV, TSV or text file</div>}
      {toast && (
        <div className="shell-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
