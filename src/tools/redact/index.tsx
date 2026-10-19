import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { ShareDialog } from './components/ShareDialog'
import { MASK_CHARS } from './lib/characters'
import { PRESETS } from './lib/patterns'
import {
  DEFAULT_OPTIONS,
  firstGrapheme,
  isUsableMask,
  leaks,
  measure,
  normalizeMask,
  redactCounted,
  type MatchReport,
  type SpaceMode,
  type Target,
} from './lib/redact'
import { createMatchRunner, MATCH_TIMEOUT_MS, type MatchOutcome, type MatchRunner } from './lib/runner'
import { countKinds, decodeFragment, keepLiterals, type Scheme } from './lib/share'
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

/** A finished sweep and exactly what it swept, so stale results are never mistaken for fresh ones. */
interface Matched {
  text: string
  picks: Pick[]
  caseSensitive: boolean
  outcome: MatchOutcome
}

const spawnWorker = () => new Worker(new URL('./lib/match.worker.ts', import.meta.url), { type: 'module' })

/** U+2588-style code points, so an invisible or look-alike mask shows itself. */
const codePoints = (text: string) =>
  [...text].map((ch) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

export default function RedactTool() {
  const [text, setText] = useState('')
  const [mask, setMask] = useState(DEFAULT_OPTIONS.mask)
  const [spaces, setSpaces] = useState<SpaceMode>(DEFAULT_OPTIONS.spaces)
  const [scope, setScope] = useState<Scope>('all')
  const [picks, setPicks] = useState<Pick[]>([])
  const [draft, setDraft] = useState('')
  const [draftIsRegex, setDraftIsRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [arrived, setArrived] = useState<{ patterns: number; literals: number; mask: string } | null>(null)
  const [matched, setMatched] = useState<Matched | null>(null)

  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const nextId = useRef(0)
  const runnerRef = useRef<MatchRunner | null>(null)
  const picksRef = useRef(picks)
  picksRef.current = picks

  useEffect(() => {
    const runner = createMatchRunner(spawnWorker, MATCH_TIMEOUT_MS)
    runnerRef.current = runner
    return () => {
      runnerRef.current = null
      runner.dispose()
    }
  }, [])

  const scheme: Scheme = useMemo(
    () => ({ mask: normalizeMask(mask), spaces, scope, caseSensitive, targets: picks }),
    [mask, spaces, scope, caseSensitive, picks],
  )

  const applyScheme = (next: Scheme) => {
    setMask(next.mask)
    setSpaces(next.spaces)
    setScope(next.scope)
    setCaseSensitive(next.caseSensitive)
    setPicks(next.targets.map((target) => ({ ...target, id: nextId.current++ })))
  }

  // A shared scheme arrives in the fragment, which never leaves the browser.
  // Nothing runs on arrival: the recipient's text pane is still empty.
  //
  // Also on hashchange — pasting a link into an already-open tab changes only
  // the fragment, which does not reload the page.
  useEffect(() => {
    let alive = true
    const load = () => {
      decodeFragment(location.hash).then((incoming) => {
        if (!alive || !incoming) return
        // a link opened in a tab already in use keeps the terms picked there
        applyScheme(keepLiterals(incoming, picksRef.current))
        setArrived({ ...countKinds(incoming.targets), mask: incoming.mask })
      })
    }
    load()
    window.addEventListener('hashchange', load)
    return () => {
      alive = false
      window.removeEventListener('hashchange', load)
    }
    // deliberately once, on open: later edits should not be overwritten
  }, [])

  const discardScheme = () => {
    setMask(DEFAULT_OPTIONS.mask)
    setSpaces(DEFAULT_OPTIONS.spaces)
    setScope('all')
    setCaseSensitive(false)
    setPicks([])
    setArrived(null)
    history.replaceState(null, '', `${location.pathname}${location.search}`)
  }

  // Grapheme segmentation and a regex sweep over a long paste are not free;
  // deferring keeps typing smooth and lets React drop superseded work.
  const deferred = useDeferredValue(text)
  const options = useMemo(() => ({ mask: normalizeMask(mask), spaces }), [mask, spaces])

  // Patterns come from the user or from a link, so the sweep runs in a worker
  // that is killed after MATCH_TIMEOUT_MS: (a+)+$ costs a message, not the tab.
  useEffect(() => {
    if (scope !== 'picked') return
    let alive = true
    const sent = { text: deferred, picks, caseSensitive }
    void runnerRef.current
      ?.run({ text: deferred, targets: picks.map(({ kind, value }) => ({ kind, value })), caseSensitive })
      .then((outcome) => alive && setMatched({ ...sent, outcome }))
    return () => {
      alive = false
    }
  }, [scope, deferred, picks, caseSensitive])

  const fresh =
    matched !== null && matched.text === deferred && matched.picks === picks && matched.caseSensitive === caseSensitive
  const timedOut = scope === 'picked' && fresh && matched.outcome.timedOut ? matched.outcome : null
  // The last finished sweep, paired with the text it swept. While a newer one
  // runs after an edit to the text, the output shows that pair (never old
  // ranges over new text) and cannot be copied. After a change to the picks
  // it shows nothing: the old sweep may mask less than the new one will.
  const report: MatchReport | null =
    scope === 'picked' && matched && !matched.outcome.timedOut && matched.picks === picks && matched.caseSensitive === caseSensitive
      ? matched.outcome.report
      : null
  const shown = scope === 'picked' ? (report ? matched!.text : '') : deferred
  const ranges = useMemo(
    () => (scope === 'picked' ? (report?.ranges ?? []) : [{ start: 0, end: shown.length }]),
    [scope, report, shown.length],
  )

  const { output, hidden } = useMemo(() => redactCounted(shown, ranges, options), [shown, ranges, options])
  const ready = scope === 'all' || (fresh && !timedOut)
  const counts = useMemo(() => measure(deferred), [deferred])
  const notes = useMemo(
    () => (deferred.trim() ? leaks(deferred, options, scope === 'picked') : []),
    [deferred, options, scope],
  )

  const reportFor = (pick: Pick) => {
    if (!report || !matched) return null
    const i = matched.picks.findIndex((other) => other.id === pick.id)
    return i < 0 ? null : { count: report.counts[i] ?? 0, error: report.errors[i] ?? null }
  }
  const missing = report && fresh ? report.counts.filter((count, i) => count === 0 && !!picks[i]?.value).length : 0
  const slowPick = timedOut && timedOut.culprit !== null ? matched!.picks[timedOut.culprit] : null
  const maskRejected = mask !== '' && !isUsableMask(firstGrapheme(mask))

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
          <span className="material-symbols-outlined" aria-hidden>description</span>
        </button>
        <button
          onClick={() => setSharing(true)}
          aria-label="Share this scheme"
          title="Share these settings and patterns — never your text"
        >
          <span className="material-symbols-outlined" aria-hidden>share</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="redact-main">
        {arrived && (
          <div className="redact-arrived" role="status">
            <span className="material-symbols-outlined" aria-hidden>download_done</span>
            <p>
              Loaded a shared scheme — {arrived.patterns} pattern
              {arrived.patterns === 1 ? '' : 's'}
              {arrived.literals > 0 && `, ${arrived.literals} term${arrived.literals === 1 ? '' : 's'}`}
              , mask <code className="redact-arrived-mask">{arrived.mask}</code> ({codePoints(arrived.mask)})
              . Your text stays yours; nothing came with it.
            </p>
            <button onClick={() => setArrived(null)}>Keep</button>
            <button onClick={discardScheme}>Discard</button>
          </div>
        )}

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
              <label className="redact-custom" title="Any single visible character, including an emoji">
                <span>own</span>
                <input
                  type="text"
                  value={mask}
                  onChange={(event) => setMask(event.target.value)}
                  aria-label="Custom mask character"
                  aria-invalid={maskRejected}
                  aria-describedby={maskRejected ? 'redact-mask-note' : undefined}
                  spellCheck={false}
                />
              </label>
            </div>
            {maskRejected && (
              <span id="redact-mask-note" className="redact-mask-note" role="status">
                Not usable as a mask (invisible, a control character, or longer than one short
                character) — using {options.mask}.
              </span>
            )}
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
                <span className="material-symbols-outlined" aria-hidden>ink_highlighter</span>
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
                {picks.map((pick) => {
                  const result = reportFor(pick)
                  const count = result?.count ?? 0
                  const error = result?.error ?? null
                  const slow = slowPick?.id === pick.id
                  return (
                    <li
                      key={pick.id}
                      className={`redact-pick${error || slow ? ' bad' : result && count === 0 ? ' empty' : ''}`}
                    >
                      {pick.kind === 'regex' && <span className="redact-pick-kind">.*</span>}
                      <code>{ellipsis(pick.value, 30)}</code>
                      <span className="redact-pick-count">
                        {slow ? 'too slow' : error ? 'bad pattern' : !result ? '…' : count === 0 ? 'no match' : `${count}×`}
                      </span>
                      <button
                        onClick={() => setPicks((prev) => prev.filter((other) => other.id !== pick.id))}
                        aria-label={`Stop redacting ${pick.value}`}
                      >
                        <span className="material-symbols-outlined" aria-hidden>close</span>
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
                <span className="material-symbols-outlined" aria-hidden>close</span>
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
                  ? ready
                    ? `${hidden.toLocaleString()} of ${(counts.masked + counts.spaces).toLocaleString()} chars hidden`
                    : timedOut
                      ? 'stopped'
                      : 'matching…'
                  : `${counts.masked.toLocaleString()} blocks`}
              </span>
              <button
                onClick={() => copy(output, 'Redacted text')}
                disabled={!output || !ready}
                aria-label="Copy redacted text"
                title={ready ? 'Copy the redacted text' : 'Wait for the patterns to finish'}
              >
                <span className="material-symbols-outlined" aria-hidden>content_copy</span>
              </button>
            </header>
            <textarea
              className={`redact-output mono${ready ? '' : ' stale'}`}
              value={output}
              readOnly
              spellCheck={false}
              aria-label="Redacted text"
              placeholder="The blocks appear here as you type."
            />
            <footer className="redact-foot">
              {timedOut && (
                <p className="redact-alarm" role="alert">
                  <span className="material-symbols-outlined" aria-hidden>warning</span>
                  {slowPick ? `“${ellipsis(slowPick.value, 30)}”` : 'A pattern'} took longer than{' '}
                  {MATCH_TIMEOUT_MS / 1000} s on this text and was stopped, so nothing is shown. Remove
                  or simplify it — nested repeats like (a+)+ are the usual cause.
                </p>
              )}
              {missing > 0 && (
                <p className="redact-alarm">
                  <span className="material-symbols-outlined" aria-hidden>warning</span>
                  {missing} of your {picks.length} targets matched nothing — check the spelling, or
                  turn off “match case”.
                </p>
              )}
              {report?.truncated && (
                <p className="redact-alarm">
                  <span className="material-symbols-outlined" aria-hidden>warning</span>
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

      {sharing && (
        <ShareDialog
          scheme={scheme}
          onApply={applyScheme}
          onClose={() => setSharing(false)}
          copy={copy}
          showToast={showToast}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}

function ellipsis(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
