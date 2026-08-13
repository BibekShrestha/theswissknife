import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { MASK_CHARS } from './lib/characters'
import { PRESETS } from './lib/patterns'
import {
  DEFAULT_OPTIONS,
  findRanges,
  leaks,
  measure,
  normalizeMask,
  redactRanges,
  type SpaceMode,
  type Target,
} from './lib/redact'
import './redact.css'

const SAMPLE = `Incident 4821 — 2026-08-09
Reported by dana.whitfield@example.com from 10.4.19.7
Access token: sk_live_9f3ac1b8d47e2205
Summary: the nightly export ran twice and duplicated 812 rows.`

const SPACE_MODES: { id: SpaceMode; label: string; blurb: string }[] = [
  { id: 'keep', label: 'Keep spaces', blurb: 'word shapes stay readable' },
  { id: 'remove', label: 'Remove spaces', blurb: 'one solid run' },
  { id: 'redact', label: 'Redact spaces', blurb: 'solid run, same length' },
]

type Scope = 'all' | 'picked'

interface Pick extends Target {
  id: number
}

export default function RedactTool() {
  const [text, setText] = useState('')
  const [mask, setMask] = useState(DEFAULT_OPTIONS.mask)
  const [spaces, setSpaces] = useState<SpaceMode>(DEFAULT_OPTIONS.spaces)
  const [scope, setScope] = useState<Scope>('all')
  const [picks, setPicks] = useState<Pick[]>([])
  const [draft, setDraft] = useState('')
  const [draftIsRegex, setDraftIsRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)

  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const nextId = useRef(0)

  // Grapheme segmentation and a regex sweep over a long paste are not free;
  // deferring keeps typing smooth and lets React drop superseded work.
  const deferred = useDeferredValue(text)
  const options = useMemo(() => ({ mask: normalizeMask(mask), spaces }), [mask, spaces])

  const report = useMemo(
    () => (scope === 'picked' ? findRanges(deferred, picks, { caseSensitive }) : null),
    [scope, deferred, picks, caseSensitive],
  )

  const ranges = useMemo(
    () => (report ? report.ranges : [{ start: 0, end: deferred.length }]),
    [report, deferred.length],
  )

  const output = useMemo(() => redactRanges(deferred, ranges, options), [deferred, ranges, options])
  const counts = useMemo(() => measure(deferred), [deferred])
  const notes = useMemo(
    () => (deferred.trim() ? leaks(deferred, options, scope === 'picked') : []),
    [deferred, options, scope],
  )

  const masked = useMemo(() => ranges.reduce((sum, range) => sum + (range.end - range.start), 0), [ranges])
  const missing = report ? report.counts.filter((count, i) => count === 0 && !!picks[i].value).length : 0

  const addPick = (value: string, kind: Target['kind']) => {
    const trimmed = kind === 'literal' ? value : value.trim()
    if (!trimmed.trim()) return
    setPicks((prev) =>
      prev.some((pick) => pick.kind === kind && pick.value === trimmed)
        ? prev
        : [...prev, { id: nextId.current++, kind, value: trimmed }],
    )
    setScope('picked')
  }

  /** Redacts whatever is highlighted in the source — every occurrence of it. */
  const redactSelection = () => {
    const el = sourceRef.current
    if (!el) return
    const picked = text.slice(el.selectionStart, el.selectionEnd)
    if (!picked.trim()) {
      showToast('Select some text in the source first')
      return
    }
    addPick(picked, 'literal')
    showToast(`Redacting every “${ellipsis(picked, 24)}”`)
  }

  const onSourceKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      redactSelection()
    }
  }

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
        <button onClick={() => setText(SAMPLE)} aria-label="Load sample text" title="Load a sample to redact">
          <span className="material-symbols-outlined">description</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="redact-main">
        <section className="redact-controls" aria-label="Redaction options">
          <div className="redact-control">
            <span className="redact-label">Redact</span>
            <div className="redact-modes" role="radiogroup" aria-label="What to redact">
              <button
                role="radio"
                aria-checked={scope === 'all'}
                className={`redact-mode${scope === 'all' ? ' on' : ''}`}
                onClick={() => setScope('all')}
              >
                <strong>Everything</strong>
                <span>the whole text</span>
              </button>
              <button
                role="radio"
                aria-checked={scope === 'picked'}
                className={`redact-mode${scope === 'picked' ? ' on' : ''}`}
                onClick={() => setScope('picked')}
              >
                <strong>Only what I pick</strong>
                <span>selections and patterns</span>
              </button>
            </div>
          </div>

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

        {scope === 'picked' && (
          <section className="redact-targets" aria-label="What to redact">
            <div className="redact-target-row">
              <button
                className="redact-primary"
                onClick={redactSelection}
                title="Redact the text highlighted in the source (⌘⏎ / Ctrl+Enter)"
              >
                <span className="material-symbols-outlined">ink_highlighter</span>
                Redact selection
              </button>

              <form
                className="redact-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  addPick(draft, draftIsRegex ? 'regex' : 'literal')
                  setDraft('')
                }}
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={draftIsRegex ? 'pattern, e.g. \\bID-\\d+' : 'a word, name or value to hide'}
                  aria-label="Text or pattern to redact"
                  spellCheck={false}
                />
                <label className="redact-toggle" title="Treat what you type as a regular expression">
                  <input
                    type="checkbox"
                    checked={draftIsRegex}
                    onChange={(event) => setDraftIsRegex(event.target.checked)}
                  />
                  <span>regex</span>
                </label>
                <button type="submit" disabled={!draft.trim()}>
                  Add
                </button>
              </form>

              <label className="redact-toggle" title="Match capital letters exactly">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) => setCaseSensitive(event.target.checked)}
                />
                <span>match case</span>
              </label>
            </div>

            <div className="redact-target-row">
              <span className="redact-label">Common</span>
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="redact-preset"
                  onClick={() => addPick(preset.value, 'regex')}
                  title={preset.value}
                >
                  + {preset.label}
                </button>
              ))}
            </div>

            {picks.length > 0 && (
              <ul className="redact-picks">
                {picks.map((pick, i) => {
                  const count = report?.counts[i] ?? 0
                  const error = report?.errors[i] ?? null
                  return (
                    <li
                      key={pick.id}
                      className={`redact-pick${error ? ' bad' : count === 0 ? ' empty' : ''}`}
                    >
                      {pick.kind === 'regex' && <span className="redact-pick-kind">.*</span>}
                      <code>{ellipsis(pick.value, 30)}</code>
                      <span className="redact-pick-count">
                        {error ? 'bad pattern' : count === 0 ? 'no match' : `${count}×`}
                      </span>
                      <button
                        onClick={() => setPicks((prev) => prev.filter((other) => other.id !== pick.id))}
                        aria-label={`Stop redacting ${pick.value}`}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </li>
                  )
                })}
                <li>
                  <button className="redact-clear" onClick={() => setPicks([])}>
                    Clear all
                  </button>
                </li>
              </ul>
            )}

            {picks.length === 0 && (
              <p className="redact-hint">
                Highlight anything in the source and press ⌘⏎ — every occurrence of it goes dark. Or
                add a word, or one of the patterns above.
              </p>
            )}
          </section>
        )}

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
              onKeyDown={onSourceKeyDown}
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
              <span>
                {scope === 'picked'
                  ? `${masked.toLocaleString()} of ${(counts.masked + counts.spaces).toLocaleString()} chars hidden`
                  : `${counts.masked.toLocaleString()} blocks`}
              </span>
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
              {missing > 0 && (
                <p className="redact-alarm">
                  <span className="material-symbols-outlined">warning</span>
                  {missing} of your {picks.length} targets matched nothing — check the spelling, or
                  turn off “match case”.
                </p>
              )}
              {report?.truncated && (
                <p className="redact-alarm">
                  <span className="material-symbols-outlined">warning</span>
                  Too many matches to mask them all — narrow the pattern.
                </p>
              )}
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

function ellipsis(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
