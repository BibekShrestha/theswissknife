import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { parseInput, type Encoding } from './input'
import { createDecodeRunner } from './runner'
import { sampleProto, samples } from './samples'
import { DECODE_TIMEOUT_MS, MAX_INPUT_BYTES, formatLabel, type DecodeResponse, type Format, type FormatChoice, type Issue } from './types'
import { Details } from './ui/Details'
import { HexView, type Selection } from './ui/HexView'
import { flatten, initialExpansion, nodeAt, pathTo, type ViewChoice } from './ui/model'
import { Tree } from './ui/Tree'
import { hexOffset, plural } from './util'
import './binary.css'

const spawnWorker = () => new Worker(new URL('./binary.worker.ts', import.meta.url), { type: 'module' })

interface LoadedFile {
  name: string
  size: number
  bytes: Uint8Array
}

interface Decoded {
  response: DecodeResponse
  bytes: Uint8Array
}

const formats: Format[] = ['protobuf', 'cbor', 'msgpack']
const encodingLabel = { hex: 'hex', base64: 'Base64', base64url: 'Base64URL' }
const ISSUE_LIMIT = 100

export default function BinaryTool() {
  const [text, setText] = useState(samples.protobuf.hex)
  const [encoding, setEncoding] = useState<Encoding>('auto')
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [dragging, setDragging] = useState(false)
  const [format, setFormat] = useState<FormatChoice>('auto')
  const [packed, setPacked] = useState(false)
  const [proto, setProto] = useState('')
  const [root, setRoot] = useState('')
  const [decoded, setDecoded] = useState<Decoded | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [choice, setChoice] = useState<ViewChoice>(new Map())
  const [mark, setMark] = useState<number | null>(null)
  const [allIssues, setAllIssues] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const runner = useRef<ReturnType<typeof createDecodeRunner> | null>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const deferredText = useDeferredValue(text)
  const deferredProto = useDeferredValue(proto)
  const parsed = useMemo(() => (file ? null : parseInput(deferredText, encoding)), [file, deferredText, encoding])
  const bytes = file ? file.bytes : parsed?.bytes ?? null

  useEffect(() => () => runner.current?.dispose(), [])

  useEffect(() => {
    if (!bytes) return
    runner.current ??= createDecodeRunner(spawnWorker, DECODE_TIMEOUT_MS)
    let live = true
    setBusy(true)
    void runner.current.run({ bytes, format, options: { packed, proto: deferredProto, root } }).then((response) => {
      if (!live) return
      setBusy(false)
      setDecoded({ response, bytes })
    })
    return () => {
      live = false
    }
  }, [bytes, format, packed, deferredProto, root])

  // A new result starts with a fresh tree: default readings, a screenful expanded, the first item selected.
  useEffect(() => {
    const nodes = decoded?.response.result.nodes ?? []
    const fresh = new Map<string, number>()
    setChoice(fresh)
    setExpanded(initialExpansion(nodes, fresh))
    setSelected(nodes.length ? '0' : null)
    setMark(null)
    setAllIssues(false)
  }, [decoded])

  const response = decoded?.response ?? null
  const result = response?.result ?? null
  const nodes = useMemo(() => result?.nodes ?? [], [result])
  const rows = useMemo(() => flatten(nodes, expanded, choice), [nodes, expanded, choice])
  const selectedNode = selected ? nodeAt(nodes, selected, choice) : null
  const activeFormat: Format | null = format === 'auto' ? response?.detection?.format ?? null : format
  const stale = Boolean(decoded && bytes && decoded.bytes !== bytes) || busy

  const toggle = useCallback((id: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const reveal = (offset: number) => {
    const path = pathTo(nodes, offset, choice)
    if (!path.length) return
    setExpanded((prev) => new Set([...prev, ...path.slice(0, -1)]))
    setSelected(path[path.length - 1])
  }

  const pickIssue = (issue: Issue) => {
    setMark(issue.offset)
    reveal(issue.offset)
  }

  const chooseView = (view: number) => {
    if (!selected) return
    setChoice((prev) => new Map(prev).set(selected, view))
  }

  const openFile = async (picked: File | undefined) => {
    if (!picked) return
    if (picked.size > MAX_INPUT_BYTES) {
      showToast(`That file is ${(picked.size / 1048576).toFixed(1)} MB — the decoder takes up to ${MAX_INPUT_BYTES / 1048576} MB`)
      return
    }
    try {
      setFile({ name: picked.name, size: picked.size, bytes: new Uint8Array(await picked.arrayBuffer()) })
    } catch (error) {
      showToast(`Could not read the file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFile(event.dataTransfer.files[0])
  }

  const loadSample = (f: Format) => {
    setFile(null)
    setEncoding('auto')
    setText(samples[f].hex)
    setFormat('auto')
  }

  const selection: Selection | null = selectedNode
    ? { start: selectedNode.start, head: selectedNode.head, end: selectedNode.end, keyStart: selectedNode.key?.start, keyEnd: selectedNode.key?.end }
    : null

  const issues = result ? [...result.errors.map((i) => ({ ...i, level: 'error' as const })), ...result.warnings.map((i) => ({ ...i, level: 'warn' as const }))] : []
  const shownIssues = allIssues ? issues : issues.slice(0, ISSUE_LIMIT)
  const inputSize = bytes?.length ?? 0

  return (
    <div className="bin-app">
      <ToolHeader brand={<><span className="material-symbols-outlined" aria-hidden>account_tree</span> Binary decoder</>} localLabel="decoded locally" />

      <main id="main-content" className="bin-main">
        <p className="bin-notice">
          Paste hex or Base64, or drop a file, to read Protobuf, CBOR or MessagePack without a schema. Decoding runs in a worker in your browser with a {DECODE_TIMEOUT_MS / 1000} s deadline; nothing is uploaded.
        </p>

        <div className="bin-top">
          <section
            className={`bin-pane bin-input${dragging ? ' dragging' : ''}`}
            aria-labelledby="bin-input-title"
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <header>
              <h2 id="bin-input-title">Input</h2>
              {!file && (
                <div className="bin-seg" role="group" aria-label="Input encoding">
                  {(['auto', 'hex', 'base64'] as const).map((e) => (
                    <button key={e} type="button" className={encoding === e ? 'on' : ''} aria-pressed={encoding === e} onClick={() => setEncoding(e)}>
                      {e === 'auto' ? 'Auto' : e === 'hex' ? 'Hex' : 'Base64'}
                    </button>
                  ))}
                </div>
              )}
              <span className="bin-meta">
                {file ? `${file.name} · ${plural(file.size, 'byte')}` : parsed?.encoding ? `${encodingLabel[parsed.encoding]} · ${plural(inputSize, 'byte')}` : ''}
              </span>
              <button type="button" className="bin-push" onClick={() => fileRef.current?.click()} aria-label="Open a file" title="Open a file">
                <span className="material-symbols-outlined" aria-hidden>upload_file</span>
              </button>
              <button type="button" onClick={() => { setFile(null); setText('') }} disabled={!file && !text} aria-label="Clear the input" title="Clear">
                <span className="material-symbols-outlined" aria-hidden>close</span>
              </button>
              <input ref={fileRef} type="file" hidden onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
            </header>
            {file ? (
              <div className="bin-file">
                <span className="material-symbols-outlined" aria-hidden>description</span>
                <strong>{file.name}</strong>
                <span>{plural(file.size, 'byte')} · read in this browser, not uploaded</span>
                <button type="button" onClick={() => setFile(null)}>Back to text</button>
              </div>
            ) : (
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                aria-label="Bytes as hex or Base64"
                aria-invalid={Boolean(parsed?.error)}
                aria-describedby="bin-input-status"
                placeholder="08 96 01, 0x08 0x96 0x01, \x08\x96\x01 or CJYB — or drop a file here"
              />
            )}
            <div id="bin-input-status" className={`bin-status${parsed?.error ? ' err' : ''}`} role={parsed?.error ? 'alert' : undefined}>
              {parsed?.error ?? parsed?.note ?? ''}
            </div>
            <div className="bin-samples">
              <span>Samples</span>
              {formats.map((f) => (
                <button key={f} type="button" onClick={() => loadSample(f)} title={samples[f].about}>{formatLabel[f]}</button>
              ))}
            </div>
          </section>

          <section className="bin-pane bin-format" aria-labelledby="bin-format-title">
            <header>
              <h2 id="bin-format-title">Format</h2>
              <div className="bin-seg" role="group" aria-label="Format">
                {(['auto', ...formats] as FormatChoice[]).map((f) => (
                  <button key={f} type="button" className={format === f ? 'on' : ''} aria-pressed={format === f} onClick={() => setFormat(f)}>
                    {f === 'auto' ? 'Auto' : formatLabel[f]}
                  </button>
                ))}
              </div>
            </header>
            <div className="bin-format-body">
              {format === 'auto' && response?.detection && inputSize > 0 && (
                <p className="bin-detect" aria-live="polite">
                  <span className={`bin-badge ${response.detection.confidence}`}>{response.detection.confidence} confidence</span>
                  <strong>{formatLabel[response.detection.format]}</strong> — {response.detection.reason}
                </p>
              )}
              {format !== 'auto' && <p className="bin-detect">Reading the bytes as <strong>{formatLabel[format]}</strong>. Choose Auto to compare all three.</p>}

              {(activeFormat === 'protobuf' || format === 'protobuf') && (
                <div className="bin-proto">
                  <label className="bin-check">
                    <input type="checkbox" checked={packed} onChange={(event) => setPacked(event.target.checked)} />
                    Also try length-delimited fields as packed repeated varints, fixed32 and fixed64
                  </label>
                  <details open={Boolean(proto)}>
                    <summary>Name fields with a .proto (optional)</summary>
                    <p className="bin-fine">
                      A small reader for the common subset: messages, nested types, enums, scalar and message fields, map, oneof, optional / repeated / required.
                      Imports are not followed, and proto2 groups and extensions are skipped.
                    </p>
                    <textarea
                      className="bin-proto-text"
                      value={proto}
                      onChange={(event) => setProto(event.target.value)}
                      spellCheck={false}
                      aria-label=".proto definitions"
                      placeholder={'message Person {\n  string name = 1;\n  int32 id = 2;\n}'}
                    />
                    <div className="bin-proto-bar">
                      <button type="button" onClick={() => setProto(sampleProto)}>Sample .proto</button>
                      {response?.schema && response.schema.messages.length > 0 && (
                        <label>
                          Decode as{' '}
                          <select value={response.schema.root ?? ''} onChange={(event) => setRoot(event.target.value)}>
                            {response.schema.messages.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                    {response?.schema && (response.schema.errors.length > 0 || response.schema.notes.length > 0) && (
                      <ul className="bin-notes">
                        {response.schema.errors.map((e) => (
                          <li key={e} className="warn"><span className="material-symbols-outlined" aria-hidden>warning</span><span><span className="bin-sr">Error: </span>{e}</span></li>
                        ))}
                        {response.schema.notes.map((n) => (
                          <li key={n}><span className="material-symbols-outlined" aria-hidden>info</span><span>{n}</span></li>
                        ))}
                      </ul>
                    )}
                  </details>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className={`bin-results${stale ? ' stale' : ''}`} aria-labelledby="bin-results-title" aria-busy={busy}>
          <header className="bin-results-head">
            <h2 id="bin-results-title">Decoded</h2>
            {result && inputSize > 0 && (
              <span className="bin-meta">
                {formatLabel[result.format]} · {result.format === 'protobuf' ? plural(result.items, 'top-level field') : plural(result.items, 'top-level item')}
                {result.errors.length > 0 ? ` · stopped at byte ${result.errors[0].offset}` : ''}
                {result.warnings.length > 0 ? ` · ${plural(result.warnings.length, 'warning')}` : ''}
                {response ? ` · ${response.elapsedMs < 1 ? '<1' : Math.round(response.elapsedMs)} ms` : ''}
              </span>
            )}
            {busy && <span className="bin-meta">Decoding…</span>}
          </header>

          {response?.error && <p className="bin-banner err" role="alert">{response.error}</p>}
          {result?.truncated && <p className="bin-banner">The tree is cut short: decoding stops after 100,000 items so the page stays responsive. The hex view still shows every byte.</p>}

          {!inputSize ? (
            <p className="bin-empty">Paste bytes or drop a file to decode them.</p>
          ) : (
            <div className="bin-grid">
              <div className="bin-col">
                {nodes.length > 0 ? (
                  <Tree rows={rows} selected={selected} choice={choice} onSelect={setSelected} onToggle={toggle} />
                ) : (
                  <p className="bin-empty">Nothing decoded{result?.errors[0] ? ` — ${result.errors[0].message} at byte ${result.errors[0].offset}` : ''}.</p>
                )}
                {issues.length > 0 && (
                  <section className="bin-issues" aria-labelledby="bin-issues-title">
                    <h3 id="bin-issues-title">
                      {result!.errors.length ? 'Error' : 'Warnings'}{' '}
                      <span>{result!.errors.length ? `decoding stopped${result!.warnings.length ? ` · ${plural(result!.warnings.length, 'warning')} before it` : ''}` : plural(result!.warnings.length, 'warning')}</span>
                    </h3>
                    <ul>
                      {shownIssues.map((issue, i) => (
                        <li key={i} className={issue.level}>
                          <span className="material-symbols-outlined" aria-hidden>{issue.level === 'error' ? 'error' : 'warning'}</span>
                          <button type="button" onClick={() => pickIssue(issue)} aria-label={`Show byte ${issue.offset}`}>{hexOffset(issue.offset)}</button>
                          <span><span className="bin-sr">{issue.level === 'error' ? 'Error: ' : 'Warning: '}</span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                    {issues.length > shownIssues.length && <button type="button" className="bin-more" onClick={() => setAllIssues(true)}>Show all {issues.length}</button>}
                  </section>
                )}
              </div>
              <div className="bin-col">
                {selectedNode && selected && <Details node={selectedNode} id={selected} choice={choice} onChoose={chooseView} onCopy={(t, w) => void copy(t, w)} />}
                {decoded && decoded.bytes.length > 0 && (
                  <div className="bin-hexwrap">
                    <div className="bin-legend" aria-hidden>
                      <span className="bin-hl-head">header</span><span className="bin-hl-body">content</span>{selectedNode?.key && <span className="bin-hl-key">map key</span>}{mark !== null && <span className="bin-hl-mark">picked byte</span>}
                    </div>
                    <HexView bytes={decoded.bytes} selection={selection} mark={mark} onPick={(o) => { setMark(null); reveal(o) }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
