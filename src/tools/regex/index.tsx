import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { evaluateJavascript, MAX_MATCHES } from './javascript'
import type { RegexEngine, RegexMode, RegexOperation, RegexResult } from './types'
import './regex.css'

const FLAGS_JS = ['g', 'i', 'm', 's', 'u'] as const
const SAMPLE = 'The Swiss Knife — local by design ✓\nFor more info, visit https://theswissknife.com'

const emptyResult: RegexResult = {
  engine: 'javascript',
  version: 'ECMAScript',
  matches: [],
  replacement: null,
  elapsedMs: 0,
  error: null,
  truncated: false,
}

export default function RegexTool() {
  const [mode, setMode] = useState<RegexMode>('javascript')
  const [operation, setOperation] = useState<RegexOperation>('match')
  const [pattern, setPattern] = useState('(?<word>foo+)')
  const [flags, setFlags] = useState('giu')
  const [subject, setSubject] = useState(SAMPLE)
  const [replacement, setReplacement] = useState('[$<word>]')
  const [result, setResult] = useState<RegexResult>(emptyResult)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const debounceRef = useRef<number | undefined>(undefined)

  const engines: RegexEngine[] = useMemo(() => {
    if (mode === 'javascript') return ['javascript']
    if (mode === 'pcre2') return ['pcre2']
    return ['javascript', 'pcre2']
  }, [mode])

  const run = useCallback(() => {
    const started = performance.now()

    if (mode === 'compare') {
      const jsResult = evaluateJavascript({ id: 0, engines: ['javascript'], pattern, flags, subject, operation, replacement })
      const compareText = operation === 'replace'
        ? `JavaScript: "${jsResult.replacement ?? '(error)'}"\n     PCRE2: (not available — see build instructions)`
        : `JavaScript: ${jsResult.matches.length} matches in ${jsResult.elapsedMs.toFixed(1)}ms\n     PCRE2: not available — see build instructions`
      setResult({
        engine: 'javascript',
        version: 'Compare',
        matches: jsResult.matches,
        replacement: compareText,
        elapsedMs: performance.now() - started,
        error: null,
        truncated: jsResult.truncated,
      })
      return
    }

    const res = evaluateJavascript({ id: 0, engines, pattern, flags, subject, operation, replacement })
    setResult(res)
  }, [mode, pattern, flags, subject, operation, replacement, engines])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(run, 150)
    return () => clearTimeout(debounceRef.current)
  }, [run])

  const toggleFlag = (flag: string) => {
    setFlags((prev) => prev.includes(flag) ? prev.replace(flag, '') : prev + flag)
  }

  const matchCount = result.matches.length
  const elapsedText = `${result.elapsedMs.toFixed(1)}ms`

  return (
    <div className="regex-app">
      <ToolHeader
        brand={<><span>.*</span> Regex lab</>}
        localLabel="local matching"
      >
        <button onClick={() => { setSubject(SAMPLE); setPattern('(?<word>foo+)'); setFlags('giu'); setOperation('match'); setReplacement('[$<word>]') }}><span className="material-symbols-outlined">auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="regex-main">
        <section className="regex-controls" aria-label="Regex settings">
          <label>
            <span>Engine</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as RegexMode)}>
              <option value="javascript">JavaScript</option>
              <option value="pcre2">PCRE2</option>
              <option value="compare">Compare</option>
            </select>
          </label>

          <label>
            <span>Op</span>
            <select value={operation} onChange={(event) => setOperation(event.target.value as RegexOperation)}>
              <option value="match">Match</option>
              <option value="replace">Replace</option>
            </select>
          </label>

          <div className="regex-pattern-row">
            <label>
              <span>/</span>
            </label>
            <input
              type="text"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              placeholder="Pattern"
              spellCheck={false}
              aria-label="Regex pattern"
            />
            <span>/</span>
            <div className="regex-flags" role="group" aria-label="Regex flags">
              {FLAGS_JS.map((flag) => (
                <button
                  key={flag}
                  className={`regex-flag-btn${flags.includes(flag) ? ' on' : ''}`}
                  onClick={() => toggleFlag(flag)}
                  aria-pressed={flags.includes(flag)}
                >
                  {flag}
                </button>
              ))}
            </div>
          </div>
        </section>

        {operation === 'replace' && (
          <div className="regex-replacement-row">
            <label htmlFor="regex-replacement">Replacement</label>
            <input id="regex-replacement" type="text" value={replacement} onChange={(event) => setReplacement(event.target.value)} spellCheck={false} placeholder="Replacement string" />
          </div>
        )}

        <div className="regex-panes">
          <div className="regex-pane">
            <div className="regex-pane-header">
              <span>Subject</span>
              <span className="regex-elapsed">{subject.length.toLocaleString()} chars</span>
              <button onClick={() => setSubject('')} disabled={!subject} aria-label="Clear"><span className="material-symbols-outlined">close</span></button>
            </div>
            <textarea
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              spellCheck={false}
              placeholder="Paste test subject here"
              aria-label="Test subject"
            />
          </div>

          <div className="regex-pane">
            <div className="regex-pane-header">
              <span>Results</span>
              <span className="regex-elapsed">{elapsedText}</span>
              {result.truncated && <span className="regex-truncated">truncated ({MAX_MATCHES})</span>}
              <button onClick={() => { setResult(emptyResult) }} aria-label="Clear"><span className="material-symbols-outlined">close</span></button>
              <button onClick={() => void copy(result.replacement ?? JSON.stringify(result.matches, null, 2), 'Result')} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
            </div>
            {result.error ? (
              <div className="regex-error" role="alert">{result.error}</div>
            ) : operation === 'replace' ? (
              <textarea className="regex-pane" value={result.replacement ?? ''} readOnly spellCheck={false} aria-label="Replacement output" />
            ) : matchCount === 0 ? (
              <div className="regex-pane" style={{ padding: '12px', fontSize: '13px', color: 'var(--rgx-muted)' }}>
                No matches
              </div>
            ) : (
              <div className="regex-results" role="log" aria-label={`${matchCount} match${matchCount !== 1 ? 'es' : ''}`}>
                {result.matches.map((match, index) => (
                  <div className="regex-match" key={index}>
                    <div className="regex-match-header">
                      <span>#{index + 1}</span>
                      <span>pos {match.start}–{match.end}</span>
                      <button onClick={() => void copy(match.text, 'Match')} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
                    </div>
                    <code>{match.text}</code>
                    {match.captures.filter((c) => c.text !== null).map((capture) => (
                      <div className="regex-captures" key={capture.index}>
                        <div className="regex-capture">
                          <span>{capture.name ? `$${capture.name}` : `$${capture.index}`}</span>
                          <span>{capture.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <div className="shell-toast" role="status" aria-live="polite">{toast ?? ''}</div>
    </div>
  )
}
