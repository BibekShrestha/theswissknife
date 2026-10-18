import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { ExplainPanel, ErrorPointer } from './components/ExplainPanel'
import { ShareDialog } from './components/ShareDialog'
import { TestsPanel, type EditableCase } from './components/TestsPanel'
import { toConstructor, toLiteral, toReplaceCall } from './copyjs'
import type { SubjectEditorHandle } from './editor/SubjectEditor'
import { computeHighlights, GROUP_TINTS, matchAt } from './highlight'
import { MAX_MATCHES, REGEX_TIMEOUT_MS } from './javascript'
import { createRegexRunner, createTestsRunner } from './runner'
import { decodeFragment, FLAG_ORDER, type LabState } from './share'
import { explainPattern } from './syntax/explain'
import { parseRegex } from './syntax/parser'
import { findBacktrackRisks } from './syntax/redos'
import type { MatchSpan, RegexOperation, RegexResult, TestsResult } from './types'
import './regex.css'

const SubjectEditor = lazy(() => import('./editor/SubjectEditor'))

const FLAG_INFO: Record<string, string> = {
  d: 'd — hasIndices: start and end of every group. The lab always computes them; this matters in copied code.',
  g: 'g — global: every match, not just the first',
  i: 'i — ignore case',
  m: 'm — multiline: ^ and $ match at line breaks',
  s: 's — dotAll: . also matches line breaks',
  u: 'u — unicode: code points, \\p{…}, strict syntax',
  v: 'v — unicodeSets: u plus class set operations (&&, --) and \\q{…}',
  y: 'y — sticky: a match must start exactly at lastIndex',
}

const SAMPLE = 'The Swiss Knife — local by design ✓\nFor more info, visit https://theswissknife.com'
const SAMPLE_STATE = { pattern: '(?<word>\\p{Lu}\\p{Ll}+)', flags: 'gu', replacement: '[$<word>]' }

type Tab = 'matches' | 'output' | 'tests' | 'explain' | 'js'

const emptyResult: RegexResult = {
  engine: 'javascript',
  version: 'ECMAScript',
  matches: [],
  replacement: null,
  elapsedMs: 0,
  error: null,
  truncated: false,
}

const PREVIEW = 400
/** Half of a surrogate pair, which a pattern without u or v can match on its own. */
const LONE_SURROGATE = new RegExp('[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]', 'g')
const showLone = (text: string) => text.replace(LONE_SURROGATE, (half) => `\\u${half.charCodeAt(0).toString(16).toUpperCase()}`)
const clip = (text: string) => showLone(text.length > PREVIEW ? `${text.slice(0, PREVIEW)}… (${(text.length - PREVIEW).toLocaleString('en-US')} more)` : text)

function modeSummary(flags: string): string {
  const g = flags.includes('g')
  const y = flags.includes('y')
  if (g && y) return 'gy: consecutive matches from index 0, stopping at the first gap'
  if (g) return 'g: every match'
  if (y) return 'y: one match, only at index 0'
  return 'first match only (add g for all)'
}

const spawnWorker = () => new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' })

export default function RegexTool() {
  const [operation, setOperation] = useState<RegexOperation>('match')
  const [pattern, setPattern] = useState(SAMPLE_STATE.pattern)
  const [flags, setFlags] = useState(SAMPLE_STATE.flags)
  const [subject, setSubject] = useState(SAMPLE)
  const [replacement, setReplacement] = useState(SAMPLE_STATE.replacement)
  const [cases, setCases] = useState<EditableCase[]>([])
  const [tab, setTab] = useState<Tab>('matches')
  const [result, setResult] = useState<{ result: RegexResult; subject: string; key: string }>({ result: emptyResult, subject: SAMPLE, key: '' })
  const [tests, setTests] = useState<{ result: TestsResult; key: string } | null>(null)
  const [sharing, setSharing] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const runnerRef = useRef<ReturnType<typeof createRegexRunner>>(null)
  const testsRunnerRef = useRef<ReturnType<typeof createTestsRunner>>(null)
  const editorRef = useRef<SubjectEditorHandle>(null)
  const nextCaseId = useRef(1)

  useEffect(() => {
    const runner = createRegexRunner(spawnWorker, REGEX_TIMEOUT_MS)
    const testsRunner = createTestsRunner(spawnWorker, REGEX_TIMEOUT_MS)
    runnerRef.current = runner
    testsRunnerRef.current = testsRunner
    return () => {
      runnerRef.current = null
      testsRunnerRef.current = null
      runner.dispose()
      testsRunner.dispose()
    }
  }, [])

  const applyState = useCallback((state: LabState) => {
    setPattern(state.pattern)
    setFlags(state.flags)
    setOperation(state.operation)
    setReplacement(state.replacement)
    setSubject(state.subject ?? '')
    setCases((state.cases ?? []).map((c) => ({ ...c, id: nextCaseId.current++ })))
    setTab(state.cases?.length ? 'tests' : state.operation === 'replace' ? 'output' : 'matches')
  }, [])

  // A shared link arrives in the fragment, which never leaves the browser.
  // Also on hashchange: pasting a link into an open tab does not reload it.
  useEffect(() => {
    let alive = true
    const load = () => {
      void decodeFragment(location.hash).then((incoming) => {
        if (!alive || !incoming) return
        applyState(incoming)
        showToast(incoming.subject === undefined ? 'Loaded a shared pattern (no subject)' : 'Loaded a shared pattern')
      })
    }
    load()
    window.addEventListener('hashchange', load)
    return () => {
      alive = false
      window.removeEventListener('hashchange', load)
    }
  }, [applyState, showToast])

  const matchKey = `${operation}\u0000${flags}\u0000${pattern}\u0000${replacement}`

  // Every evaluation runs in a worker the runner kills on timeout, so a
  // catastrophic pattern costs a few seconds and an error message.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const sent = subject
      void runnerRef.current
        ?.run({ engines: ['javascript'], pattern, flags, subject: sent, operation, replacement })
        .then((next) => setResult({ result: next, subject: sent, key: matchKey }))
    }, 150)
    return () => clearTimeout(timer)
  }, [pattern, flags, subject, operation, replacement, matchKey])

  const casesKey = useMemo(() => JSON.stringify([pattern, flags, cases.map((c) => [c.text, c.expect, c.full])]), [pattern, flags, cases])
  useEffect(() => {
    if (cases.length === 0) return
    const timer = window.setTimeout(() => {
      const key = casesKey
      void testsRunnerRef.current
        ?.run({ kind: 'tests', pattern, flags, cases: cases.map(({ text, expect, full }) => ({ text, expect, full })) })
        .then((next) => setTests({ result: next, key }))
    }, 150)
    return () => clearTimeout(timer)
  }, [casesKey, pattern, flags, cases])

  const parsed = useMemo(() => parseRegex(pattern, flags), [pattern, flags])
  const tree = useMemo(() => (parsed.ok ? explainPattern(pattern, parsed.pattern, flags) : null), [parsed, pattern, flags])
  const risks = useMemo(() => (parsed.ok ? findBacktrackRisks(pattern, parsed.pattern, flags) : []), [parsed, pattern, flags])

  const current = result.result
  const fresh = result.key === matchKey
  const timedOut = !!current.error && current.error.startsWith('Stopped after')
  const engineError = fresh && current.error && !timedOut ? current.error : null
  const ranges = useMemo(() => (result.subject === subject ? computeHighlights(result.subject, current.matches) : null), [result.subject, subject, current.matches])
  const matches: MatchSpan[] = current.matches
  const cursorMatch = cursor >= 0 && result.subject === subject ? matchAt(matches, cursor) : -1

  const groups = parsed.ok ? parsed.pattern.groups : []

  const toggleFlag = (flag: string) => {
    setFlags((prev) => {
      let next = prev.includes(flag) ? prev.replace(flag, '') : prev + flag
      if (flag === 'u' && next.includes('u')) next = next.replace('v', '')
      if (flag === 'v' && next.includes('v')) next = next.replace('u', '')
      return [...FLAG_ORDER].filter((f) => next.includes(f)).join('')
    })
  }

  const reset = () => {
    setSubject(SAMPLE)
    setPattern(SAMPLE_STATE.pattern)
    setFlags(SAMPLE_STATE.flags)
    setOperation('match')
    setReplacement(SAMPLE_STATE.replacement)
    setCases([])
    if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`)
  }

  const addCase = () => {
    setCases((prev) => [...prev, { id: nextCaseId.current++, text: '', expect: 'match', full: false }])
    setTab('tests')
  }

  const testsFresh = tests !== null && tests.key === casesKey
  const passing = tests && !tests.result.error ? tests.result.results.filter((r) => r.pass).length : 0
  const shareState: LabState = { pattern, flags, operation, replacement, subject, cases: cases.map(({ text, expect, full }) => ({ text, expect, full })) }

  const tabs: [Tab, string][] = [
    ['matches', `Matches${fresh && !current.error ? ` (${matches.length.toLocaleString('en-US')}${current.truncated ? '+' : ''})` : ''}`],
    ...(operation === 'replace' ? [['output', 'Output'] as [Tab, string]] : []),
    ['tests', `Tests${cases.length ? ` (${testsFresh && !tests.result.error ? `${passing}/${cases.length}` : cases.length})` : ''}`],
    ['explain', 'Explain'],
    ['js', 'JS'],
  ]
  const activeTab = tab === 'output' && operation !== 'replace' ? 'matches' : tab

  return (
    <div className="regex-app">
      <ToolHeader brand={<><span className="tool-mark-accent">.*</span> Regex lab</>} localLabel="local matching">
        <button onClick={() => setSharing(true)} aria-label="Share link" title="Share the pattern as a link (the subject only if you choose)">
          <span className="material-symbols-outlined" aria-hidden>share</span>
        </button>
        <button onClick={() => void copy(toLiteral(pattern, flags), 'JavaScript regex')} aria-label="Copy as JavaScript" title="Copy as a JavaScript regex literal">
          <span className="material-symbols-outlined" aria-hidden>javascript</span>
        </button>
        <button onClick={reset} aria-label="Reset to sample" title="Reset to the sample pattern and subject">
          <span className="material-symbols-outlined" aria-hidden>auto_fix_high</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="regex-main">
        <section className="regex-controls" aria-label="Regex settings">
          <select value={operation} onChange={(event) => setOperation(event.target.value as RegexOperation)} aria-label="Operation">
            <option value="match">Match</option>
            <option value="replace">Replace</option>
          </select>
          <div className="regex-pattern-row">
            <span className="regex-slash" aria-hidden>/</span>
            <input
              type="text"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="Pattern"
              spellCheck={false}
              autoComplete="off"
              aria-label="Regex pattern"
              aria-invalid={!!engineError}
              aria-describedby="regex-pattern-status"
            />
            <span className="regex-slash" aria-hidden>/</span>
            <div className="regex-flags" role="group" aria-label="Flags">
              {[...FLAG_ORDER].map((flag) => (
                <button
                  key={flag}
                  className={`regex-flag-btn${flags.includes(flag) ? ' on' : ''}`}
                  onClick={() => toggleFlag(flag)}
                  aria-pressed={flags.includes(flag)}
                  title={FLAG_INFO[flag]}
                  aria-label={FLAG_INFO[flag]}
                >
                  {flag}
                </button>
              ))}
            </div>
          </div>
          {operation === 'replace' && (
            <label className="regex-replacement-row">
              <span>Replace with</span>
              <input type="text" value={replacement} onChange={(event) => setReplacement(event.target.value)} spellCheck={false} placeholder="$1, $<name>, $&, $$" />
            </label>
          )}
        </section>

        <div id="regex-pattern-status" className="regex-status-area">
          {engineError ? (
            <div className="regex-error" role="alert">
              <strong>The engine rejects this:</strong> {engineError}
              {!parsed.ok && <ErrorPointer pattern={pattern} index={parsed.error.index} message={parsed.error.message} />}
            </div>
          ) : timedOut ? (
            <div className="regex-error" role="alert">{current.error}</div>
          ) : risks.length > 0 ? (
            <div className="regex-warn" role="status">
              <span className="material-symbols-outlined" aria-hidden>warning</span>
              <span>
                Likely catastrophic backtracking: {risks[0].message} It still runs, in a worker stopped after {REGEX_TIMEOUT_MS / 1000} s.{' '}
                <button className="regex-link" onClick={() => setTab('explain')}>Explain</button>
              </span>
            </div>
          ) : null}
        </div>

        <div className="regex-panes">
          <section className="regex-pane" aria-label="Subject">
            <div className="regex-pane-header">
              <span className="regex-label">Subject</span>
              <span className="regex-muted">{subject.length.toLocaleString('en-US')} chars</span>
              {fresh && current.truncated && (
                <span className="regex-muted" title="The worker stops collecting matches at this cap">
                  · first {MAX_MATCHES.toLocaleString('en-US')} matches highlighted
                </span>
              )}
              <div className="spacer" />
              <button className="regex-icon-btn" onClick={() => setSubject('')} disabled={!subject} aria-label="Clear subject" title="Clear subject">
                <span className="material-symbols-outlined" aria-hidden>close</span>
              </button>
            </div>
            <div className="regex-editor">
              <Suspense fallback={<div className="regex-editor-loading">Loading editor…</div>}>
                <SubjectEditor ref={editorRef} value={subject} onChange={setSubject} ranges={ranges} matches={matches} onCursor={setCursor} />
              </Suspense>
            </div>
            <div className="regex-cursor-info">
              {cursorMatch >= 0 ? (
                <CursorInfo match={matches[cursorMatch]} index={cursorMatch} />
              ) : (
                <span className="regex-muted">{matches.length ? 'Hover or click a highlight to see its groups.' : '\u00a0'}</span>
              )}
            </div>
            {groups.length > 0 && (
              <div className="regex-legend" aria-label="Group colours">
                <span className="regex-legend-item"><i className="regex-swatch regex-hl-m0" />match</span>
                {groups.slice(0, 12).map((g) => (
                  <span key={g.index} className="regex-legend-item">
                    <i className={`regex-swatch regex-hl-g regex-hl-g${(g.index - 1) % GROUP_TINTS}`} />${g.index}{g.name ? ` ${g.name}` : ''}
                  </span>
                ))}
                {groups.length > 12 && <span className="regex-muted">+{groups.length - 12} more</span>}
              </div>
            )}
          </section>

          <section className="regex-pane regex-results-pane" aria-label="Results">
            <div className="regex-tabs" role="tablist" aria-label="Result views">
              {tabs.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={activeTab === id} className={`regex-tab${activeTab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="regex-tab-body" role="tabpanel">
              {activeTab === 'matches' && (
                <MatchesView
                  result={current}
                  flags={flags}
                  stale={!fresh || result.subject !== subject}
                  onSelect={(m) => editorRef.current?.select(m.start, m.end)}
                  copy={copy}
                />
              )}
              {activeTab === 'output' && (
                <div className="regex-output">
                  <div className="regex-section-head">
                    <span className="regex-muted">Replacement result</span>
                    <div className="spacer" />
                    <button className="regex-icon-btn" disabled={current.replacement === null} onClick={() => void copy(current.replacement ?? '', 'Output')} aria-label="Copy output" title="Copy output">
                      <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                    </button>
                  </div>
                  {current.error ? <p className="regex-muted">No output: {current.error}</p> : <pre>{current.replacement}</pre>}
                </div>
              )}
              {activeTab === 'tests' && (
                <TestsPanel cases={cases} result={tests?.result ?? null} pending={!testsFresh} onChange={setCases} onAdd={addCase} />
              )}
              {activeTab === 'explain' && <ExplainPanel pattern={pattern} parsed={parsed} tree={tree} risks={risks} engineError={engineError} />}
              {activeTab === 'js' && (
                <div className="regex-code">
                  {([
                    ['Literal', toLiteral(pattern, flags)],
                    ['Constructor', toConstructor(pattern, flags)],
                    ...(operation === 'replace' ? [['Replace', toReplaceCall(pattern, flags, replacement)]] : []),
                  ] as [string, string][]).map(([label, code]) => (
                    <div key={label} className="regex-code-block">
                      <div className="regex-section-head">
                        <span className="regex-label">{label}</span>
                        <div className="spacer" />
                        <button className="regex-icon-btn" onClick={() => void copy(code, `${label} code`)} aria-label={`Copy ${label.toLowerCase()} code`} title="Copy">
                          <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                        </button>
                      </div>
                      <pre>{code}</pre>
                    </div>
                  ))}
                  <p className="regex-muted">Both build exactly this pattern with these flags: slashes and line breaks are escaped for the literal.</p>
                </div>
              )}
            </div>
            <div className="regex-results-foot">
              <span>{fresh && !current.error ? modeSummary(flags) : '\u00a0'}</span>
              <div className="spacer" />
              <span>{current.elapsedMs.toFixed(1)} ms</span>
            </div>
          </section>
        </div>
      </main>
      {sharing && <ShareDialog state={shareState} onClose={() => setSharing(false)} copy={(text, what) => void copy(text, what)} />}
      <Toast message={toast} />
    </div>
  )
}

function CursorInfo({ match, index }: { match: MatchSpan; index: number }) {
  return (
    <span className="regex-cursor-line">
      <strong>Match {index + 1}</strong> {match.start}–{match.end}
      {match.captures.map((c) => (
        <span key={c.index} className={`regex-cap-chip regex-hl-g regex-hl-g${(c.index - 1) % GROUP_TINTS}`}>
          ${c.index}{c.name ? ` ${c.name}` : ''}: {c.start === null ? '—' : `${c.start}–${c.end} "${clip(c.text ?? '').slice(0, 40)}"`}
        </span>
      ))}
    </span>
  )
}

interface MatchesViewProps {
  result: RegexResult
  flags: string
  stale: boolean
  onSelect: (match: MatchSpan) => void
  copy: (text: string, what: string) => Promise<void>
}

function MatchesView({ result, flags, stale, onSelect, copy }: MatchesViewProps) {
  if (result.error) return <p className="regex-muted regex-pad">No matches: the pattern did not run.</p>
  if (result.matches.length === 0) return <p className="regex-muted regex-pad">{stale ? 'Matching…' : 'No matches.'}</p>
  return (
    <div className={`regex-results${stale ? ' stale' : ''}`}>
      <div className="regex-section-head">
        <span>
          {result.matches.length.toLocaleString('en-US')} match{result.matches.length === 1 ? '' : 'es'}
          {!flags.includes('g') && ' (first only)'}
        </span>
        <div className="spacer" />
        <button className="regex-icon-btn" onClick={() => void copy(JSON.stringify(result.matches, null, 2), 'Matches as JSON')} aria-label="Copy all matches as JSON" title="Copy all matches as JSON">
          <span className="material-symbols-outlined" aria-hidden>content_copy</span>
        </button>
      </div>
      {result.truncated && (
        <p className="regex-truncated" role="status">
          Showing the first {MAX_MATCHES.toLocaleString('en-US')} matches — the pattern matches more. Narrow it or shorten the subject to see the rest.
        </p>
      )}
      <ol className="regex-match-list">
        {result.matches.map((match, index) => (
          <li className="regex-match" key={index}>
            <div className="regex-match-head">
              <button className="regex-match-index" onClick={() => onSelect(match)} title="Select in subject">#{index + 1}</button>
              <span className="regex-muted">{match.start}–{match.end}{match.start === match.end ? ' · empty' : ''}</span>
              <div className="spacer" />
              <button className="regex-icon-btn" onClick={() => void copy(match.text, 'Match')} aria-label={`Copy match ${index + 1}`} title="Copy match">
                <span className="material-symbols-outlined" aria-hidden>content_copy</span>
              </button>
            </div>
            {match.text === '' ? (
              <span className="regex-match-text regex-muted">(empty match \u2014 a caret marks it in the subject)</span>
            ) : (
              <code className={`regex-match-text regex-hl-m${index % 2}`}>{clip(match.text)}</code>
            )}
            {match.captures.length > 0 && (
              <dl className="regex-captures">
                {match.captures.map((capture) => (
                  <div key={capture.index} className="regex-capture">
                    <dt><i className={`regex-swatch regex-hl-g regex-hl-g${(capture.index - 1) % GROUP_TINTS}`} />${capture.name ?? capture.index}</dt>
                    <dd className="regex-muted">{capture.start === null ? '' : `${capture.start}–${capture.end}`}</dd>
                    <dd>{capture.text === null ? <span className="regex-muted">did not participate</span> : <code>{capture.text === '' ? '(empty)' : clip(capture.text)}</code>}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
