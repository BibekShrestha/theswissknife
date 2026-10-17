import { useMemo, useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { createUlidGenerator, encodeUlid } from './ulid'
import { createV7Generator, formatUuid, inspectLines, uuidV4 } from './uuid'
import './uuid.css'

type Mode = 'inspect' | 'generate'
type Kind = 'v4' | 'v7' | 'ulid'

const SAMPLE = [
  'C232AB00-9414-11EC-B3C8-9F6BDECED846',
  '{1EC9414C-232A-6B00-B3C8-9F6BDECED846}',
  'urn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
  '919108f752d143209bacf847db4148a8',
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '00000000-0000-0000-0000-000000000000',
].join('\n')

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'v4', label: 'UUID v4', hint: '122 random bits' },
  { id: 'v7', label: 'UUID v7', hint: 'Unix ms + monotonic random — sorts by time' },
  { id: 'ulid', label: 'ULID', hint: 'Unix ms + monotonic random, Crockford base32' },
]

const clampCount = (value: number) => Math.min(1000, Math.max(1, Math.round(value) || 1))

export default function UuidTool() {
  const [mode, setMode] = useState<Mode>('generate')
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  return (
    <div className="uuid-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">fingerprint</span> UUID &amp; ULID</>}
        localLabel="runs locally"
        beforeSwitcher={
          <div className="uuid-tabs" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={mode === 'generate'} className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>Generate</button>
            <button role="tab" aria-selected={mode === 'inspect'} className={mode === 'inspect' ? 'on' : ''} onClick={() => setMode('inspect')}>Inspect</button>
          </div>
        }
      />
      <main id="main-content" className="uuid-main">
        {mode === 'generate' ? <Generate copy={copy} /> : <Inspect copy={copy} />}
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

type Copy = (text: string, what: string) => Promise<void>

function Generate({ copy }: { copy: Copy }) {
  const v7 = useRef(createV7Generator())
  const ulid = useRef(createUlidGenerator())
  const [kind, setKind] = useState<Kind>('v7')
  const [count, setCount] = useState(10)
  const [upper, setUpper] = useState(false)
  const [hyphens, setHyphens] = useState(true)
  const [batch, setBatch] = useState<Uint8Array[]>(() => Array.from({ length: 10 }, () => v7.current()))
  const [batchKind, setBatchKind] = useState<Kind>('v7')

  const generate = (nextKind = kind, nextCount = count) => {
    const make = nextKind === 'v4' ? () => uuidV4() : nextKind === 'v7' ? v7.current : ulid.current
    setBatch(Array.from({ length: clampCount(nextCount) }, make))
    setBatchKind(nextKind)
  }

  const pickKind = (next: Kind) => {
    setKind(next)
    setUpper(next === 'ulid')
    generate(next)
  }

  const output = useMemo(() => batch.map((bytes) => {
    if (batchKind === 'ulid') {
      const text = encodeUlid(bytes)
      return upper ? text : text.toLowerCase()
    }
    return formatUuid(bytes, { upper, hyphens })
  }).join('\n'), [batch, batchKind, upper, hyphens])

  const hint = KINDS.find((item) => item.id === kind)!.hint

  return (
    <>
      <section className="uuid-controls" aria-label="Generator settings">
        <div className="uuid-seg" role="group" aria-label="ID type">
          {KINDS.map((item) => (
            <button key={item.id} className={kind === item.id ? 'on' : ''} aria-pressed={kind === item.id} onClick={() => pickKind(item.id)}>{item.label}</button>
          ))}
        </div>
        <label>
          <span>Count</span>
          <input type="number" min={1} max={1000} value={count} onChange={(event) => setCount(Number(event.target.value))} onBlur={() => setCount(clampCount(count))} />
        </label>
        <div className="uuid-seg" role="group" aria-label="Letter case">
          <button className={!upper ? 'on' : ''} aria-pressed={!upper} onClick={() => setUpper(false)}>lower</button>
          <button className={upper ? 'on' : ''} aria-pressed={upper} onClick={() => setUpper(true)}>UPPER</button>
        </div>
        <label className="uuid-check">
          <input type="checkbox" checked={hyphens} disabled={kind === 'ulid'} onChange={(event) => setHyphens(event.target.checked)} />
          <span>Hyphens</span>
        </label>
        <p>{hint}</p>
        <button className="uuid-primary" onClick={() => generate()}>
          <span className="material-symbols-outlined">refresh</span> Generate
        </button>
      </section>

      <article className="uuid-pane">
        <header>
          <strong>{batch.length.toLocaleString()} × {KINDS.find((item) => item.id === batchKind)!.label}</strong>
          <span>crypto.getRandomValues</span>
          <button onClick={() => void copy(output, batch.length === 1 ? 'ID' : `${batch.length} IDs`)} disabled={!output}>
            <span className="material-symbols-outlined">content_copy</span> Copy all
          </button>
        </header>
        <textarea value={output} readOnly spellCheck={false} aria-label="Generated IDs" wrap="off" />
      </article>
    </>
  )
}

function Inspect({ copy }: { copy: Copy }) {
  const [input, setInput] = useState(SAMPLE)
  const results = useMemo(() => inspectLines(input), [input])
  const errors = results.filter((result) => 'error' in result).length

  return (
    <section className="uuid-inspect">
      <article className="uuid-pane">
        <header>
          <strong>IDs</strong>
          <span>one per line · UUID or ULID</span>
          <button onClick={() => setInput('')} disabled={!input} aria-label="Clear"><span className="material-symbols-outlined">close</span></button>
        </header>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} aria-label="IDs to inspect" wrap="off" placeholder="Paste UUIDs or ULIDs, one per line" />
      </article>

      <div className="uuid-results" aria-live="polite">
        {results.length === 0 && <p className="uuid-empty">Paste a UUID (any case, with or without hyphens, braces or urn:uuid:) or a ULID.</p>}
        {results.length > 0 && <p className="uuid-count">{results.length} line{results.length === 1 ? '' : 's'}{errors ? ` · ${errors} invalid` : ''}</p>}
        {results.map((result) => 'error' in result ? (
          <article key={result.line} className="uuid-card has-error">
            <header><span className="uuid-line">L{result.line}</span><code>{result.input}</code></header>
            <div className="uuid-error" role="alert">{result.error}</div>
          </article>
        ) : (
          <article key={result.line} className="uuid-card">
            <header><span className="uuid-line">L{result.line}</span><strong>{result.summary}</strong></header>
            <dl className="uuid-fields">
              {result.fields.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd><code>{item.value}</code>{item.note && <small>{item.note}</small>}</dd>
                </div>
              ))}
            </dl>
            <dl className="uuid-forms">
              {result.forms.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>
                    <code>{item.value}</code>
                    <button onClick={() => void copy(item.value, item.label)} aria-label={`Copy ${item.label}`} title={`Copy ${item.label}`}>
                      <span className="material-symbols-outlined">content_copy</span>
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  )
}
