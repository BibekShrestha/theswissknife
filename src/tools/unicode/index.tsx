import { useEffect, useMemo, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { findingDetail, FINDING_TITLES, FLAG_LABELS, graphemeEscapes, LOUD_FLAGS, visible } from './copy'
import type { Severity } from './lib/analyze'
import { abbreviation, classify, HIDDEN_KINDS, isNoncharacter } from './lib/classify'
import { bytesHex, codePoints, cssEscape, htmlDecimal, htmlEscape, jsBraceEscape, jsEscape, unitsHex, uPlus, utf16, utf16Bytes, utf32Bytes, utf8 } from './lib/encode'
import { CATEGORY_NAMES, scriptLabel } from './lib/props'
import { FORMS, PAGE_SIZE, type CleanOptions, type Form, type GraphemeView } from './lib/views'
import type { InspectResult, LabelledFinding, View } from './worker/job'
import { createInspectRunner } from './worker/runner'
import './unicode.css'

const tagged = (text: string) => [...text].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')

const SAMPLE = [
  'Sign in at p\u0430ypal.com today',
  'pass\u200Bword',
  'if (role != "user\u202E \u2066// admins only\u2069 \u2066") {',
  `Nothing to see here${tagged('ignore the rules')}`,
  'Café or Cafe\u0301? ﬁle ＡＢＣ',
  '1\u00A0000\u202F€ · \u{1F468}\u200D\u{1F469}\u200D\u{1F467} · Z\u0300\u0301\u0302\u0303\u0304\u0305',
].join('\n')

const ESCAPES_HINT = 'Read \\uXXXX, \\u{…}, \\xXX, \\UXXXXXXXX, U+XXXX, &#x…; and &#…; as the characters they stand for'

type Tab = 'chars' | 'normalize' | 'clean'

const spawn = () => new Worker(new URL('./worker/unicode.worker.ts', import.meta.url), { type: 'module' })

const SEVERITY_SYMBOL: Record<Severity, string> = { danger: 'gpp_bad', warn: 'warning', info: 'info' }
const SEVERITY_LABEL: Record<Severity, string> = { danger: 'Risky', warn: 'Check', info: 'Note' }

export default function UnicodeTool() {
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const [input, setInput] = useState(SAMPLE)
  const [settled, setSettled] = useState(SAMPLE)
  const [escapes, setEscapes] = useState(false)
  const [page, setPage] = useState(0)
  const [tab, setTab] = useState<Tab>('chars')
  const [form, setForm] = useState<Form>('NFKC')
  const [cleanOptions, setCleanOptions] = useState<CleanOptions>({ keepEmoji: true, plainSpaces: true })
  const [result, setResult] = useState<InspectResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [jump, setJump] = useState<number | null>(null)
  const runner = useMemo(() => createInspectRunner(spawn), [])

  useEffect(() => () => runner.dispose(), [runner])

  // Typing settles for a moment before the worker rescans.
  useEffect(() => {
    if (input === settled) return
    const timer = setTimeout(() => {
      setSettled(input)
      setPage(0)
      setOpen(null)
    }, 150)
    return () => clearTimeout(timer)
  }, [input, settled])

  const view: View = useMemo(
    () => (tab === 'normalize' ? { kind: 'normalize', form } : tab === 'clean' ? { kind: 'clean', options: cleanOptions } : { kind: 'chars' }),
    [tab, form, cleanOptions],
  )

  useEffect(() => {
    let live = true
    setBusy(true)
    void runner.run({ input: settled, escapes, page, view }).then((outcome) => {
      if (!live || !outcome) return
      setBusy(false)
      if (outcome.ok) {
        setResult(outcome.result)
        setError(null)
      } else {
        setError(outcome.message)
      }
    })
    return () => {
      live = false
    }
  }, [runner, settled, escapes, page, view])

  // After a jump, bring the grapheme into view once its page has arrived.
  useEffect(() => {
    if (jump === null || !result || result.page.index !== Math.floor(jump / PAGE_SIZE)) return
    const row = document.getElementById(`uni-g-${jump}`)
    if (row) {
      row.scrollIntoView({ block: 'center' })
      row.focus({ preventScroll: true })
    }
    setJump(null)
  }, [jump, result])

  const goTo = (grapheme: number) => {
    setTab('chars')
    setPage(Math.floor(grapheme / PAGE_SIZE))
    setOpen(grapheme)
    setJump(grapheme)
  }

  const stats = result?.stats
  return (
    <div className="uni-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined" aria-hidden>language</span> Unicode inspector</>}
        localLabel="runs locally"
      />
      <main id="main-content" className="uni-main">
        <div className="uni-left">
          <section className="uni-pane uni-input" aria-labelledby="uni-input-title">
            <header>
              <h2 id="uni-input-title">Text</h2>
              <label className="uni-check" title={ESCAPES_HINT}>
                <input type="checkbox" checked={escapes} onChange={(event) => { setEscapes(event.target.checked); setPage(0) }} />
                <span>Decode escapes</span>
              </label>
              <button onClick={() => setInput(SAMPLE)} disabled={input === SAMPLE}>Sample</button>
              <button onClick={() => setInput('')} disabled={!input} aria-label="Clear text" title="Clear text">
                <span className="material-symbols-outlined" aria-hidden>close</span>
              </button>
            </header>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              aria-label="Text to inspect"
              placeholder="Paste text to see every character in it"
            />
            {result?.decoded && (
              <p className="uni-note">{result.decoded.decoded.toLocaleString()} escape{result.decoded.decoded === 1 ? '' : 's'} decoded{result.decoded.invalid ? `, ${result.decoded.invalid} above U+10FFFF left as written` : ''}.</p>
            )}
            <dl className="uni-stats" aria-label="Counts">
              <div><dt>Graphemes</dt><dd>{stats ? stats.graphemes.toLocaleString() : '…'}</dd></div>
              <div><dt>Code points</dt><dd>{stats ? stats.codePoints.toLocaleString() : '…'}</dd></div>
              <div><dt>UTF-16 units</dt><dd>{stats ? stats.codeUnits.toLocaleString() : '…'}</dd></div>
              <div><dt>UTF-8 bytes</dt><dd>{stats ? stats.utf8Bytes.toLocaleString() : '…'}</dd></div>
              <div><dt>Lines</dt><dd>{stats ? stats.lines.toLocaleString() : '…'}</dd></div>
            </dl>
          </section>

          <Findings result={result} onJump={goTo} />
        </div>

        <section className="uni-pane uni-results" aria-label="Results">
          <header className="uni-tabs-bar">
            <div className="uni-tabs" role="tablist" aria-label="View">
              {([['chars', 'Characters'], ['normalize', 'Normalise'], ['clean', 'Strip & reveal']] as const).map(([id, label]) => (
                <button key={id} role="tab" id={`uni-tab-${id}`} aria-selected={tab === id} aria-controls="uni-panel" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <span className="uni-busy" aria-live="polite">{busy ? 'Inspecting…' : ''}</span>
          </header>
          <div id="uni-panel" role="tabpanel" aria-labelledby={`uni-tab-${tab}`} className="uni-panel">
            {error && <p className="uni-error" role="alert">{error}</p>}
            {result && tab === 'chars' && (
              <Characters result={result} open={open} setOpen={setOpen} setPage={(p) => { setPage(p); setOpen(null) }} copy={copy} />
            )}
            {result && tab === 'normalize' && <Normalize result={result} form={form} setForm={setForm} copy={copy} />}
            {result && tab === 'clean' && <Clean result={result} options={cleanOptions} setOptions={setCleanOptions} copy={copy} />}
          </div>
          <footer className="uni-sources">
            {result?.names.status === 'ok'
              ? <>Names: Unicode {result.names.version} table, loaded with this tool. </>
              : result ? <>Names didn’t load (open this tool online once to cache them); categories and scripts still work. </> : null}
            Categories and scripts: this browser’s own Unicode data, which can be newer or older than the names table.
          </footer>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}

type Copy = (text: string, what: string) => Promise<void>

function Findings({ result, onJump }: { result: InspectResult | null, onJump: (grapheme: number) => void }) {
  const findings = result?.findings ?? []
  return (
    <section className="uni-pane uni-findings" aria-labelledby="uni-findings-title">
      <header>
        <h2 id="uni-findings-title">Findings</h2>
        <span className="uni-meta">{result ? (findings.length ? `${findings.length} kind${findings.length === 1 ? '' : 's'}` : 'none') : ''}</span>
      </header>
      {result && findings.length === 0 && (
        <p className="uni-empty">
          {result.stats.codeUnits ? 'Nothing hidden or confusable found: no invisible, bidi, tag or control characters, odd spaces, lone surrogates, stray marks or mixed-script words.' : 'Paste some text.'}
        </p>
      )}
      <ul className="uni-finding-list">
        {findings.map((f) => <FindingCard key={f.kind} finding={f} onJump={onJump} />)}
      </ul>
    </section>
  )
}

const SHORT_LIST = 6

function FindingCard({ finding: f, onJump }: { finding: LabelledFinding, onJump: (grapheme: number) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? f.occurrences : f.occurrences.slice(0, SHORT_LIST)
  return (
    <li className={`uni-finding sev-${f.severity}`}>
      <div className="uni-finding-head">
        <span className="material-symbols-outlined" aria-hidden>{SEVERITY_SYMBOL[f.severity]}</span>
        <h3>{FINDING_TITLES[f.kind]}</h3>
        <span className="uni-sev">{SEVERITY_LABEL[f.severity]}</span>
        <span className="uni-count">{f.count.toLocaleString()}</span>
      </div>
      {findingDetail(f).map((line) => <p key={line}>{line}</p>)}
      {f.hidden && (
        <p className="uni-hidden">Hidden text: <bdi><code>{visible(f.hidden)}</code></bdi></p>
      )}
      <ul className="uni-occ">
        {shown.map((o, i) => (
          <li key={`${o.offset}-${i}`}>
            <button onClick={() => onJump(o.grapheme)} title="Show in the character list">
              <span className="uni-occ-pos">#{(o.grapheme + 1).toLocaleString()}</span>
              {f.labels[i] && <span>{f.labels[i]}</span>}
              {o.word && <bdi className="uni-occ-word">“{visible(o.word)}”</bdi>}
              {o.note && <span className="uni-occ-note">{o.note}</span>}
            </button>
          </li>
        ))}
      </ul>
      {f.occurrences.length > SHORT_LIST && (
        <button className="uni-link" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show ${f.occurrences.length - SHORT_LIST} more`}
        </button>
      )}
      {f.count > f.occurrences.length && <p className="uni-note">Listing the first {f.occurrences.length}; {f.count.toLocaleString()} in all.</p>}
    </li>
  )
}

/**
 * What to show where a name would be. Surrogates, private use, noncharacters
 * and unassigned code points have no name by definition; they get the code
 * point labels of Unicode §4.8 (`<surrogate-D800>`).
 */
function missingName(cp: number, gc: string, version: string | null): string {
  const hex = uPlus(cp).slice(2)
  if (gc === 'Cs') return `<surrogate-${hex}>`
  if (gc === 'Co') return `<private-use-${hex}>`
  if (gc === 'Cn') return isNoncharacter(cp) ? `<noncharacter-${hex}>` : `<reserved-${hex}>`
  return version ? `not in the Unicode ${version} names table (newer than it)` : 'name unavailable'
}

/** How a grapheme is drawn in the list: as itself, or as labels when it draws nothing or reorders text. */
function Glyph({ g }: { g: GraphemeView }) {
  const cps = codePoints(g.text)
  const hidden = cps.every((cp) => {
    const kind = classify(cp)
    return kind !== null && HIDDEN_KINDS.has(kind)
  })
  if (hidden || g.text === ' ') {
    return <span className="uni-glyph-label">{cps.slice(0, 3).map((cp) => abbreviation(cp) ?? uPlus(cp)).join(' ')}{cps.length > 3 ? ' …' : ''}</span>
  }
  const startsWithMark = /^\p{M}/u.test(g.text)
  return <bdi className="uni-glyph-text">{startsWithMark ? '◌' : ''}{g.text}</bdi>
}

function Characters({ result, open, setOpen, setPage, copy }: { result: InspectResult, open: number | null, setOpen: (g: number | null) => void, setPage: (p: number) => void, copy: Copy }) {
  const { page } = result
  if (page.total === 0) return <p className="uni-empty">No characters yet.</p>
  const first = page.start + 1
  const last = page.start + page.graphemes.length
  return (
    <>
      <div className="uni-pager">
        <span>
          Graphemes {first.toLocaleString()}–{last.toLocaleString()} of {page.total.toLocaleString()}
          {page.pages > 1 && <> · listed {PAGE_SIZE} at a time</>}
          <span className="uni-meta"> · click a character for its bytes and escapes</span>
        </span>
        {page.pages > 1 && (
          <span className="uni-pager-buttons">
            <button onClick={() => setPage(0)} disabled={page.index === 0} aria-label="First page"><span className="material-symbols-outlined" aria-hidden>first_page</span></button>
            <button onClick={() => setPage(page.index - 1)} disabled={page.index === 0} aria-label="Previous page"><span className="material-symbols-outlined" aria-hidden>chevron_left</span></button>
            <span className="uni-meta">{(page.index + 1).toLocaleString()} / {page.pages.toLocaleString()}</span>
            <button onClick={() => setPage(page.index + 1)} disabled={page.index >= page.pages - 1} aria-label="Next page"><span className="material-symbols-outlined" aria-hidden>chevron_right</span></button>
            <button onClick={() => setPage(page.pages - 1)} disabled={page.index >= page.pages - 1} aria-label="Last page"><span className="material-symbols-outlined" aria-hidden>last_page</span></button>
          </span>
        )}
      </div>
      <div className="uni-colhead" aria-hidden>
        <span>Char</span><span>Code point</span><span>Name</span><span>Category</span><span>Script</span><span>UTF-8</span>
      </div>
      <ol className="uni-list" start={first}>
        {page.graphemes.map((g) => {
          const loud = g.cps.some((cp) => cp.flags.some((flag) => LOUD_FLAGS.has(flag)))
          const isOpen = open === g.index
          return (
            <li key={g.index} id={`uni-g-${g.index}`} tabIndex={-1} className={`uni-g${loud ? ' is-loud' : ''}`}>
              <button
                className="uni-glyph"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} bytes and escapes of grapheme ${(g.index + 1).toLocaleString()}`}
                title={isOpen ? 'Hide bytes & escapes' : 'Bytes & escapes'}
                onClick={() => setOpen(isOpen ? null : g.index)}
              >
                <Glyph g={g} />
              </button>
              <div className="uni-cps">
                {g.cps.map((cp, i) => {
                  const bytes = utf8(cp.cp)
                  return (
                    <div className="uni-cp" key={i}>
                      <code className="uni-u">{uPlus(cp.cp)}</code>
                      <span className="uni-name">
                        {cp.name ?? <span className="uni-muted">{missingName(cp.cp, cp.gc, result.names.status === 'ok' ? result.names.version : null)}</span>}
                        {cp.alias && <span className="uni-muted"> (alias)</span>}
                      </span>
                      <span className="uni-gc" title={CATEGORY_NAMES.get(cp.gc)}><abbr title={CATEGORY_NAMES.get(cp.gc)}>{cp.gc}</abbr><span className="uni-gc-long"> {CATEGORY_NAMES.get(cp.gc)}</span></span>
                      <span className="uni-sc">{scriptLabel(cp.script)}</span>
                      <code className="uni-b">{bytes ? bytesHex(bytes) : '—'}</code>
                      {cp.flags.length > 0 && (
                        <span className="uni-flags">
                          {cp.flags.map((flag) => <span key={flag} className={`uni-flag${LOUD_FLAGS.has(flag) ? ' is-loud' : ''}`}>{FLAG_LABELS[flag]}</span>)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {g.more > 0 && <p className="uni-note">…and {g.more.toLocaleString()} more code points in this grapheme (the first {g.cps.length} are listed).</p>}
                {isOpen && <Details g={g} copy={copy} />}
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

function Details({ g, copy }: { g: GraphemeView, copy: Copy }) {
  const forms = graphemeEscapes(g.text)
  return (
    <div className="uni-details">
      <table>
        <thead>
          <tr><th scope="col">Code point</th><th scope="col">UTF-8</th><th scope="col">UTF-16 units</th><th scope="col">UTF-16LE</th><th scope="col">UTF-32BE</th><th scope="col">HTML</th><th scope="col">JS</th><th scope="col">CSS</th></tr>
        </thead>
        <tbody>
          {g.cps.map((cp, i) => {
            const bytes = utf8(cp.cp)
            return (
              <tr key={i}>
                <th scope="row">{uPlus(cp.cp)}</th>
                <td>{bytes ? bytesHex(bytes) : 'not encodable'}</td>
                <td>{unitsHex(utf16(cp.cp))}</td>
                <td>{utf16Bytes(cp.cp, true)}</td>
                <td>{utf32Bytes(cp.cp, false) ?? 'not encodable'}</td>
                <td>{htmlEscape(cp.cp)} {htmlDecimal(cp.cp)}</td>
                <td>{jsEscape(cp.cp)}{cp.cp > 0xffff ? ` ${jsBraceEscape(cp.cp)}` : ''}</td>
                <td>{cssEscape(cp.cp)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {g.cps.some((cp) => cp.cp >= 0xd800 && cp.cp <= 0xdfff) && (
        <p className="uni-note">A lone surrogate has no UTF-8 or UTF-32 form; encoders write EF BF BD (U+FFFD). HTML and CSS references to it also become U+FFFD.</p>
      )}
      {g.more > 0 && <p className="uni-note">Escapes below cover the whole grapheme, including the code points not listed.</p>}
      <div className="uni-copyrow">
        <span>Copy grapheme as</span>
        {forms.map(([label, value]) => (
          <button key={label} onClick={() => void copy(value, `${label} escape`)}>
            <span className="material-symbols-outlined" aria-hidden>content_copy</span> {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Normalize({ result, form, setForm, copy }: { result: InspectResult, form: Form, setForm: (f: Form) => void, copy: Copy }) {
  const view = result.normalize
  return (
    <div className="uni-norm">
      <div className="uni-seg" role="group" aria-label="Normalisation form">
        {FORMS.map((f) => (
          <button key={f} className={form === f ? 'on' : ''} aria-pressed={form === f} onClick={() => setForm(f)}>
            {f}{view && view.unchanged[f] && <span className="uni-seg-note"> · no change</span>}
          </button>
        ))}
      </div>
      <p className="uni-hint">
        NFC and NFD compose or decompose accents without changing meaning. NFKC and NFKD also fold compatibility forms (ligatures, fullwidth and mathematical letters, superscripts) into plain ones, which can change meaning.
      </p>
      {!view ? <p className="uni-empty">…</p> : (
        <>
          <p className="uni-summary">
            {view.changed === 0
              ? `${view.form} leaves this text unchanged.`
              : `${view.form} changes ${view.changed.toLocaleString()} grapheme${view.changed === 1 ? '' : 's'}: ${view.codePointsBefore.toLocaleString()} → ${view.codePointsAfter.toLocaleString()} code points.`}
            {view.crossesGraphemes && ' Some changes span more than one grapheme, so the output below is the whole text normalised at once.'}
          </p>
          {view.changes.length > 0 && (
            <ul className="uni-changes">
              {view.changes.map((c) => (
                <li key={c.grapheme}>
                  <span className="uni-occ-pos">#{(c.grapheme + 1).toLocaleString()}</span>
                  <bdi className="uni-change-text">{visible(c.before, true)}</bdi>
                  <code>{codePoints(c.before).map(uPlus).join(' ')}</code>
                  <span aria-hidden>→</span><span className="uni-sr">becomes</span>
                  <bdi className="uni-change-text">{visible(c.after, true)}</bdi>
                  <code>{codePoints(c.after).map(uPlus).join(' ')}</code>
                </li>
              ))}
            </ul>
          )}
          {view.changed > view.changes.length && <p className="uni-note">Listing the first {view.changes.length}; {view.changed.toLocaleString()} in all.</p>}
          <Output label={`${view.form} output`} value={view.output} copy={copy} />
        </>
      )}
    </div>
  )
}

function Clean({ result, options, setOptions, copy }: { result: InspectResult, options: CleanOptions, setOptions: (o: CleanOptions) => void, copy: Copy }) {
  const view = result.clean
  return (
    <div className="uni-clean">
      <div className="uni-options">
        <label className="uni-check">
          <input type="checkbox" checked={options.keepEmoji} onChange={(event) => setOptions({ ...options, keepEmoji: event.target.checked })} />
          <span>Keep emoji sequences whole (their ZWJ, VS16, keycaps and tags)</span>
        </label>
        <label className="uni-check">
          <input type="checkbox" checked={options.plainSpaces} onChange={(event) => setOptions({ ...options, plainSpaces: event.target.checked })} />
          <span>Unusual spaces become plain spaces; line and paragraph separators become line feeds</span>
        </label>
      </div>
      {!view ? <p className="uni-empty">…</p> : (
        <>
          <p className="uni-summary">
            Stripped: {view.removed.toLocaleString()} character{view.removed === 1 ? '' : 's'} removed
            {view.replaced ? `, ${view.replaced.toLocaleString()} space${view.replaced === 1 ? '' : 's'} replaced` : ''}.
            {' '}Removes invisible, bidi, tag and control characters, stray variation selectors, byte order marks and lone surrogates. Combining marks and look-alike letters are left as they are — there is no safe automatic fix for them.
          </p>
          <Output label="Stripped text" value={view.stripped} copy={copy} />
          <p className="uni-summary">
            Revealed: {view.revealedCount.toLocaleString()} character{view.revealedCount === 1 ? '' : 's'} written as [labels] — hidden ones by name, tag text as the words it spells, look-alikes with the letter they imitate.
          </p>
          <Output label="Revealed text" value={view.revealed} copy={copy} />
        </>
      )}
    </div>
  )
}

function Output({ label, value, copy }: { label: string, value: string, copy: Copy }) {
  return (
    <div className="uni-output">
      <div className="uni-output-head">
        <strong>{label}</strong>
        <button onClick={() => void copy(value, label)} disabled={!value}>
          <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
        </button>
      </div>
      <textarea value={value} readOnly spellCheck={false} aria-label={label} />
    </div>
  )
}
