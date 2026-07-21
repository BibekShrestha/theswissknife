import { useMemo, useRef, useState } from 'react'
import { Link, navigate, usePath } from '../../shell/router'
import { tools } from '../../shell/registry'
import { useTheme } from '../../shell/theme'
import { codecs, convertCodec, utf8ByteLength, type CodecDirection, type CodecId } from './codec'
import './codec.css'

const SAMPLE = 'The Swiss Knife — local by design ✓'

export default function CodecTool() {
  const [theme, toggleTheme] = useTheme()
  const [codec, setCodec] = useState<CodecId>('base64')
  const [direction, setDirection] = useState<CodecDirection>('encode')
  const [input, setInput] = useState(SAMPLE)
  const [toast, setToast] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const result = useMemo(() => convertCodec(codec, direction, input), [codec, direction, input])
  const selected = codecs.find((item) => item.id === codec)!

  const notify = (message: string) => {
    setToast(message)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 4000)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.value)
      notify('Output copied')
    } catch {
      notify('Copy failed — clipboard unavailable')
    }
  }

  const swap = () => {
    if (result.error) return
    setInput(result.value)
    setDirection((value) => value === 'encode' ? 'decode' : 'encode')
  }

  return (
    <div className="codec-app">
      <header className="codec-top">
        <Link to="/" className="home-link" title="All tools — The Swiss Knife"><span className="material-symbols-outlined">home</span></Link>
        <div className="codec-brand"><span className="material-symbols-outlined">swap_horiz</span> Codec studio</div>
        <span className="codec-local">local text conversion</span>
        <select className="tool-switcher" value={usePath()} onChange={(e) => navigate(`/${e.target.value}`)} aria-label="Switch tool">
          {tools.filter((t) => t.slug !== 'codec').map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
        <div className="spacer" />
        <button onClick={() => setInput(SAMPLE)}><span className="material-symbols-outlined">auto_fix_high</span></button>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </header>

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
              <button onClick={() => void copy()} disabled={!result.value || Boolean(result.error)} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
            </header>
            {result.error ? <div className="codec-error" role="alert">{result.error}</div> : <textarea value={result.value} readOnly spellCheck={false} aria-label="Codec output" placeholder="Converted output appears here" />}
          </article>
        </section>
      </main>
      <div className="codec-status" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}
