import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { OptionsPanel } from './components/OptionsPanel'
import { CheatsheetDrawer } from './components/CheatsheetDrawer'
import { examples } from './examples'
import { buildCliCommand, buildInvocation } from './flags'
import { highlightJson } from './highlight'
import { decodeShareHash, encodeShareUrl, loadInitialState, saveState } from './persist'
import { defaultOptions, type JqOptions, type RunResult } from './types'
import { useJq } from './useJq'

const initial = loadInitialState()

function exitLabel(code: number): { text: string; cls: string } {
  if (code === 0) return { text: 'exit 0', cls: 'ok' }
  if (code === 1 || code === 4) return { text: `exit ${code}`, cls: 'warn' }
  return { text: code < 0 ? 'killed' : `exit ${code}`, cls: 'err' }
}

// Exit 0 is success; 1 and 4 are -e's semantic codes (null/false or no
// output) — the run itself evaluated fine, so its output is current.
const isSuccess = (r: RunResult) => r.exitCode === 0 || r.exitCode === 1 || r.exitCode === 4

export default function App() {
  const [filter, setFilter] = useState(initial.filter)
  const [input, setInput] = useState(initial.input)
  const [options, setOptions] = useState<JqOptions>(initial.options)
  const [autoRun, setAutoRun] = useState(initial.autoRun)
  // `current` is the latest run (may be a failure); `lastGood` is the most
  // recent successful run, preserved so mid-edit errors don't eat the output.
  const [current, setCurrent] = useState<RunResult | null>(null)
  const [lastGood, setLastGood] = useState<RunResult | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [splitPct, setSplitPct] = useState(46)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = localStorage.getItem('jqplay.theme')
    if (stored === 'dark' || stored === 'light') return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  const filterRef = useRef<HTMLTextAreaElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const handleResult = useCallback((r: RunResult) => {
    setCurrent(r)
    if (isSuccess(r)) setLastGood(r)
  }, [])

  const jq = useJq(handleResult, options.timeoutSec)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('jqplay.theme', theme)
  }, [theme])

  // shared link (#z= gzipped, #s= legacy) — decoded async, wins over storage
  useEffect(() => {
    const hash = location.hash
    if (!hash) return
    void decodeShareHash(hash).then((st) => {
      if (!st) return
      setFilter(st.filter)
      setInput(st.input)
      setOptions(st.options)
      setAutoRun(st.autoRun)
    })
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  // ---- running ----------------------------------------------------------
  const execute = useCallback(() => {
    const inv = buildInvocation(filter, options)
    if (inv.error) {
      handleResult({ stdout: '', stderr: inv.error, exitCode: -2, ms: 0 })
      return
    }
    jq.run({ input, query: inv.query, flags: inv.flags })
  }, [filter, input, options, handleResult, jq.run]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRun) return
    const t = setTimeout(execute, 300)
    return () => clearTimeout(t)
  }, [execute, autoRun])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        execute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [execute])

  // ---- persistence ------------------------------------------------------
  useEffect(() => {
    const t = setTimeout(() => saveState({ filter, input, options, autoRun }), 500)
    return () => clearTimeout(t)
  }, [filter, input, options, autoRun])

  // ---- clipboard helpers ------------------------------------------------
  const copy = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text)
        showToast(`${what} copied`)
      } catch {
        showToast('Copy failed — clipboard unavailable')
      }
    },
    [showToast],
  )

  const share = useCallback(async () => {
    const url = await encodeShareUrl({ filter, input, options, autoRun })
    if (url.length > 30_000) {
      showToast('State too large to share via URL — trim the input')
      return
    }
    history.replaceState(null, '', url)
    void copy(url, 'Share link')
  }, [filter, input, options, autoRun, copy, showToast])

  // ---- filter helpers ---------------------------------------------------
  const insertIntoFilter = useCallback((code: string) => {
    const el = filterRef.current
    setFilter((prev) => {
      if (!el) return code
      const start = el.selectionStart ?? prev.length
      const end = el.selectionEnd ?? prev.length
      const next = prev.slice(0, start) + code + prev.slice(end)
      requestAnimationFrame(() => {
        el.focus()
        el.selectionStart = el.selectionEnd = start + code.length
      })
      return next
    })
  }, [])

  const loadExample = useCallback((name: string) => {
    const ex = examples.find((e) => e.name === name)
    if (!ex) return
    setFilter(ex.filter)
    setInput(ex.input)
    setOptions({ ...defaultOptions, ...structuredClone(ex.options ?? {}) })
  }, [])

  // ---- input pane actions ------------------------------------------------
  const formatInput = useCallback(
    (spacing: number) => {
      try {
        setInput(JSON.stringify(JSON.parse(input), null, spacing))
      } catch {
        showToast('Input is not a single JSON document')
      }
    },
    [input, showToast],
  )

  const onPickFile = useCallback((f: File | undefined) => {
    if (!f) return
    void f.text().then(setInput)
  }, [])

  // ---- split drag --------------------------------------------------------
  const onDividerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const main = mainRef.current
    if (!main) return
    const rect = main.getBoundingClientRect()
    const half = (e.currentTarget as HTMLElement).offsetWidth / 2
    document.body.classList.add('dragging')
    const move = (ev: PointerEvent) => {
      // position the divider's center under the cursor
      const pct = ((ev.clientX - rect.left - half) / rect.width) * 100
      setSplitPct(Math.min(78, Math.max(22, pct)))
    }
    const up = () => {
      document.body.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  // ---- derived -----------------------------------------------------------
  const inputBytes = useMemo(() => new TextEncoder().encode(input).length, [input])

  // What the output pane shows: the current run if it succeeded, else the
  // preserved last successful output (marked stale) with the error alongside.
  const display = current && isSuccess(current) ? current : lastGood
  const isStale = current != null && !isSuccess(current) && lastGood != null

  const outputNodes = useMemo(() => {
    if (!display?.stdout) return null
    const text = display.stdout.replace(/\0/g, '␀')
    return options.outputMode === 'json' ? highlightJson(text) : text
  }, [display?.stdout, options.outputMode])

  const compileError = current != null && current.exitCode === 3
  const exit = current ? exitLabel(current.exitCode) : null
  const inputLabel = options.rawInput ? 'Input · raw text (-R)' : 'Input · JSON'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-jq">jq</span> playground
        </div>
        <span className="badge" title="Real jq compiled to WebAssembly, running locally in your browser">
          {jq.fatal ? 'wasm failed' : jq.version ? `${jq.version} · wasm` : 'loading wasm…'}
        </span>
        <div className="spacer" />
        <select
          className="examples-select"
          value=""
          onChange={(e) => {
            loadExample(e.target.value)
            e.target.value = ''
          }}
        >
          <option value="" disabled>
            Examples…
          </option>
          {examples.map((ex) => (
            <option key={ex.name} value={ex.name}>
              {ex.name}
            </option>
          ))}
        </select>
        <button onClick={() => setDrawerOpen(true)}>Reference</button>
        <button onClick={() => void copy(buildCliCommand(filter, options), 'Command')} title="Copy the equivalent terminal command">
          Copy command
        </button>
        <button onClick={share} title="Copy a link that restores this exact session">
          Share
        </button>
        <button
          className="icon-btn theme-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <section className={`filter-row${compileError ? ' has-error' : ''}`}>
        <textarea
          ref={filterRef}
          className="filter-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder=". (jq filter — try .foo, map(select(…)), group_by(…))"
          spellCheck={false}
          rows={Math.min(8, Math.max(1, filter.split('\n').length))}
        />
        <div className="run-controls">
          <label className="autorun" title="Re-run automatically as you type">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            auto
          </label>
          {jq.running ? (
            <button className="run-btn stop" onClick={jq.stop}>
              Stop
            </button>
          ) : (
            <button className="run-btn" onClick={execute} title="Run (⌘⏎ / Ctrl+⏎)">
              Run ⏎
            </button>
          )}
        </div>
      </section>

      <OptionsPanel options={options} onChange={setOptions} />

      <main className="panes" ref={mainRef}>
        <section className="pane input-pane" style={{ flexBasis: `${splitPct}%` }}>
          <div className="pane-head">
            <span className="pane-title">
              {inputLabel}
              {options.nullInput && <em className="pane-note"> — -n: read only via input/inputs</em>}
            </span>
            <span className="pane-meta">{inputBytes.toLocaleString()} B</span>
            <div className="pane-actions">
              <button onClick={() => formatInput(2)} title="Pretty-print (single JSON doc)">
                Format
              </button>
              <button onClick={() => formatInput(0)} title="Minify (single JSON doc)">
                Minify
              </button>
              <button onClick={() => fileRef.current?.click()} title="Load a local file">
                Open…
              </button>
              <button onClick={() => void copy(input, 'Input')}>Copy</button>
              <button onClick={() => setInput('')}>Clear</button>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => {
                  onPickFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          </div>
          <textarea
            className="io-area"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={options.rawInput ? 'raw text, one line per input' : '{"paste": "JSON here"} — multiple documents allowed'}
            spellCheck={false}
          />
        </section>

        <div className="divider" onPointerDown={onDividerDown} role="separator" aria-orientation="vertical" />

        <section className="pane">
          <div className="pane-head">
            <span className="pane-title">Output</span>
            {current && (
              <span className="pane-meta">
                <span className={`exit-chip ${exit!.cls}`}>{exit!.text}</span>
                {isStale && <span className="exit-chip warn">stale</span>}
                {current.ms > 0 && <span>{current.ms < 1 ? '<1' : Math.round(current.ms)} ms</span>}
                <span>{(display?.stdout.length ?? 0).toLocaleString()} B</span>
              </span>
            )}
            <div className="pane-actions">
              <button onClick={() => void copy(display?.stdout ?? '', 'Output')} disabled={!display?.stdout}>
                Copy
              </button>
              <button
                disabled={!display?.stdout}
                onClick={() => {
                  const blob = new Blob([display?.stdout ?? ''], { type: 'application/json' })
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(blob)
                  a.download = 'output.json'
                  a.click()
                  URL.revokeObjectURL(a.href)
                }}
                title="Download output as a file"
              >
                Download
              </button>
            </div>
          </div>
          <div className="io-area output" tabIndex={0}>
            {jq.fatal ? (
              <div className="stderr-block">Failed to load jq wasm: {jq.fatal}</div>
            ) : !jq.ready && !current ? (
              <div className="empty-note">loading jq…</div>
            ) : (
              <>
                {current?.stderr && (
                  <div className={`stderr-block${current.exitCode !== 0 ? ' err' : ''}`}>{current.stderr}</div>
                )}
                {isStale && (
                  <div className="stale-banner">
                    Showing the last successful output — the current filter didn't produce a result.
                  </div>
                )}
                {display?.stdout ? (
                  <pre className={`stdout${isStale ? ' stale' : ''}`}>{outputNodes}</pre>
                ) : (
                  current && !current.stderr && <div className="empty-note">— no output —</div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <CheatsheetDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onInsert={insertIntoFilter} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
