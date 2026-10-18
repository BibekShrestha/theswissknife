import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { encodeBase32 } from './base32'
import { entryTitle, type Entry } from './entries'
import { groupCode, useCodes, useKey } from './hooks'
import { findCode, MAX_COUNTER, totpCounter, type Match } from './otp'
import { qrPath } from './qrcode'
import { buildOtpauth, type Account } from './uri'

type Copy = (text: string, what: string) => Promise<void>

export const MAX_WINDOW = 10

interface DetailProps {
  entry: Entry
  account: Account
  now: number
  counter: bigint
  onCounter: (counter: bigint) => void
  window: number
  onWindow: (window: number) => void
  reveal: boolean
  copy: Copy
}

const timeOf = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function Detail({ entry, account, now, counter, onCounter, window, onWindow, reveal, copy }: DetailProps) {
  const isTotp = account.type === 'totp'
  const centre = isTotp ? totpCounter(now, account.period) : counter
  const key = useKey(account)

  const rows = useMemo(() => {
    const out: { offset: number; counter: bigint }[] = []
    for (let offset = -window; offset <= window; offset++) {
      const c = centre + BigInt(offset)
      if (c >= 0n && c <= MAX_COUNTER) out.push({ offset, counter: c })
    }
    return out
  }, [centre, window])
  const counters = useMemo(() => rows.map((r) => r.counter), [rows])
  const codes = useCodes(key, account.digits, counters)
  const current = codes[String(centre)]

  const remaining = isTotp ? account.period - (now % account.period) : 0
  const secretText = encodeBase32(account.secret)
  const uri = useMemo(() => buildOtpauth({ ...account, counter }), [account, counter])

  return (
    <section className="otp-detail" aria-labelledby="otp-detail-title">
      <header className="otp-detail-head">
        <h2 id="otp-detail-title">{entryTitle(entry)}</h2>
        <p className="otp-facts">
          <span>{account.type.toUpperCase()}</span>
          <span>{account.algorithm}</span>
          <span>{account.digits} digits</span>
          <span>{isTotp ? `${account.period} s period` : `counter ${counter}`}</span>
          <span>{account.secret.length * 8}-bit secret</span>
        </p>
      </header>

      <div className="otp-now">
        <div className="otp-code-block">
          <span className="otp-label">{isTotp ? 'Current code' : 'Code for this counter'}</span>
          <output className="otp-code" aria-live="off">{current ? groupCode(current) : '…'}</output>
          <button type="button" onClick={() => current && void copy(current, 'Code')} disabled={!current} aria-label="Copy code">
            <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
          </button>
        </div>
        {isTotp ? (
          <div className="otp-countdown">
            <span className="otp-label">Next code in</span>
            <strong className={remaining < 5 ? 'otp-soon' : ''}>{Math.ceil(remaining)} s</strong>
            <div className="otp-bar" aria-hidden><div className={remaining < 5 ? 'otp-soon' : ''} style={{ width: `${(remaining / account.period) * 100}%` }} /></div>
            <small>T = {String(centre)} · this device’s clock, {timeOf(now)}</small>
          </div>
        ) : (
          <CounterField counter={counter} onCounter={onCounter} />
        )}
      </div>

      <div className="otp-windows">
        <div className="otp-windows-head">
          <h3>{isTotp ? 'Windows around now' : 'Counters around this one'}</h3>
          <label className="otp-inline">
            <span className="otp-label">Window ±</span>
            <input type="number" min={0} max={MAX_WINDOW} value={window} onChange={(e) => onWindow(Math.min(MAX_WINDOW, Math.max(0, Math.round(Number(e.target.value)) || 0)))} />
          </label>
        </div>
        <table className="otp-table">
          <thead>
            <tr><th scope="col">Offset</th><th scope="col">{isTotp ? 'T' : 'Counter'}</th><th scope="col">Code</th>{isTotp && <th scope="col">Valid (local time)</th>}</tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const start = Number(r.counter) * account.period
              return (
                <tr key={String(r.counter)} className={r.offset === 0 ? 'otp-row-now' : ''} aria-current={r.offset === 0 ? 'true' : undefined}>
                  <td>{r.offset === 0 ? (isTotp ? 'now' : 'current') : r.offset > 0 ? `+${r.offset}` : r.offset}</td>
                  <td>{String(r.counter)}</td>
                  <td className="otp-mono">{codes[String(r.counter)] ? groupCode(codes[String(r.counter)]) : '…'}</td>
                  {isTotp && <td>{timeOf(start)}–{timeOf(start + account.period - 1)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <CheckCode cryptoKey={key} account={account} centre={centre} window={window} />

      <div className="otp-export">
        <h3>Re-import elsewhere</h3>
        <dl className="otp-kv">
          <div>
            <dt>Secret (Base32)</dt>
            <dd>
              <code className={reveal ? '' : 'otp-masked'}>{reveal ? secretText.replace(/(.{4})(?=.)/g, '$1 ') : '•'.repeat(Math.min(32, secretText.length))}</code>
              <button type="button" onClick={() => void copy(secretText, 'Secret')} aria-label="Copy secret"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
            </dd>
          </div>
          <div>
            <dt>otpauth URI</dt>
            <dd>
              <code className={reveal ? '' : 'otp-masked'}>{reveal ? uri : `otpauth://${account.type}/… (hidden)`}</code>
              <button type="button" onClick={() => void copy(uri, 'otpauth URI')} aria-label="Copy otpauth URI"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
            </dd>
          </div>
        </dl>
        {!isTotp && <p className="otp-hint">The URI and QR code carry the counter shown above ({String(counter)}).</p>}
        {reveal ? <QrImage text={uri} title={`QR code for ${entryTitle(entry)}`} /> : <p className="otp-hint">The QR code is hidden with the other secrets — use Show secrets to display it for scanning.</p>}
      </div>
    </section>
  )
}

function CounterField({ counter, onCounter }: { counter: bigint; onCounter: (c: bigint) => void }) {
  const [text, setText] = useState(String(counter))
  useEffect(() => setText(String(counter)), [counter])
  const valid = /^\d+$/.test(text) && BigInt(text) <= MAX_COUNTER
  return (
    <div className="otp-counter">
      <label htmlFor="otp-counter-input" className="otp-label">Counter</label>
      <div className="otp-counter-row">
        <button type="button" onClick={() => onCounter(counter - 1n)} disabled={counter <= 0n} aria-label="Previous counter"><span className="material-symbols-outlined" aria-hidden>remove</span></button>
        <input
          id="otp-counter-input" inputMode="numeric" value={text} aria-invalid={!valid}
          onChange={(e) => {
            setText(e.target.value)
            if (/^\d+$/.test(e.target.value) && BigInt(e.target.value) <= MAX_COUNTER) onCounter(BigInt(e.target.value))
          }}
        />
        <button type="button" onClick={() => onCounter(counter + 1n)} disabled={counter >= MAX_COUNTER} aria-label="Next counter"><span className="material-symbols-outlined" aria-hidden>add</span></button>
      </div>
      {!valid && <small className="otp-err-text">A whole number from 0 to 2^64 − 1</small>}
    </div>
  )
}

function CheckCode({ cryptoKey, account, centre, window }: { cryptoKey: CryptoKey | null; account: Account; centre: bigint; window: number }) {
  const [input, setInput] = useState('')
  const [result, setResult] = useState<{ for: string; match: Match | null } | null>(null)
  const code = input.replace(/\s+/g, '')
  const problem = !code ? null : !/^\d+$/.test(code) ? 'Codes are digits only' : code.length !== account.digits ? `This account makes ${account.digits}-digit codes` : null
  const signature = `${code}|${centre}|${window}`

  useEffect(() => {
    if (!cryptoKey || !code || problem) return
    let live = true
    findCode(cryptoKey, code, centre, window, account.digits).then((match) => { if (live) setResult({ for: signature, match }) }, () => {})
    return () => { live = false }
  }, [cryptoKey, code, problem, centre, window, account.digits, signature])

  const isTotp = account.type === 'totp'
  const shown = result && result.for === signature ? result : null
  let verdict: ReactNode = null
  if (problem) verdict = <p className="otp-verdict otp-verdict-bad" role="status">{problem}</p>
  else if (code && shown) {
    const m = shown.match
    if (!m) {
      const lo = centre - BigInt(window) < 0n ? 0n : centre - BigInt(window)
      verdict = <p className="otp-verdict otp-verdict-bad" role="status"><span className="material-symbols-outlined" aria-hidden>error</span> No match within ±{window} ({isTotp ? 'T' : 'counter'} {String(lo)}–{String(centre + BigInt(window))})</p>
    } else {
      const n = Math.abs(m.offset)
      const where = m.offset === 0
        ? (isTotp ? 'the current window' : 'the current counter')
        : `${n}${isTotp ? ' window' : ' step'}${n === 1 ? '' : 's'} ${m.offset > 0 ? 'ahead of' : 'behind'} ${isTotp ? 'the current window' : 'the current counter'}`
      const hint = isTotp
        ? (m.offset === 0 ? 'The clocks agree to within one window.' : `If that code was generated just now, its device’s clock is about ${n * account.period} s ${m.offset > 0 ? 'ahead of' : 'behind'} this one.`)
        : `After a match, an RFC 4226 server moves its counter to ${String(m.counter + 1n)}.`
      verdict = (
        <p className="otp-verdict otp-verdict-ok" role="status">
          <span className="material-symbols-outlined" aria-hidden>check_circle</span>
          <span>Matches {isTotp ? 'T' : 'counter'} = {String(m.counter)}, {where}. {hint}</span>
        </p>
      )
    }
  }

  return (
    <div className="otp-check">
      <h3><label htmlFor="otp-check-input">Check a code</label></h3>
      <input id="otp-check-input" inputMode="numeric" autoComplete="off" placeholder={'0'.repeat(account.digits)} value={input} onChange={(e) => setInput(e.target.value)} />
      <p className="otp-hint">Searches {isTotp ? 'windows' : 'counters'} −{window} to +{window} around {isTotp ? 'now' : 'the current one'}, nearest first.</p>
      {verdict}
    </div>
  )
}

/**
 * The re-import QR code: dark modules on white whatever the theme, because
 * that is what phone scanners read reliably.
 */
function QrImage({ text, title }: { text: string; title: string }) {
  const qr = useMemo(() => qrPath(text), [text])
  return (
    <svg className="otp-qr" viewBox={`0 0 ${qr.dim} ${qr.dim}`} role="img" aria-label={title} shapeRendering="crispEdges">
      <rect width={qr.dim} height={qr.dim} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  )
}
