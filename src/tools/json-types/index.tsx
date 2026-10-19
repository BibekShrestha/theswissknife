import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import type { InferOptions, InferResult, Target } from './engine'
import type { PythonFlavor } from './emit/python'
import type { TsOptions } from './emit/typescript'
import { MAX_DEPTH } from './infer'
import { createInferRunner, type RunOutcome } from './runner'
import { SAMPLE } from './sample'
import './json-types.css'


const targets: { id: Target; label: string; ext: string; mime: string }[] = [
  { id: 'typescript', label: 'TypeScript', ext: 'ts', mime: 'text/typescript' },
  { id: 'zod', label: 'Zod', ext: 'zod.ts', mime: 'text/typescript' },
  { id: 'jsonschema', label: 'JSON Schema', ext: 'schema.json', mime: 'application/schema+json' },
  { id: 'go', label: 'Go', ext: 'go', mime: 'text/x-go' },
  { id: 'python', label: 'Python', ext: 'py', mime: 'text/x-python' },
]

/** Longest output shown in the page; copy and download always carry all of it. */
const PREVIEW_LIMIT = 200_000

const layoutLabel = { json: 'one JSON document', jsonl: 'JSON Lines', documents: 'several documents' }

const spawnWorker = () => new Worker(new URL('./json-types.worker.ts', import.meta.url), { type: 'module' })

export default function JsonTypesTool() {
  const [input, setInput] = useState(SAMPLE)
  const [target, setTarget] = useState<Target>('typescript')
  const [rootName, setRootName] = useState('Root')
  const [arrayAsSamples, setArrayAsSamples] = useState(false)
  const [formats, setFormats] = useState(false)
  const [enums, setEnums] = useState(false)
  const [enumMax, setEnumMax] = useState(8)
  const [ts, setTs] = useState<TsOptions>({ declaration: 'interface', optional: 'question', readonly: false })
  const [python, setPython] = useState<PythonFlavor>('typeddict')
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const runner = useRef<ReturnType<typeof createInferRunner> | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const options = useMemo<InferOptions>(
    () => ({ rootName, formats, enums, enumMax, arrayAsSamples, target, ts, python }),
    [rootName, formats, enums, enumMax, arrayAsSamples, target, ts, python],
  )

  useEffect(() => {
    runner.current = createInferRunner(spawnWorker)
    return () => runner.current?.dispose()
  }, [])

  useEffect(() => {
    let live = true
    setBusy(true)
    const timer = setTimeout(() => {
      void runner.current?.run(input, options).then((next) => {
        if (!live) return
        setOutcome(next)
        setBusy(false)
      })
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [input, options])

  const result: InferResult | null = outcome && 'result' in outcome ? outcome.result : null
  const ok = result?.ok ? result : null
  const error = result && !result.ok && 'error' in result ? result.error : null
  const meta = targets.find((item) => item.id === target)!
  const warnings = ok?.notes.filter((note) => note.level === 'warn') ?? []

  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setInput(await file.text())
    showToast(`Read ${file.name} (${file.size.toLocaleString()} bytes) — it stays on this device`)
  }

  const download = () => {
    if (!ok) return
    const url = URL.createObjectURL(new Blob([ok.code], { type: meta.mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${rootName.trim() || 'types'}.${meta.ext}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const setTsOption = <K extends keyof TsOptions>(key: K, value: TsOptions[K]) => setTs((current) => ({ ...current, [key]: value }))

  return (
    <div className="jtypes-app">
      <ToolHeader brand={<><span className="material-symbols-outlined" aria-hidden>account_tree</span> JSON to types</>} localLabel="local inference">
        <button type="button" onClick={() => setInput(SAMPLE)} aria-label="Load the sample" title="Sample">
          <span className="material-symbols-outlined" aria-hidden>auto_fix_high</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="jtypes-main">
        <p className="jtypes-notice">
          Paste one JSON document, JSON Lines, or several documents one after another. Every sample is merged: a key missing from some
          becomes optional, null makes a type nullable, mixed types become unions. Inference runs in a worker on this device; nothing is uploaded.
        </p>

        <div className="jtypes-grid">
          <div className="jtypes-col">
            <section className="jtypes-pane" aria-labelledby="jtypes-input-title">
              <header>
                <h2 id="jtypes-input-title">JSON samples</h2>
                {ok && (
                  <span className="jtypes-meta">
                    {ok.stats.samples.toLocaleString()} {ok.stats.samples === 1 ? 'sample' : 'samples'} · {layoutLabel[ok.stats.layout]} · {ok.stats.values.toLocaleString()} values
                  </span>
                )}
                <span className="jtypes-spacer" />
                <button type="button" onClick={() => fileInput.current?.click()} aria-label="Open a JSON file" title="Open file">
                  <span className="material-symbols-outlined" aria-hidden>folder_open</span>
                </button>
                <input ref={fileInput} type="file" accept=".json,.jsonl,.ndjson,application/json,text/plain" hidden onChange={(event) => void openFile(event)} />
                <button type="button" onClick={() => setInput('')} disabled={!input} aria-label="Clear the input" title="Clear">
                  <span className="material-symbols-outlined" aria-hidden>close</span>
                </button>
              </header>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                aria-label="JSON samples"
                aria-invalid={Boolean(error)}
                placeholder={'{"id": 1, "name": "Avery"}\n{"id": 2, "tags": ["x"]}'}
              />
              {error && (
                <p className="jtypes-error" role="alert">
                  {error.sample
                    ? <>Sample {error.sample}{error.line ? `, line ${error.line}${error.column ? ` column ${error.column}` : ''}` : ''}: {error.message}</>
                    : <>Inference failed: {error.message}</>}
                </p>
              )}
              {outcome && 'stopped' in outcome && (
                <p className="jtypes-error" role="alert">Stopped after {outcome.timeoutMs / 1000} s — this input is too large to infer in time. Try a smaller slice of it.</p>
              )}
            </section>

            <section className="jtypes-options" aria-labelledby="jtypes-options-title">
              <h2 id="jtypes-options-title">Inference</h2>
              <label className="jtypes-field">
                <span>Root type name</span>
                <input value={rootName} onChange={(event) => setRootName(event.target.value)} spellCheck={false} autoComplete="off" />
              </label>
              <label className="jtypes-check">
                <input type="checkbox" checked={arrayAsSamples} onChange={(event) => setArrayAsSamples(event.target.checked)} />
                <span>A top-level array is a list of samples (type its items, not the array)</span>
              </label>
              <label className="jtypes-check">
                <input type="checkbox" checked={formats} onChange={(event) => setFormats(event.target.checked)} />
                <span>Formats — refine strings where every value is an RFC 3339 date-time, a date, a UUID, an email or an http(s) URL</span>
              </label>
              <div className="jtypes-check jtypes-enum">
                <input id="jtypes-enums" type="checkbox" checked={enums} onChange={(event) => setEnums(event.target.checked)} />
                <label htmlFor="jtypes-enums">Enums — strings with at most</label>
                <select value={enumMax} onChange={(event) => setEnumMax(Number(event.target.value))} aria-label="Most distinct values for an enum">
                  {[2, 4, 8, 16, 32].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
                <label htmlFor="jtypes-enums">distinct values, each seen twice on average</label>
              </div>
              <p className="jtypes-fine">
                Containers nested deeper than {MAX_DEPTH} levels are typed unknown. Formats and enums are only applied when every sample fits, and the notes list the fields either way.
              </p>
            </section>

            {ok && ok.notes.length > 0 && (
              <section className="jtypes-notes" aria-labelledby="jtypes-notes-title">
                <h2 id="jtypes-notes-title">Notes <span>{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span></h2>
                <ul>
                  {ok.notes.map((note) => (
                    <li key={note.text} className={note.level === 'warn' ? 'warn' : ''}>
                      <span className="material-symbols-outlined" aria-hidden>{note.level === 'warn' ? 'warning' : 'info'}</span>
                      <div>
                        <p><span className="jtypes-sr">{note.level === 'warn' ? 'Warning: ' : 'Note: '}</span>{note.text}</p>
                        {note.paths && <ul className="jtypes-paths">{note.paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <section className="jtypes-pane jtypes-out" aria-label="Generated code">
            <header>
              <div className="jtypes-tabs" role="tablist" aria-label="Output language">
                {targets.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={target === item.id} className={target === item.id ? 'on' : ''} onClick={() => setTarget(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="jtypes-spacer" />
              <button type="button" onClick={() => ok && void copy(ok.code, meta.label)} disabled={!ok}>
                <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
              </button>
              <button type="button" onClick={download} disabled={!ok} aria-label={`Download .${meta.ext}`} title={`Download .${meta.ext}`}>
                <span className="material-symbols-outlined" aria-hidden>download</span>
              </button>
            </header>

            {(target === 'typescript' || target === 'zod' || target === 'python') && (
              <div className="jtypes-outopts">
                {target === 'typescript' && (
                  <>
                    <div className="jtypes-seg" role="group" aria-label="Declaration">
                      {(['interface', 'type'] as const).map((item) => (
                        <button key={item} type="button" className={ts.declaration === item ? 'on' : ''} aria-pressed={ts.declaration === item} onClick={() => setTsOption('declaration', item)}>{item}</button>
                      ))}
                    </div>
                    <label className="jtypes-inline">
                      <span>Optional keys</span>
                      <select value={ts.optional} onChange={(event) => setTsOption('optional', event.target.value as TsOptions['optional'])}>
                        <option value="question">key?: T</option>
                        <option value="question-undefined">key?: T | undefined</option>
                        <option value="undefined">key: T | undefined</option>
                      </select>
                    </label>
                  </>
                )}
                {(target === 'typescript' || target === 'zod') && (
                  <label className="jtypes-check">
                    <input type="checkbox" checked={ts.readonly} onChange={(event) => setTsOption('readonly', event.target.checked)} />
                    <span>readonly</span>
                  </label>
                )}
                {target === 'python' && (
                  <div className="jtypes-seg" role="group" aria-label="Python flavour">
                    {([['typeddict', 'TypedDict'], ['pydantic', 'pydantic v2']] as const).map(([id, label]) => (
                      <button key={id} type="button" className={python === id ? 'on' : ''} aria-pressed={python === id} onClick={() => setPython(id)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="jtypes-out-body" role="tabpanel" aria-label={meta.label} aria-busy={busy}>
              {ok ? (
                <>
                  {ok.code.length > PREVIEW_LIMIT && (
                    <p className="jtypes-fine">Showing the first {PREVIEW_LIMIT.toLocaleString()} of {ok.code.length.toLocaleString()} characters — Copy and Download carry all of it.</p>
                  )}
                  <pre className="jtypes-code"><code>{ok.code.length > PREVIEW_LIMIT ? ok.code.slice(0, PREVIEW_LIMIT) : ok.code}</code></pre>
                </>
              ) : (
                <p className="jtypes-empty">{busy ? 'Inferring…' : result && !result.ok && 'empty' in result ? 'Paste JSON to see its types.' : 'Fix the input to see types.'}</p>
              )}
            </div>
            <p className="jtypes-status" aria-live="polite">
              {busy ? 'Inferring…' : ok && outcome && 'elapsedMs' in outcome ? `${ok.stats.types.toLocaleString()} named ${ok.stats.types === 1 ? 'type' : 'types'} · ${Math.max(1, Math.round(outcome.elapsedMs))} ms` : ''}
            </p>
          </section>
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}
