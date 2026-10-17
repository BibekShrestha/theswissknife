import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { convert, formatLabel, formats, type ConvertError, type Format, type InputFormat } from './convert'
import './convert.css'

const SAMPLE = `# Service settings
name: swiss-knife
version: 3
ratio: 1.0
country: no
on: push
defaults: &defaults
  retries: 3
  timeout: 30
servers:
  - host: alpha.example
    <<: *defaults
  - host: beta.example
    port: 8443
    <<: *defaults
`

function lineStart(text: string, line: number) {
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  return offset
}

function ErrorExcerpt({ text, error }: { text: string; error: ConvertError }) {
  if (!error.line) return null
  const lines = text.split('\n')
  const from = Math.max(1, error.line - 2)
  const width = String(error.line).length
  const rows = []
  for (let line = from; line <= Math.min(error.line, lines.length); line++) {
    rows.push(<div key={line} className={line === error.line ? 'convert-excerpt-hit' : undefined}><span>{String(line).padStart(width)}</span>{lines[line - 1] || ' '}</div>)
  }
  if (error.column) rows.push(<div key="caret" className="convert-excerpt-caret" aria-hidden><span>{' '.repeat(width)}</span>{' '.repeat(error.column - 1)}^</div>)
  return <pre className="convert-excerpt">{rows}</pre>
}

export default function ConvertTool() {
  const [input, setInput] = useState(SAMPLE)
  const [from, setFrom] = useState<InputFormat>('auto')
  const [to, setTo] = useState<Format>('json')
  const [indent, setIndent] = useState<2 | 4>(2)
  const [sortKeys, setSortKeys] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const deferred = useDeferredValue(input)
  const result = useMemo(() => convert(deferred, { from, to, indent, sortKeys }), [deferred, from, to, indent, sortKeys])
  const inputError = result.error?.side === 'input' ? result.error : undefined
  const outputError = result.error?.side === 'output' ? result.error : undefined
  const target = formats.find((item) => item.id === to)!

  const showLine = (error: ConvertError) => {
    const area = inputRef.current
    if (!area || !error.line) return
    const start = lineStart(input, error.line)
    const end = input.indexOf('\n', start)
    area.focus()
    area.setSelectionRange(start, end < 0 ? input.length : end)
    const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20
    area.scrollTop = Math.max(0, (error.line - 3) * lineHeight)
  }

  const swap = () => {
    if (result.error || !result.output) return
    setInput(result.output)
    setFrom(to)
    setTo(result.format ?? (from === 'auto' ? 'json' : from))
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([result.output], { type: target.mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = `converted.${target.ext}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  let detectLabel = ''
  if (from === 'auto' && result.format) detectLabel = result.guessed ? `looks like ${formatLabel(result.format)} — doesn't parse` : `detected ${formatLabel(result.format)}`

  return (
    <div className="convert-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">sync_alt</span> YAML · JSON · TOML</>}
        localLabel="local conversion"
      >
        <button onClick={() => { setInput(SAMPLE); setFrom('auto') }} aria-label="Reset to sample" title="Reset to sample"><span className="material-symbols-outlined">auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="convert-main">
        <section className="convert-controls" aria-label="Output settings">
          <div className="convert-seg" role="group" aria-label="Indent">
            <span>Indent</span>
            {([2, 4] as const).map((size) => (
              <button key={size} className={indent === size ? 'on' : ''} aria-pressed={indent === size} disabled={to === 'toml'} onClick={() => setIndent(size)}>{size}</button>
            ))}
          </div>
          <label className="convert-check">
            <input type="checkbox" checked={sortKeys} onChange={(event) => setSortKeys(event.target.checked)} />
            <span>Sort keys</span>
          </label>
          <p>{to === 'toml'
            ? 'TOML has no null: null keys are dropped and listed; a null inside an array stops the conversion.'
            : 'YAML is read as YAML 1.2. Anchors are expanded, comments and tags are not carried over.'}</p>
        </section>

        <section className="convert-panes">
          <article className={`convert-pane${inputError ? ' has-error' : ''}`}>
            <header>
              <div><span className="convert-step">01</span><strong>Input</strong></div>
              <select value={from} onChange={(event) => setFrom(event.target.value as InputFormat)} aria-label="Input format">
                <option value="auto">Auto-detect</option>
                {formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {detectLabel && <span className={`convert-detect${result.guessed ? ' guessed' : ''}`}>{detectLabel}</span>}
              <span className="convert-meta">{input.split('\n').length.toLocaleString()} lines</span>
              <button onClick={() => setInput('')} disabled={!input} aria-label="Clear input" title="Clear"><span className="material-symbols-outlined">close</span></button>
            </header>
            <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} aria-label="Input document" placeholder="Paste JSON, YAML or TOML" aria-invalid={Boolean(inputError)} />
            {inputError && (
              <div className="convert-error" role="alert">
                <div className="convert-error-head">
                  <strong>{formatLabel(result.format!)} error{inputError.line ? ` at line ${inputError.line}${inputError.column ? `, column ${inputError.column}` : ''}` : ''}</strong>
                  {inputError.line && <button onClick={() => showLine(inputError)}>Show line</button>}
                </div>
                <div>{inputError.message}</div>
                <ErrorExcerpt text={deferred} error={inputError} />
              </div>
            )}
          </article>

          <button className="convert-swap" onClick={swap} disabled={Boolean(result.error) || !result.output} aria-label="Use output as input and swap formats" title="Swap"><span className="material-symbols-outlined">swap_horiz</span></button>

          <article className={`convert-pane${outputError ? ' has-error' : ''}`}>
            <header>
              <div><span className="convert-step">02</span><strong>Output</strong></div>
              <select value={to} onChange={(event) => setTo(event.target.value as Format)} aria-label="Output format">
                {formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <span className="convert-meta" />
              <button onClick={() => void copy(result.output, 'Output')} disabled={!result.output} aria-label="Copy output" title="Copy"><span className="material-symbols-outlined">content_copy</span></button>
              <button onClick={download} disabled={!result.output} aria-label={`Download .${target.ext}`} title={`Download .${target.ext}`}><span className="material-symbols-outlined">download</span></button>
            </header>
            {outputError
              ? <div className="convert-error" role="alert"><div className="convert-error-head"><strong>Can't write {target.label}</strong></div><div>{outputError.message}</div></div>
              : <textarea value={inputError ? '' : result.output} readOnly spellCheck={false} aria-label="Converted output" placeholder={inputError ? 'Fix the input error to see output' : 'Converted output appears here'} />}
          </article>
        </section>

        {result.notes.length > 0 && (
          <section className="convert-notes" aria-label="Conversion notes">
            {result.notes.map((note) => (
              <div key={note.text} className={`convert-note ${note.level}`}>
                <span className="material-symbols-outlined" aria-hidden>{note.level === 'warn' ? 'warning' : 'info'}</span>
                <div>
                  <p>{note.text}</p>
                  {note.items && (
                    <ul>
                      {note.items.slice(0, 12).map((item) => <li key={item}><code>{item}</code></li>)}
                      {note.items.length > 12 && <li>and {note.items.length - 12} more</li>}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
