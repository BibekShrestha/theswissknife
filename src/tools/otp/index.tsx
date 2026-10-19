import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { Detail } from './Detail'
import { DEFAULT_SETTINGS, entryTitle, pruneState, toEntries, type Entry, type ManualSettings } from './entries'
import { groupCode, useCodes, useKey, useNow } from './hooks'
import { ALGORITHMS, totpCounter } from './otp'
import { createScanner } from './scan/scan'
import { batchStatus, parseField, parseScanned, type Source } from './sources'
import './otp.css'

/**
 * TOTP & HOTP: codes from a Base32 secret, an otpauth:// URI, a Google
 * Authenticator export or QR images of either. Everything lives in React
 * state — nothing is written to storage or the URL, so a reload forgets it.
 */

interface Scan {
  id: number
  name: string
  status: 'reading' | 'read' | 'failed'
  texts: string[]
  error?: string
}

const EXAMPLES: { label: string; text: string }[] = [
  { label: 'Base32 secret', text: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ' },
  { label: 'otpauth URI', text: 'otpauth://totp/Example:alice@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example' },
  {
    label: 'Authenticator export',
    text: 'otpauth-migration://offline?data=CjgKFDEyMzQ1Njc4OTAxMjM0NTY3ODkwEhFhbGljZUBleGFtcGxlLmNvbRoHRXhhbXBsZSABKAEwAgozCgpIZWxsbyHerb7vEg9ib2JAZXhhbXBsZS5jb20aDEV4YW1wbGUgQmFuayACKAIwATgFEAEYASAAKAA%3D',
  },
]

export default function OtpTool() {
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const [field, setField] = useState('')
  const [reveal, setReveal] = useState(false)
  const [scans, setScans] = useState<Scan[]>([])
  const [settings, setSettings] = useState<ManualSettings>(DEFAULT_SETTINGS)
  const [counters, setCounters] = useState<Record<string, bigint>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [window, setWindow] = useState(1)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const scanner = useRef<ReturnType<typeof createScanner> | null>(null)
  const nextScan = useRef(0)
  const now = useNow()

  useEffect(() => () => scanner.current?.dispose(), [])

  const sources = useMemo<Source[]>(() => [
    ...parseField(field).map((source) => ({ ...source, group: 'field' })),
    ...scans.flatMap((scan) => scan.texts.map((text, i) => ({
      ...parseScanned(text, scan.texts.length > 1 ? `${scan.name} · code ${i + 1}` : scan.name),
      group: `scan:${scan.id}:${i}`,
    }))),
  ], [field, scans])
  const { entries, errors } = useMemo(() => toEntries(sources, settings), [sources, settings])

  // Forget counter edits and the selection of entries that were removed.
  useEffect(() => {
    setCounters((map) => pruneState(map, entries))
    setSelected((id) => (id === null || entries.some((e) => e.id === id) ? id : null))
  }, [entries])
  const batches = useMemo(() => batchStatus(sources.flatMap((s) => (s.kind === 'migration' ? [s.payload] : []))), [sources])
  const hasMigration = sources.some((s) => s.kind === 'migration')
  const hasManual = entries.some((e) => e.manual)

  const active = entries.find((e) => e.id === selected && e.account) ?? entries.find((e) => e.account)
  const counterOf = (e: Entry) => counters[e.id] ?? e.account?.counter ?? 0n

  const addFiles = useCallback((files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name))
    if (!images.length) {
      showToast(files.length ? 'Those files are not images' : 'No files')
      return
    }
    scanner.current ??= createScanner(() => new Worker(new URL('./scan/scan.worker.ts', import.meta.url), { type: 'module' }))
    for (const file of images) {
      const id = ++nextScan.current
      setScans((list) => [...list, { id, name: file.name || 'image', status: 'reading', texts: [] }])
      const update = (patch: Partial<Scan>) => setScans((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
      scanner.current.scan(file).then(
        (texts) => update(texts.length ? { status: 'read', texts } : { status: 'failed', error: 'No QR code found in this image' }),
        (e: Error) => update({ status: 'failed', error: e.message }),
      )
    }
  }, [showToast])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles([...e.dataTransfer.files])
  }

  // A password field drops line breaks, which would glue pasted URIs together.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[\r\n]/.test(text)) return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart ?? field.length
    const end = el.selectionEnd ?? field.length
    setField(field.slice(0, start) + text.replace(/\s*[\r\n]+\s*/g, ' ').trim() + field.slice(end))
  }

  const clearAll = () => {
    setField('')
    setScans([])
    setCounters({})
    setSelected(null)
  }

  const empty = !field.trim() && !scans.length

  return (
    <div className="otp-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined" aria-hidden>password</span> TOTP &amp; HOTP</>}
        localLabel="runs locally"
      >
        <button type="button" className={`otp-reveal${reveal ? ' on' : ''}`} aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
          <span className="material-symbols-outlined" aria-hidden>{reveal ? 'visibility_off' : 'visibility'}</span>
          {reveal ? 'Hide secrets' : 'Show secrets'}
        </button>
      </ToolHeader>

      <main id="main-content" className="otp-main">
        <div className="otp-side">
          <section className="otp-panel" aria-labelledby="otp-input-title">
            <h2 id="otp-input-title" className="otp-panel-title">Secret or URI</h2>
            <div className="otp-field">
              <input
                id="otp-field" type={reveal ? 'text' : 'password'} value={field} onChange={(e) => setField(e.target.value)} onPaste={onPaste}
                placeholder="Base32 secret, otpauth:// or otpauth-migration:// URI" aria-label="Base32 secret or otpauth URIs"
                autoComplete="off" autoCapitalize="off" spellCheck={false} data-1p-ignore="" data-lpignore="true"
              />
              {!empty && (
                <button type="button" onClick={clearAll} aria-label="Clear everything" title="Clear everything">
                  <span className="material-symbols-outlined" aria-hidden>close</span>
                </button>
              )}
            </div>
            <p className="otp-hint">Paste several URIs separated by spaces or new lines — for example every QR code of a multi-part export.</p>

            <div
              className={`otp-drop${dragging ? ' otp-drop-on' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="material-symbols-outlined" aria-hidden>qr_code_2</span>
              <p>Drop QR code images here, or</p>
              <button type="button" onClick={() => fileInput.current?.click()}>
                <span className="material-symbols-outlined" aria-hidden>upload_file</span> Choose images
              </button>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
            </div>
            {scans.length > 0 && (
              <ul className="otp-scans" aria-label="Scanned images">
                {scans.map((s) => (
                  <li key={s.id} className={s.status === 'failed' ? 'otp-scan-bad' : ''}>
                    <span className="otp-scan-name">{s.name}</span>
                    <span className="otp-scan-status">
                      {s.status === 'reading' ? 'Reading…' : s.status === 'failed' ? s.error : `${s.texts.length} QR code${s.texts.length === 1 ? '' : 's'}`}
                    </span>
                    <button type="button" onClick={() => setScans((list) => list.filter((x) => x.id !== s.id))} aria-label={`Remove ${s.name}`}>
                      <span className="material-symbols-outlined" aria-hidden>close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="otp-hint">Nothing is saved: secrets stay in this tab’s memory and are gone when you reload or close it.</p>
          </section>

          {hasMigration && (
            <div className="otp-alert otp-alert-warn" role="note">
              <span className="material-symbols-outlined" aria-hidden>warning</span>
              <p><strong>An Authenticator export QR code holds every secret in it.</strong> Anyone who sees it — or a screenshot or photo of it — can make codes for all of these accounts. Delete those images once you are done.</p>
            </div>
          )}

          {errors.map((e, i) => (
            <div key={i} className="otp-alert otp-alert-err" role="alert">
              <span className="material-symbols-outlined" aria-hidden>error</span>
              <p><strong>{e.origin}:</strong> {e.error}</p>
            </div>
          ))}

          {batches.map((b) => (
            <div key={b.batchId} className={`otp-alert ${b.missing.length || b.outOfRange.length ? 'otp-alert-warn' : 'otp-alert-info'}`} role="status">
              <span className="material-symbols-outlined" aria-hidden>{b.missing.length ? 'warning' : 'check_circle'}</span>
              <p>
                Export in {b.size} QR codes (batch {b.batchId}): {b.loaded.length ? `${listNumbers(b.loaded)} loaded` : 'none loaded'}
                {b.missing.length > 0 && <> — <strong>{listNumbers(b.missing)} missing</strong>; add {b.missing.length === 1 ? 'it' : 'them'} to see every account</>}
                {b.repeated.length > 0 && <> · {listNumbers(b.repeated)} loaded more than once (accounts repeat)</>}
                {b.outOfRange.length > 0 && <> · index {b.outOfRange.join(', ')} does not fit a batch of {b.size}</>}
              </p>
            </div>
          ))}

          {hasManual && <Settings settings={settings} onChange={setSettings} />}

          {entries.length > 1 && (
            <section className="otp-panel" aria-labelledby="otp-accounts-title">
              <h2 id="otp-accounts-title" className="otp-panel-title">{entries.length} accounts</h2>
              <ul className="otp-accounts">
                {entries.map((e) => (
                  <li key={e.id}>
                    <EntryCard entry={e} now={now} counter={counterOf(e)} selected={e === active} onSelect={() => setSelected(e.id)} />
                  </li>
                ))}
              </ul>
              {hasMigration && <p className="otp-hint">The export format has no period field; its TOTP accounts use 30-second windows.</p>}
            </section>
          )}

          {empty && (
            <section className="otp-panel otp-intro" aria-labelledby="otp-intro-title">
              <h2 id="otp-intro-title" className="otp-panel-title">Try it</h2>
              <p>Generates and checks one-time codes the way authenticator apps and servers do: HOTP (RFC 4226) and TOTP (RFC 6238) with SHA-1, SHA-256 or SHA-512, computed with your browser’s WebCrypto.</p>
              <div className="otp-examples">
                {EXAMPLES.map((ex) => <button type="button" key={ex.label} onClick={() => setField(ex.text)}>{ex.label}</button>)}
              </div>
              <p className="otp-hint">The examples use the RFC test secret “12345678901234567890” and made-up accounts.</p>
            </section>
          )}
        </div>

        <div className="otp-content">
          {active && active.notes.length > 0 && (
            <ul className="otp-notes" aria-label="Notes about this account">
              {active.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          {active?.account ? (
            <Detail
              key={active.id}
              entry={active}
              account={active.account}
              now={now}
              counter={counterOf(active)}
              onCounter={(c) => setCounters((m) => ({ ...m, [active.id]: c }))}
              window={window}
              onWindow={setWindow}
              reveal={reveal}
              copy={copy}
            />
          ) : (
            <section className="otp-placeholder" aria-label="Codes">
              <span className="material-symbols-outlined" aria-hidden>password</span>
              <p>{entries.length ? 'None of these accounts can make codes — see the reasons beside each one.' : 'Codes appear here once there is a secret to work with.'}</p>
            </section>
          )}
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}

const listNumbers = (n: number[]) => (n.length === 1 ? `QR ${n[0]}` : `QR ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`)

function Settings({ settings, onChange }: { settings: ManualSettings; onChange: (s: ManualSettings) => void }) {
  const set = (patch: Partial<ManualSettings>) => onChange({ ...settings, ...patch })
  return (
    <section className="otp-panel otp-settings" aria-labelledby="otp-settings-title">
      <h2 id="otp-settings-title" className="otp-panel-title">Parameters for the pasted secret</h2>
      <div className="otp-settings-grid">
        <Segmented label="Type" value={settings.type} options={[['totp', 'TOTP'], ['hotp', 'HOTP']]} onPick={(type) => set({ type })} />
        <Segmented label="Algorithm" value={settings.algorithm} options={ALGORITHMS.map((a) => [a, a])} onPick={(algorithm) => set({ algorithm })} />
        <Segmented label="Digits" value={settings.digits} options={[[6, '6'], [7, '7'], [8, '8']]} onPick={(digits) => set({ digits })} />
        {settings.type === 'totp' && (
          <label className="otp-inline">
            <span className="otp-label">Period (s)</span>
            <input type="number" min={1} max={86400} value={settings.period} onChange={(e) => set({ period: Math.min(86400, Math.max(1, Math.round(Number(e.target.value)) || 1)) })} />
          </label>
        )}
      </div>
      <p className="otp-hint">A bare secret carries no parameters; most services use TOTP, SHA1, 6 digits, 30 s.</p>
    </section>
  )
}

function Segmented<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="otp-inline">
      <span className="otp-label" id={`otp-seg-${label}`}>{label}</span>
      <div className="otp-seg" role="group" aria-labelledby={`otp-seg-${label}`}>
        {options.map(([v, text]) => (
          <button type="button" key={String(v)} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  )
}

function EntryCard({ entry, now, counter, selected, onSelect }: { entry: Entry; now: number; counter: bigint; selected: boolean; onSelect: () => void }) {
  const account = entry.account
  const key = useKey(account)
  const c = account ? (account.type === 'totp' ? totpCounter(now, account.period) : counter) : 0n
  const list = useMemo(() => (account ? [c] : []), [account, c])
  const code = useCodes(key, account?.digits ?? 6, list)[String(c)]
  const m = entry.migration
  return (
    <button type="button" className={`otp-account${selected ? ' on' : ''}`} onClick={onSelect} disabled={!account} aria-pressed={selected}>
      <span className="otp-account-title">{entryTitle(entry)}</span>
      <span className="otp-account-meta">
        {m ? `${m.type} · ${m.algorithm} · ${m.digits} digits` : account ? `${account.type.toUpperCase()} · ${account.algorithm} · ${account.digits} digits` : ''}
        {account?.type === 'hotp' && ` · counter ${counter}`}
        {' · '}{entry.origin}
      </span>
      {account ? <span className="otp-account-code">{code ? groupCode(code) : '…'}</span> : <span className="otp-account-problem">{entry.problem}</span>}
    </button>
  )
}
