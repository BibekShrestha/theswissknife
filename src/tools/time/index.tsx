import { useEffect, useRef, useState } from 'react'
import { Link, navigate, usePath } from '../../shell/router'
import { tools } from '../../shell/registry'
import { useTheme } from '../../shell/theme'
import {
  formatInZone,
  localInputValue,
  parseIsoInput,
  parseLocalDateTime,
  parseTimestamp,
  preciseIso,
  relativeTime,
  type ParsedInstant,
  type TimeUnit,
} from './time'
import './time.css'

type SupportedValues = typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const zones = (Intl as SupportedValues).supportedValuesOf?.('timeZone') ?? ['UTC', localZone]

export default function TimeTool() {
  const initialMs = Date.now()
  const [theme, toggleTheme] = useTheme()
  const [unit, setUnit] = useState<TimeUnit>('auto')
  const [timestamp, setTimestamp] = useState(String(Math.floor(initialMs / 1000)))
  const [iso, setIso] = useState(new Date(initialMs).toISOString())
  const [localValue, setLocalValue] = useState(localInputValue(initialMs))
  const [instant, setInstant] = useState<ParsedInstant>(() => parseTimestamp(String(Math.floor(initialMs / 1000)), 's').value!)
  const [error, setError] = useState<string | null>(null)
  const [zone, setZone] = useState(localZone)
  const [now, setNow] = useState(initialMs)
  const [toast, setToast] = useState('')
  const [converterZones, setConverterZones] = useState<string[]>([localZone !== 'UTC' ? 'UTC' : 'America/New_York'].filter(Boolean))
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const sync = (next: ParsedInstant, source: 'timestamp' | 'iso' | 'local') => {
    setInstant(next)
    setError(null)
    if (source !== 'timestamp') {
      setTimestamp(String(next.milliseconds / 1000))
      setUnit(next.inferredUnit)
    }
    if (source !== 'iso') setIso(preciseIso(next))
    if (source !== 'local') setLocalValue(localInputValue(next.milliseconds))
  }

  const onTimestamp = (raw: string, nextUnit = unit) => {
    setTimestamp(raw)
    const parsed = parseTimestamp(raw, nextUnit)
    if (parsed.error) setError(parsed.error)
    else sync(parsed.value!, 'timestamp')
  }

  const onIso = (raw: string) => {
    setIso(raw)
    const parsed = parseIsoInput(raw)
    if (parsed.error) setError(parsed.error)
    else sync(parsed.value!, 'iso')
  }

  const onLocal = (raw: string) => {
    setLocalValue(raw)
    const parsed = parseLocalDateTime(raw)
    if (parsed.error) setError(parsed.error)
    else sync(parsed.value!, 'local')
  }

  const useNow = () => {
    const ms = Date.now()
    const parsed = parseTimestamp(String(ms), 'ms')
    setUnit('ms')
    setTimestamp(String(ms))
    if (!parsed.error) sync(parsed.value!, 'timestamp')
  }

  const notifyCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setToast(`${label} copied`)
    } catch {
      setToast('Copy failed — clipboard unavailable')
    }
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(''), 4000)
  }

  const addZone = (item: string) => {
    if (!converterZones.includes(item)) setConverterZones([...converterZones, item])
  }
  const removeZone = (item: string) => {
    setConverterZones(converterZones.filter((z) => z !== item))
  }

  const outputs = [
    ['UTC / ISO-8601', preciseIso(instant)],
    ['Local time', new Date(instant.milliseconds).toString()],
    [zone, formatInZone(instant.milliseconds, zone)],
    ['Relative', relativeTime(instant.milliseconds, now)],
  ] as const

  return (
    <div className="time-app">
      <header className="time-top">
        <Link to="/" className="home-link" title="All tools — The Swiss Knife"><span className="material-symbols-outlined">home</span></Link>
        <div className="time-brand"><span>UTC</span> Unix time</div>
        <span className="time-local">browser clock · {localZone}</span>
        <select className="tool-switcher" value={usePath()} onChange={(e) => navigate(`/${e.target.value}`)} aria-label="Switch tool">
          {tools.filter((t) => t.slug !== 'time').map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
        <div className="spacer" />
        <button onClick={useNow}>Use now</button>
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </header>

      <main id="main-content" className="time-main">
        <section className="time-now" aria-label="Current time">
          <span>Right now</span>
          <strong>{Math.floor(now / 1000)}</strong>
          <code>{new Date(now).toISOString()}</code>
          <button className="time-now-copy" onClick={() => void notifyCopy(String(Math.floor(now / 1000)), 'Epoch')} aria-label="Copy epoch time"><span className="material-symbols-outlined">content_copy</span></button>
        </section>

        <section className="time-inputs">
          <label className="time-field">
            <span><b>01</b> Unix timestamp</span>
            <div className="time-timestamp-row">
              <input className="mono" value={timestamp} onChange={(event) => onTimestamp(event.target.value)} inputMode="decimal" spellCheck={false} />
              <select value={unit} onChange={(event) => { const next = event.target.value as TimeUnit; setUnit(next); onTimestamp(timestamp, next) }} aria-label="Timestamp unit">
                <option value="auto">Auto</option><option value="s">seconds</option><option value="ms">milliseconds</option><option value="us">microseconds</option><option value="ns">nanoseconds</option>
              </select>
            </div>
            <small>{unit === 'auto' ? `Detected ${instant.inferredUnit}` : `Reading as ${unit}`}</small>
          </label>

          <label className="time-field">
            <span><b>02</b> ISO-8601</span>
            <input className="mono" value={iso} onChange={(event) => onIso(event.target.value)} spellCheck={false} />
            <small>{parseIsoInput(iso).value?.localAssumed ? 'No offset supplied — interpreted in your browser timezone.' : 'Explicit offset or UTC.'}</small>
          </label>

          <label className="time-field">
            <span><b>03</b> Browser-local date & time</span>
            <input type="datetime-local" step="0.001" value={localValue} onChange={(event) => onLocal(event.target.value)} />
            <small>{localZone}</small>
          </label>
        </section>

        {error && <div className="time-error" role="alert">{error}</div>}

        <section className="time-output-grid" aria-label="Converted times">
          <div className="time-zone-control">
            <label htmlFor="time-zone">Display timezone</label>
            <select id="time-zone" value={zone} onChange={(event) => setZone(event.target.value)}>
              {!zones.includes(localZone) && <option>{localZone}</option>}
              {zones.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          {outputs.map(([label, value]) => (
            <article className="time-output" key={label}>
              <span>{label}</span>
              <code>{value}</code>
              <button onClick={() => void notifyCopy(value, label)} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
            </article>
          ))}
        </section>

        <section className="time-converter" aria-label="Timezone converter">
          <header className="time-converter-header">
            <span className="time-converter-title">Timezone converter</span>
            <label className="time-converter-add">
              <span>Add zone</span>
              <select
                value=""
                onChange={(event) => { const val = event.target.value; if (val) addZone(val); event.target.value = '' }}
                aria-label="Add a timezone"
              >
                <option value="" disabled>Select a zone</option>
                {zones.filter((z) => !converterZones.includes(z)).map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </header>
          <div className="time-converter-grid">
            {converterZones.map((item) => (
              <article className="time-converter-zone" key={item}>
                <span className="time-converter-zone-name">{item}</span>
                <time className="time-converter-zone-time">{formatInZone(instant.milliseconds, item)}</time>
                <button className="time-converter-zone-remove" onClick={() => removeZone(item)} aria-label={`Remove ${item}`}><span className="material-symbols-outlined">close</span></button>
              </article>
            ))}
          </div>
        </section>
      </main>
      <div className="time-status" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}
