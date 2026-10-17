import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import type { DiffError, DiffMode, DiffResult, Segment } from './compute'
import { unifiedPatch } from './patch'
import { buildRows, type Row } from './rows'
import { createDiffRunner } from './runner'
import './diff.css'

const SAMPLE_A = `{
  "name": "swiss-knife",
  "version": "1.4.0",
  "tools": ["jq", "jwt", "regex"],
  "offline": false
}
`
const SAMPLE_B = `{
  "name": "swiss-knife",
  "version": "1.5.0",
  "tools": ["jq", "jwt", "regex", "diff"],
  "offline": true
}
`
const CONTEXT = 3
const PAGE = 3000

type Layout = 'split' | 'unified'

export default function DiffTool() {
  const [left, setLeft] = useState(SAMPLE_A)
  const [right, setRight] = useState(SAMPLE_B)
  const [names, setNames] = useState<[string, string]>(['original', 'changed'])
  const [mode, setMode] = useState<DiffMode>('text')
  const [layout, setLayout] = useState<Layout>('split')
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [result, setResult] = useState<DiffResult | DiffError | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [limit, setLimit] = useState(PAGE)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const runnerRef = useRef<ReturnType<typeof createDiffRunner>>(null)

  useEffect(() => {
    const runner = createDiffRunner(() => new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' }))
    runnerRef.current = runner
    return () => runner.dispose()
  }, [])

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      setRunning(true)
      void runnerRef.current?.run({ left, right, options: { mode, ignoreWhitespace, ignoreCase } }).then((reply) => {
        if (!live) return
        setResult(reply.result)
        setElapsed(reply.elapsedMs)
        setExpanded(new Set())
        setLimit(PAGE)
        setRunning(false)
      })
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [left, right, mode, ignoreWhitespace, ignoreCase])

  const diff = result && !('error' in result) ? result : null
  const rows = useMemo(() => (diff ? buildRows(diff, CONTEXT, expanded, layout) : []), [diff, expanded, layout])
  const patch = useMemo(() => (diff ? unifiedPatch(diff, names[0], names[1]) : ''), [diff, names])
  const identical = diff && diff.added === 0 && diff.removed === 0

  const swap = () => {
    setLeft(right)
    setRight(left)
    setNames([names[1], names[0]])
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([patch], { type: 'text/x-diff' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'changes.diff' })
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="diff-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">difference</span> Diff</>}
        localLabel="local comparison"
      >
        <button onClick={swap} aria-label="Swap sides" title="Swap original and changed"><span className="material-symbols-outlined">swap_horiz</span></button>
        <button onClick={() => { setLeft(SAMPLE_A); setRight(SAMPLE_B); setNames(['original', 'changed']) }} aria-label="Reset to sample" title="Reset to sample"><span className="material-symbols-outlined">auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="diff-main">
        <section className="diff-controls" aria-label="Diff settings">
          <Toggle label="Compare as" value={mode} onChange={setMode} options={[['text', 'Text'], ['json', 'JSON']]} />
          <Toggle label="View" value={layout} onChange={setLayout} options={[['split', 'Split'], ['unified', 'Unified']]} />
          {mode === 'text' ? (
            <>
              <label className="diff-check"><input type="checkbox" checked={ignoreWhitespace} onChange={(e) => setIgnoreWhitespace(e.target.checked)} /> Ignore whitespace</label>
              <label className="diff-check"><input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /> Ignore case</label>
            </>
          ) : (
            <p className="diff-hint">Keys are sorted and both sides re-indented, so only values and array order count.</p>
          )}
        </section>

        <section className="diff-inputs">
          <InputPane step="01" title="Original" name={names[0]} value={left} onChange={setLeft} onFile={(text, name) => { setLeft(text); setNames([name, names[1]]) }} onError={showToast} />
          <InputPane step="02" title="Changed" name={names[1]} value={right} onChange={setRight} onFile={(text, name) => { setRight(text); setNames([names[0], name]) }} onError={showToast} />
        </section>

        <section className={`diff-output${result && 'error' in result ? ' has-error' : ''}`} aria-label="Differences">
          <header>
            <div><span className="diff-step">03</span><strong>Differences</strong></div>
            {diff && !identical && <span className="diff-stats"><b className="diff-add">+{diff.added.toLocaleString()}</b> <b className="diff-del">−{diff.removed.toLocaleString()}</b> lines</span>}
            <span className="diff-time">{running ? 'comparing…' : diff ? `${elapsed < 1 ? '<1' : Math.round(elapsed)} ms` : ''}</span>
            <button onClick={() => void copy(patch, 'Patch')} disabled={!patch} title="Copy as a unified diff (diff -u)"><span className="material-symbols-outlined">content_copy</span> Patch</button>
            <button onClick={download} disabled={!patch} aria-label="Download patch" title="Download changes.diff"><span className="material-symbols-outlined">download</span></button>
          </header>
          {result && 'error' in result && <div className="diff-error" role="alert">{result.error}</div>}
          {diff?.notes.map((note) => <div className="diff-note" key={note}>{note}</div>)}
          {identical && <div className="diff-same">No differences{mode === 'json' ? ' — the two documents hold the same data.' : '.'}</div>}
          {diff && !identical && (
            <div className={`diff-grid diff-${layout}`} role="table">
              {rows.slice(0, limit).map((row, i) => (
                <DiffRow key={i} row={row} diff={diff} layout={layout} onExpand={(id) => setExpanded(new Set([...expanded, id]))} />
              ))}
              {rows.length > limit && (
                <button className="diff-more" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit).toLocaleString()} more of {(rows.length - limit).toLocaleString()} rows</button>
              )}
            </div>
          )}
        </section>
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="diff-toggle-wrap">
      <span>{label}</span>
      <div className="diff-toggle" role="group" aria-label={label}>
        {options.map(([id, text]) => <button key={id} className={value === id ? 'on' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
      </div>
    </div>
  )
}

interface InputPaneProps {
  step: string
  title: string
  name: string
  value: string
  onChange: (value: string) => void
  onFile: (text: string, name: string) => void
  onError: (message: string) => void
}

function InputPane({ step, title, name, value, onChange, onFile, onError }: InputPaneProps) {
  const [over, setOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = async (file: File | undefined) => {
    if (!file) return
    try {
      onFile(await file.text(), file.name)
    } catch {
      onError(`Could not read ${file.name}`)
    }
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    void load(event.dataTransfer.files[0])
  }
  const lines = value ? value.split(/\r\n|\r|\n/).length - (/(\r\n|\r|\n)$/.test(value) ? 1 : 0) : 0

  return (
    <article className={`diff-pane${over ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <header>
        <div><span className="diff-step">{step}</span><strong>{title}</strong></div>
        <span title={name}>{name} · {lines.toLocaleString()} lines</span>
        <button onClick={() => fileRef.current?.click()} aria-label={`Open file as ${title.toLowerCase()}`} title="Open a file (or drop one here)"><span className="material-symbols-outlined">folder_open</span></button>
        <button onClick={() => onChange('')} disabled={!value} aria-label={`Clear ${title.toLowerCase()}`}><span className="material-symbols-outlined">close</span></button>
        <input ref={fileRef} type="file" hidden onChange={(e) => { void load(e.target.files?.[0]); e.target.value = '' }} />
      </header>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={`${title} text`} placeholder="Paste text or drop a file" wrap="off" />
    </article>
  )
}

function Line({ text, inline }: { text: string; inline?: Segment[] }): ReactNode {
  if (!inline) return text || '​'
  return inline.map(([part, changed], i) => (changed ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))
}

function DiffRow({ row, diff, layout, onExpand }: { row: Row; diff: DiffResult; layout: Layout; onExpand: (id: number) => void }) {
  if (row.kind === 'fold') {
    return <button className="diff-fold" onClick={() => onExpand(row.id)}><span className="material-symbols-outlined">unfold_more</span> {row.count.toLocaleString()} unchanged lines</button>
  }
  const eol = (side: 'a' | 'b', i: number | null) => (i !== null && diff[side].noEol && i === diff[side].lines.length - 1 && diff.a.noEol !== diff.b.noEol ? <em className="diff-noeol"> no newline at end</em> : null)
  const cellA = row.a === null ? null : <><Line text={diff.a.lines[row.a]} inline={row.kind === 'change' ? diff.inlineA[row.a] : undefined} />{eol('a', row.a)}</>
  const cellB = row.b === null ? null : <><Line text={diff.b.lines[row.b]} inline={row.kind === 'change' ? diff.inlineB[row.b] : undefined} />{eol('b', row.b)}</>

  if (layout === 'split') {
    const tone = (i: number | null, kind: string) => (row.kind === 'equal' ? '' : i === null ? ' is-empty' : ` is-${kind}`)
    return (
      <div className="diff-row" role="row">
        <span className={`diff-num${tone(row.a, 'del')}`}>{row.a === null ? '' : row.a + 1}</span>
        <span className={`diff-code${tone(row.a, 'del')}`}>{cellA}</span>
        <span className={`diff-num${tone(row.b, 'add')}`}>{row.b === null ? '' : row.b + 1}</span>
        <span className={`diff-code${tone(row.b, 'add')}`}>{cellB}</span>
      </div>
    )
  }
  const tone = row.kind === 'equal' ? '' : row.a !== null ? ' is-del' : ' is-add'
  return (
    <div className={`diff-row${tone}`} role="row">
      <span className="diff-num">{row.a === null ? '' : row.a + 1}</span>
      <span className="diff-num">{row.b === null ? '' : row.b + 1}</span>
      <span className="diff-sign">{row.kind === 'equal' ? ' ' : row.a !== null ? '−' : '+'}</span>
      <span className="diff-code">{row.a !== null ? cellA : cellB}</span>
    </div>
  )
}
