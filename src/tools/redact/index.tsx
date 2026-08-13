import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { MASK_CHARS } from './lib/characters'
import {
  DEFAULT_OPTIONS,
  leaks,
  measure,
  normalizeMask,
  redact,
  type SpaceMode,
} from './lib/redact'
import './redact.css'

const SAMPLE = `Incident 4821 — 2026-08-09
Reported by dana.whitfield@example.com from 10.4.19.7
Access token: sk_live_9f3ac1b8d47e2205
Summary: the nightly export ran twice and duplicated 812 rows.`

const SPACE_MODES: { id: SpaceMode; label: string; blurb: string }[] = [
  { id: 'keep', label: 'Keep spaces', blurb: 'word shapes stay readable' },
  { id: 'remove', label: 'Remove spaces', blurb: 'one solid run per line' },
  { id: 'redact', label: 'Redact spaces', blurb: 'solid run, original length' },
]

export default function RedactTool() {
  const [text, setText] = useState('')
  const [mask, setMask] = useState(DEFAULT_OPTIONS.mask)
  const [spaces, setSpaces] = useState<SpaceMode>(DEFAULT_OPTIONS.spaces)

  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const sourceRef = useRef<HTMLTextAreaElement>(null)

  // Grapheme segmentation over a long paste is not free; deferring it keeps
  // typing smooth and lets React drop superseded work.
  const deferred = useDeferredValue(text)
  const options = useMemo(() => ({ mask: normalizeMask(mask), spaces }), [mask, spaces])

  const output = useMemo(() => redact(deferred, options), [deferred, options])
  const counts = useMemo(() => measure(deferred), [deferred])
  const notes = useMemo(() => (deferred.trim() ? leaks(deferred, options) : []), [deferred, options])

  return (
    <div className="redact-app">
      <ToolHeader
        brand={
          <>
            <span className="tool-mark-accent">█</span> Text redactor
          </>
        }
        localLabel="nothing leaves this tab"
      >
        <button
          onClick={() => setText(SAMPLE)}
          aria-label="Load sample text"
          title="Load a sample to redact"
        >
          <span className="material-symbols-outlined">description</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="redact-main">
        <section className="redact-controls" aria-label="Redaction options">
          <div className="redact-control">
            <span className="redact-label">Mask character</span>
            <div className="redact-chars" role="radiogroup" aria-label="Mask character">
              {MASK_CHARS.map((option) => (
                <button
                  key={option.char}
                  role="radio"
                  aria-checked={options.mask === option.char}
                  className={`redact-char${options.mask === option.char ? ' on' : ''}`}
                  title={`${option.name} (${option.code})`}
                  onClick={() => setMask(option.char)}
                >
                  {option.char}
                </button>
              ))}
              <label className="redact-custom" title="Any single character, including an emoji">
                <span>own</span>
                <input
                  type="text"
                  value={mask}
                  onChange={(event) => setMask(event.target.value)}
                  aria-label="Custom mask character"
                  spellCheck={false}
                />
              </label>
            </div>
          </div>

          <div className="redact-control">
            <span className="redact-label">Spaces</span>
            <div className="redact-modes" role="radiogroup" aria-label="Space handling">
              {SPACE_MODES.map((option) => (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={spaces === option.id}
                  className={`redact-mode${spaces === option.id ? ' on' : ''}`}
                  onClick={() => setSpaces(option.id)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="redact-panes">
          <article className="redact-pane">
            <header>
              <div>
                <span className="redact-step">01</span>
                <strong>Source text</strong>
              </div>
              <span>
                {(counts.masked + counts.spaces).toLocaleString()} chars ·{' '}
                {counts.words.toLocaleString()} words
              </span>
              <button onClick={() => setText('')} disabled={!text} aria-label="Clear source">
                <span className="material-symbols-outlined">close</span>
              </button>
            </header>
            <textarea
              ref={sourceRef}
              className="redact-source mono"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              aria-label="Source text"
              placeholder={'Paste the text to redact.\n\nIt is transformed here in the page — no upload, no round-trip.'}
            />
          </article>

          <article className="redact-pane">
            <header>
              <div>
                <span className="redact-step">02</span>
                <strong>Redacted</strong>
              </div>
              {/* blocks, not string length: one block can be several code units */}
              <span>{counts.masked.toLocaleString()} blocks</span>
              <button
                onClick={() => copy(output, 'Redacted text')}
                disabled={!output}
                aria-label="Copy redacted text"
                title="Copy the redacted text"
              >
                <span className="material-symbols-outlined">content_copy</span>
              </button>
            </header>
            <textarea
              className="redact-output mono"
              value={output}
              readOnly
              spellCheck={false}
              aria-label="Redacted text"
              placeholder="The blocks appear here as you type."
            />
            <footer className="redact-foot">
              {notes.length > 0 ? (
                <>
                  <span className="redact-foot-label">Still visible</span>
                  <ul>
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <span className="redact-hint">
                  One character in, one character out — there is no hidden layer to recover, unlike a
                  black box drawn over a PDF.
                </span>
              )}
            </footer>
          </article>
        </section>

        <p className="redact-note">
          Kept spaces only line up in a monospace font; pasted into a chat or a document with
          proportional type, the words will not sit where they do here.
        </p>
      </main>

      {toast && (
        <div className="shell-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
