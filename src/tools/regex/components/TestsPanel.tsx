import type { TestCase, TestCaseResult, TestsResult } from '../types'

export interface EditableCase extends TestCase {
  id: number
}

interface Props {
  cases: EditableCase[]
  result: TestsResult | null
  /** The result is for an older set of cases or pattern. */
  pending: boolean
  onChange: (cases: EditableCase[]) => void
  onAdd: () => void
}

function detail(testCase: TestCase, result: TestCaseResult): string {
  const found = result.match
  const where = found ? `"${found.text.length > 40 ? `${found.text.slice(0, 40)}…` : found.text}" at ${found.start}–${found.end}` : ''
  if (testCase.full) {
    if (result.matched) return 'the whole line matches'
    return found ? `only part matches: ${where}` : 'no match'
  }
  return found ? `matched ${where}` : 'no match'
}

export function TestsPanel({ cases, result, pending, onChange, onAdd }: Props) {
  const update = (id: number, patch: Partial<TestCase>) => onChange(cases.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const results = result && !result.error && result.results.length === cases.length ? result.results : null
  const passing = results?.filter((r) => r.pass).length ?? 0

  return (
    <div className="regex-tests">
      <div className="regex-tests-summary" role="status">
        {cases.length === 0 ? (
          <span>No test cases yet.</span>
        ) : result?.error ? (
          <span className="regex-bad">{result.error}</span>
        ) : results ? (
          <span className={passing === cases.length ? 'regex-good' : 'regex-bad'}>
            {passing} of {cases.length} passing
          </span>
        ) : (
          <span>Running…</span>
        )}
        {pending && results && <span className="regex-muted">updating…</span>}
        <div className="spacer" />
        <button onClick={onAdd}>
          <span className="material-symbols-outlined" aria-hidden>add</span>
          Add case
        </button>
        {cases.length > 0 && <button onClick={() => onChange([])}>Clear all</button>}
      </div>
      <p className="regex-tests-help">
        Each line is matched on its own from index 0, in a worker with the same deadline as
        the matches. The g flag makes no difference here; y anchors the match at the start of the line.
      </p>
      <ul className="regex-case-list">
        {cases.map((testCase, index) => {
          const r = results?.[index]
          return (
            <li key={testCase.id} className={`regex-case${r ? (r.pass ? ' pass' : ' fail') : ''}`}>
              <select
                value={testCase.expect}
                onChange={(event) => update(testCase.id, { expect: event.target.value as TestCase['expect'] })}
                aria-label={`Case ${index + 1} expectation`}
              >
                <option value="match">Should match</option>
                <option value="no-match">Should not match</option>
              </select>
              <label className="regex-check regex-case-full">
                <input type="checkbox" checked={testCase.full} aria-label={`Case ${index + 1}: the whole line must match`} onChange={(event) => update(testCase.id, { full: event.target.checked })} />
                <span>Full</span>
              </label>
              <input
                type="text"
                value={testCase.text}
                spellCheck={false}
                placeholder="Text to test"
                aria-label={`Case ${index + 1} text`}
                // A freshly added (empty) row takes focus; existing rows never steal it.
                autoFocus={testCase.text === '' && index === cases.length - 1}
                onChange={(event) => update(testCase.id, { text: event.target.value.replace(/\r?\n/g, ' ') })}
              />
              <button className="regex-icon-btn" onClick={() => onChange(cases.filter((c) => c.id !== testCase.id))} aria-label={`Remove case ${index + 1}`}>
                <span className="material-symbols-outlined" aria-hidden>delete</span>
              </button>
              {r && (
                <div className="regex-case-result">
                  <span className="material-symbols-outlined" aria-hidden>{r.pass ? 'check_circle' : 'cancel'}</span>
                  <strong>{r.pass ? 'Pass' : 'Fail'}</strong>
                  <span>{detail(testCase, r)}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
