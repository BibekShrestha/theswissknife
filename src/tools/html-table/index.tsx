import { useDeferredValue, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { extractTables, type ExtractOptions } from './extract'
import { cleanGrid, FILE_META, serialize, type Format, type Grid } from './serialize'
import './html-table.css'

const SAMPLE = `<table>
  <caption>Q1 shipping rates</caption>
  <thead>
    <tr>
      <th rowspan="2">Carrier</th>
      <th colspan="2">Domestic</th>
      <th colspan="2">International</th>
    </tr>
    <tr><th>Ground</th><th>Air</th><th>Ground</th><th>Air</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://example.com/acme">Acme Freight</a></td>
      <td>4.50</td><td>11.00</td><td>18.25</td><td>42.00</td>
    </tr>
    <tr>
      <td><a href="https://example.com/borealis">Borealis Post</a></td>
      <td>5.20</td><td>9.75</td><td>21.00</td><td>38.50</td>
    </tr>
    <tr>
      <td><a href="https://example.com/cygnus">Cygnus Air</a></td>
      <td></td><td>14.00</td><td></td><td>29.95</td>
    </tr>
  </tbody>
</table>`

const PREVIEW_ROWS = 200
const PREVIEW_COLS = 40

const FORMATS: [Format, string][] = [
  ['csv', 'CSV'],
  ['tsv', 'TSV'],
  ['json', 'JSON'],
  ['json-rows', 'JSON rows'],
  ['markdown', 'Markdown'],
]

type HeaderMode = 'auto' | '0' | '1' | '2' | '3'

export default function HtmlTableTool() {
  const [html, setHtml] = useState('')
  const [picked, setPicked] = useState(0)
  const [collapseWhitespace, setCollapseWhitespace] = useState(true)
  const [links, setLinks] = useState<ExtractOptions['links']>('text')
  const [dropEmptyRows, setDropEmptyRows] = useState(true)
  const [dropEmptyCols, setDropEmptyCols] = useState(true)
  const [headerMode, setHeaderMode] = useState<HeaderMode>('auto')
  const [format, setFormat] = useState<Format>('csv')
  const [delimiter, setDelimiter] = useState(',')
  const [inferTypes, setInferTypes] = useState(true)
  const [view, setView] = useState<'text' | 'grid'>('text')

  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Parsing a whole page on every keystroke would stutter; deferring keeps
  // typing smooth and lets React drop superseded work.
  const deferredHtml = useDeferredValue(html)

  const tables = useMemo(() => {
    try {
      return extractTables(deferredHtml, { collapseWhitespace, links })
    } catch {
      return []
    }
  }, [deferredHtml, collapseWhitespace, links])

  const index = Math.min(picked, Math.max(0, tables.length - 1))
  const table = tables[index]

  const grid = useMemo<Grid>(() => {
    if (!table) return { rows: [], headerRowCount: 0 }
    const headerRowCount =
      headerMode === 'auto' ? table.headerRowCount : Math.min(Number(headerMode), table.rows.length)
    return { rows: table.rows, headerRowCount }
  }, [table, headerMode])

  const cleaned = useMemo(
    () => cleanGrid(grid, { dropEmptyRows, dropEmptyCols }),
    [grid, dropEmptyRows, dropEmptyCols],
  )

  const output = useMemo(
    () => serialize(grid, { format, delimiter, inferTypes, dropEmptyRows, dropEmptyCols }),
    [grid, format, delimiter, inferTypes, dropEmptyRows, dropEmptyCols],
  )

  const download = () => {
    const { ext, mime } = FILE_META[format]
    const blob = new Blob([output], { type: `${mime};charset=utf-8` })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `table-${table?.index ?? 1}.${ext}`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast(`Saved ${a.download}`)
  }

  /**
   * Copying a table in a browser puts real markup on the clipboard as
   * text/html — take that flavour so "copy table → paste here" just works.
   */
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const rich = event.clipboardData.getData('text/html')
    if (!rich) return
    event.preventDefault()
    const el = sourceRef.current
    const start = el?.selectionStart ?? html.length
    const end = el?.selectionEnd ?? html.length
    setHtml(html.slice(0, start) + rich + html.slice(end))
    setPicked(0)
    showToast('Pasted rich HTML from the clipboard')
  }

  const openFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((text) => {
      setHtml(text)
      setPicked(0)
    })
  }

  const previewRows = cleaned.rows.slice(0, PREVIEW_ROWS)
  const width = cleaned.rows[0]?.length ?? 0
  const truncated = cleaned.rows.length > PREVIEW_ROWS || width > PREVIEW_COLS
  const dataRows = Math.max(0, cleaned.rows.length - cleaned.headerRowCount)

  return (
    <div className="htable-app">
      <ToolHeader
        brand={
          <>
            <span className="tool-mark-accent">▦</span> Table extractor
          </>
        }
        localLabel="local HTML parsing"
      >
        <button
          onClick={() => {
            setHtml(SAMPLE)
            setPicked(0)
          }}
          aria-label="Load sample table"
          title="Load a sample table"
        >
          <span className="material-symbols-outlined">auto_fix_high</span>
        </button>
        <button onClick={() => fileRef.current?.click()} aria-label="Open an HTML file" title="Open an .html file">
          <span className="material-symbols-outlined">folder_open</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,text/html"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            openFile(file)
          }}
        />
      </ToolHeader>

      <main id="main-content" className="htable-main">
        <section className="htable-panes">
          <article className="htable-pane">
            <header>
              <div>
                <span className="htable-step">01</span>
                <strong>HTML source</strong>
              </div>
              <span>{html.length.toLocaleString()} chars</span>
              <button onClick={() => setHtml('')} disabled={!html} aria-label="Clear source">
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            <textarea
              ref={sourceRef}
              className="htable-source mono"
              value={html}
              onChange={(event) => setHtml(event.target.value)}
              onPaste={onPaste}
              spellCheck={false}
              aria-label="HTML source"
              placeholder={
                'Paste a page or a fragment — or copy a table in your browser and paste it straight in.\n\n<table>…</table>'
              }
            />
            <footer className="htable-tables">
              <span className="htable-tables-label">
                Tables{tables.length > 0 && <span className="htable-count"> {tables.length}</span>}
              </span>
              {tables.length === 0 ? (
                <span className="htable-hint">
                  {html.trim() ? 'no <table> elements found' : 'nothing parsed yet'}
                </span>
              ) : (
                <ul>
                  {tables.map((item, i) => (
                    <li key={item.index}>
                      <button
                        className={i === index ? 'on' : ''}
                        aria-pressed={i === index}
                        onClick={() => setPicked(i)}
                        title={item.caption || undefined}
                      >
                        <span className="htable-dim">
                          {item.rows.length}×{item.rows[0]?.length ?? 0}
                        </span>
                        <span className="htable-label">
                          {item.caption ||
                            item.rows[0]?.filter(Boolean).slice(0, 2).join(' · ') ||
                            'empty'}
                        </span>
                        {item.nested && <span className="htable-tag">nested</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </footer>
          </article>

          <article className="htable-pane">
            <header>
              <div>
                <span className="htable-step">02</span>
                <strong>Extracted</strong>
              </div>
              <span>
                {table
                  ? `${dataRows.toLocaleString()} rows × ${width} cols${
                      cleaned.headerRowCount > 0 ? ` · ${cleaned.headerRowCount} header` : ''
                    }`
                  : '—'}
              </span>
              <button onClick={() => void copy(output, 'Output')} disabled={!output} aria-label="Copy output">
                <span className="material-symbols-outlined">content_copy</span>
              </button>
              <button onClick={download} disabled={!output} aria-label="Download output">
                <span className="material-symbols-outlined">download</span>
              </button>
            </header>

            <div className="htable-controls">
              <div className="htable-formats" role="group" aria-label="Output format">
                {FORMATS.map(([value, label]) => (
                  <button
                    key={value}
                    className={format === value ? 'on' : ''}
                    aria-pressed={format === value}
                    onClick={() => setFormat(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="htable-view" role="group" aria-label="Result view">
                <button className={view === 'text' ? 'on' : ''} aria-pressed={view === 'text'} onClick={() => setView('text')}>
                  Text
                </button>
                <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
                  Grid
                </button>
              </div>

              <div className="htable-opts">
                {format === 'csv' && (
                  <label>
                    <span>Separator</span>
                    <select value={delimiter} onChange={(event) => setDelimiter(event.target.value)}>
                      <option value=",">,</option>
                      <option value=";">;</option>
                      <option value="|">|</option>
                    </select>
                  </label>
                )}
                <label>
                  <span>Header rows</span>
                  <select value={headerMode} onChange={(event) => setHeaderMode(event.target.value as HeaderMode)}>
                    <option value="auto">Auto{table ? ` (${table.headerRowCount})` : ''}</option>
                    <option value="0">None</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </label>
                <label>
                  <span>Links</span>
                  <select value={links} onChange={(event) => setLinks(event.target.value as ExtractOptions['links'])}>
                    <option value="text">Text</option>
                    <option value="url">URL</option>
                    <option value="both">Text + URL</option>
                  </select>
                </label>
                <label className="htable-check" title="Squash whitespace runs and &nbsp; into single spaces">
                  <input type="checkbox" checked={collapseWhitespace} onChange={(event) => setCollapseWhitespace(event.target.checked)} />
                  <span>Tidy space</span>
                </label>
                <label className="htable-check" title="Drop rows where every cell is empty">
                  <input type="checkbox" checked={dropEmptyRows} onChange={(event) => setDropEmptyRows(event.target.checked)} />
                  <span>Drop empty rows</span>
                </label>
                <label className="htable-check" title="Drop columns where every cell is empty">
                  <input type="checkbox" checked={dropEmptyCols} onChange={(event) => setDropEmptyCols(event.target.checked)} />
                  <span>cols</span>
                </label>
                {(format === 'json' || format === 'json-rows') && (
                  <label className="htable-check" title="Turn plain numbers, true/false and blanks into JSON scalars">
                    <input type="checkbox" checked={inferTypes} onChange={(event) => setInferTypes(event.target.checked)} />
                    <span>Infer types</span>
                  </label>
                )}
              </div>
            </div>

            {!table ? (
              <p className="htable-empty">Paste HTML with a table to see it extracted here.</p>
            ) : view === 'text' ? (
              <textarea
                className="htable-output mono"
                value={output}
                readOnly
                spellCheck={false}
                aria-label="Extracted output"
                placeholder="Extracted rows appear here"
              />
            ) : (
              <div className="htable-gridwrap">
                <table className="htable-preview">
                  {cleaned.headerRowCount > 0 && (
                    <thead>
                      {previewRows.slice(0, cleaned.headerRowCount).map((row, r) => (
                        <tr key={r}>
                          {row.slice(0, PREVIEW_COLS).map((value, c) => (
                            <th key={c} scope="col">
                              {value}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                  )}
                  <tbody>
                    {previewRows.slice(cleaned.headerRowCount).map((row, r) => (
                      <tr key={r}>
                        {row.slice(0, PREVIEW_COLS).map((value, c) => (
                          <td key={c}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {truncated && (
                  <p className="htable-hint">
                    preview capped at {PREVIEW_ROWS} rows × {PREVIEW_COLS} columns — text and
                    download hold everything
                  </p>
                )}
              </div>
            )}
          </article>
        </section>
      </main>

      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
