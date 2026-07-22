import { useMemo, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { codecs, convertCodec, utf8ByteLength, type CodecDirection, type CodecId } from './codec'
import './codec.css'

const SAMPLE = 'The Swiss Knife — local by design ✓'

export default function CodecTool() {
  const [codec, setCodec] = useState<CodecId>('base64')
  const [direction, setDirection] = useState<CodecDirection>('encode')
  const [input, setInput] = useState(SAMPLE)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const result = useMemo(() => convertCodec(codec, direction, input), [codec, direction, input])
  const selected = codecs.find((item) => item.id === codec)!

  const swap = () => {
    if (result.error) return
    setInput(result.value)
    setDirection((value) => value === 'encode' ? 'decode' : 'encode')
  }

  return (
    <div className="codec-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">swap_horiz</span> Codec studio</>}
        localLabel="local text conversion"
      >
        <button onClick={() => setInput(SAMPLE)} aria-label="Reset to sample" title="Reset to sample text"><span className="material-symbols-outlined">auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="codec-main">
        <section className="codec-controls" aria-label="Codec settings">
          <label>
            <span>Codec</span>
            <select value={codec} onChange={(event) => setCodec(event.target.value as CodecId)}>
              {codecs.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <div className="codec-direction" role="group" aria-label="Conversion direction">
            <button className={direction === 'encode' ? 'on' : ''} aria-pressed={direction === 'encode'} onClick={() => setDirection('encode')}>Encode</button>
            <button className={direction === 'decode' ? 'on' : ''} aria-pressed={direction === 'decode'} onClick={() => setDirection('decode')}>Decode</button>
          </div>
          <p>{selected.hint}</p>
        </section>

        <section className="codec-panes">
          <article className="codec-pane">
            <header>
              <div><span className="codec-step">01</span><strong>Input</strong></div>
              <span>{input.length.toLocaleString()} chars · {utf8ByteLength(input).toLocaleString()} B</span>
              <button onClick={() => setInput('')} disabled={!input} aria-label="Clear"><span className="material-symbols-outlined">close</span></button>
            </header>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} spellCheck={false} aria-label="Codec input" placeholder="Paste text here" />
          </article>

          <button className="codec-swap" onClick={swap} disabled={Boolean(result.error)} aria-label="Use output as input and reverse direction"><span className="material-symbols-outlined">swap_horiz</span></button>

          <article className={`codec-pane${result.error ? ' has-error' : ''}`}>
            <header>
              <div><span className="codec-step">02</span><strong>Output</strong></div>
              {!result.error && <span>{result.value.length.toLocaleString()} chars · {utf8ByteLength(result.value).toLocaleString()} B</span>}
              <button onClick={() => void copy(result.value, 'Output')} disabled={!result.value || Boolean(result.error)} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
            </header>
            {result.error ? <div className="codec-error" role="alert">{result.error}</div> : <textarea value={result.value} readOnly spellCheck={false} aria-label="Codec output" placeholder="Converted output appears here" />}
          </article>
        </section>
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
