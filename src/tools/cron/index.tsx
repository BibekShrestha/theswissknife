import { useEffect, useMemo, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { DAY_NAMES, describeCron, describeField } from './describe'
import { nextRuns, type NextRunsResult, type WallTime } from './next'
import { FIELDS, MACROS, parseCron } from './parse'
import './cron.css'

type SupportedValues = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const zones = (Intl as SupportedValues).supportedValuesOf?.('timeZone') ?? ['UTC', localZone]
const COUNTS = [5, 10, 25, 50]

const EXAMPLES: [string, string][] = [
  ['*/15 9-17 * * 1-5', 'work hours'],
  ['0 9 * * MON-FRI', 'weekday mornings'],
  ['30 2 * * *', 'nightly'],
  ['0 0 1 * *', 'monthly'],
  ['0 0 13 * 5', 'Friday or the 13th'],
  ['@weekly', 'macro'],
  ['0 0 30 2 *', 'never'],
]

const pad = (n: number) => String(n).padStart(2, '0')
const wallText = (w: WallTime, weekday: number) =>
  `${DAY_NAMES[weekday].slice(0, 3)} ${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function relative(ms: number, now: number): string {
  const diff = Math.max(0, ms - now)
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'in under a minute'
  if (minutes < 60) return `in ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `in ${hours} h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  if (days < 365) return `in ${days} days`
  const years = Math.floor(days / 365)
  return `in ${years} year${years === 1 ? '' : 's'}`
}

function readHash(): string {
  const match = /^#e=(.*)$/.exec(window.location.hash)
  if (!match) return EXAMPLES[0][0]
  try { return decodeURIComponent(match[1]) } catch { return EXAMPLES[0][0] }
}

export default function CronTool() {
  const [expr, setExpr] = useState(readHash)
  const [zone, setZone] = useState(localZone)
  const [count, setCount] = useState(10)
  const [now, setNow] = useState(() => Date.now())
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#e=')) setExpr(readHash()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const hash = `#e=${encodeURIComponent(expr)}`
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
  }, [expr])

  const parsed = useMemo(() => parseCron(expr), [expr])
  // Recompute at minute granularity so the list rolls forward as runs pass.
  const minute = Math.floor(now / 60000)
  const schedule = useMemo((): { result?: NextRunsResult, error?: string } => {
    if (!parsed.ok) return {}
    try {
      return { result: nextRuns(parsed.cron, zone, minute * 60000 + 59_999, count) }
    } catch {
      return { error: `Unknown time zone "${zone}"` }
    }
  }, [parsed, zone, count, minute])

  const cron = parsed.ok ? parsed.cron : null
  const description = cron ? describeCron(cron) : null
  const tokens = (cron?.normalized ?? expr.trim()).split(/\s+/)
  const errorField = parsed.ok ? null : parsed.error.field

  const runsText = schedule.result?.runs
    .map((run) => `${new Date(run.at).toISOString()}  ${wallText(run.wall, run.weekday)} ${offsetText(run.offsetMinutes)}`)
    .join('\n') ?? ''

  return (
    <div className="cron-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent">*/5</span> Cron explainer</>}
        localLabel={`computed locally · ${zone}`}
      >
        <button onClick={() => void copy(window.location.href, 'Link')}>Copy link</button>
      </ToolHeader>

      <main id="main-content" className="cron-main">
        <section className="cron-input-panel">
          <label htmlFor="cron-expr" className="cron-label">Cron expression</label>
          <input
            id="cron-expr"
            className={`cron-input mono${parsed.ok ? '' : ' cron-input-bad'}`}
            value={expr}
            onChange={(event) => setExpr(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={!parsed.ok}
            aria-describedby="cron-summary"
          />
          <div className="cron-examples" aria-label="Examples">
            {EXAMPLES.map(([value, label]) => (
              <button key={value} type="button" className={value === expr.trim() ? 'active' : ''} onClick={() => setExpr(value)} title={label}>
                <code>{value}</code>
              </button>
            ))}
          </div>
        </section>

        <section className="cron-fields" aria-label="Fields">
          {FIELDS.map((spec, index) => {
            const field = cron?.[spec.name]
            const bad = errorField === index
            return (
              <article key={spec.name} className={`cron-field${bad ? ' cron-field-bad' : ''}`}>
                <span className="cron-field-name">{spec.label}</span>
                <code className="cron-field-source">{tokens.length === 5 ? tokens[index] : '·'}</code>
                <small>{field ? describeField(field) : bad ? 'error' : `${spec.min}–${spec.max}${spec.names ? ' or names' : ''}`}</small>
              </article>
            )
          })}
        </section>

        <section id="cron-summary" className="cron-summary" aria-live="polite">
          {parsed.ok ? (
            <>
              {cron?.macro && <p className="cron-macro"><code>{cron.macro}</code> is shorthand for <code>{cron.normalized}</code></p>}
              <p className="cron-description">{description}</p>
              {cron?.dayOr && (
                <p className="cron-note">
                  <strong>Either day rule matches.</strong> Both day-of-month (<code>{cron.dayOfMonth.source}</code>) and
                  day-of-week (<code>{cron.dayOfWeek.source}</code>) are restricted, so — as in Vixie cron and cronie — a day
                  runs if it matches <em>either</em> one, not both. A field that starts with <code>*</code> (including <code>*/2</code>)
                  counts as unrestricted and switches this off.
                </p>
              )}
            </>
          ) : (
            <div className="cron-error" role="alert">{parsed.error.message}</div>
          )}
        </section>

        <section className="cron-runs" aria-label="Next runs">
          <header className="cron-runs-header">
            <span className="cron-label">Next runs</span>
            <label className="cron-control">
              <span>Show</span>
              <select value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label="Number of runs">
                {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="cron-control cron-zone">
              <span>Time zone</span>
              <select value={zone} onChange={(event) => setZone(event.target.value)} aria-label="Time zone">
                {!zones.includes(localZone) && <option>{localZone}</option>}
                {zones.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <button type="button" disabled={!runsText} onClick={() => void copy(runsText, 'Run times')}>
              <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
            </button>
          </header>

          {schedule.error && <div className="cron-error" role="alert">{schedule.error}</div>}
          {schedule.result?.never && (
            <div className="cron-never" role="status">
              <strong>Never runs.</strong> No date in the next 400 years — a full Gregorian calendar cycle — matches this
              expression, so none ever will (for example, 30 February or 31 April).
            </div>
          )}
          {schedule.result && schedule.result.runs.length > 0 && (
            <ol className="cron-run-list">
              {schedule.result.runs.map((run) => (
                <li key={run.at}>
                  <time dateTime={new Date(run.at).toISOString()} className="mono">{wallText(run.wall, run.weekday)}</time>
                  <span className="cron-offset mono">{offsetText(run.offsetMinutes)}</span>
                  <span className="cron-relative">{relative(run.at, now)}</span>
                  {run.repeated && <span className="cron-badge">repeated hour · runs once</span>}
                </li>
              ))}
              {schedule.result.runs.length < count && !schedule.result.never && (
                <li className="cron-run-more">No further runs in the next 400 years.</li>
              )}
            </ol>
          )}
          {schedule.result && schedule.result.skipped.length > 0 && (
            <div className="cron-skipped">
              <span className="cron-label">Skipped by a clock change</span>
              <ul>
                {schedule.result.skipped.slice(0, 5).map((s) => (
                  <li key={wallText(s.wall, s.weekday)} className="mono">{wallText(s.wall, s.weekday)} — this wall time does not exist in {zone}</li>
                ))}
              </ul>
              {schedule.result.skipped.length > 5 && <small>and {schedule.result.skipped.length - 5} more in the same gap</small>}
            </div>
          )}
        </section>

        <section className="cron-help" aria-label="Syntax and behaviour">
          <div>
            <h2>Syntax</h2>
            <p>
              Five fields: <code>minute hour day-of-month month day-of-week</code>. Each takes <code>*</code>, a value, a list
              (<code>1,15</code>), a range (<code>9-17</code>) or a step (<code>*/15</code>, <code>1-30/5</code>; <code>5/15</code> means
              from 5 to the end of the range). Months and days accept names (<code>JAN</code>, <code>MON-FRI</code>); day-of-week
              0 and 7 are both Sunday. Macros: {Object.keys(MACROS).map((m, i) => <span key={m}>{i > 0 && ', '}<code>{m}</code></span>)}.
              A seconds or year field (Quartz, Spring) and Quartz's <code>L W # ?</code> are not supported.
            </p>
          </div>
          <div>
            <h2>Daylight saving</h2>
            <p>
              Run times follow the wall clock of the chosen zone. A time inside a spring-forward gap does not exist that day, so
              it is listed as skipped and does not run. A time inside a repeated fall-back hour runs once, at its first
              occurrence. Vixie cron and cronie differ for the gap: after a jump of up to 3 hours they typically run the skipped
              fixed-time jobs straight away; this list does not show those catch-up runs.
            </p>
          </div>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
