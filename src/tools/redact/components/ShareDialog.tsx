import { useEffect, useState } from 'react'
import {
  countKinds,
  encodeScheme,
  LENGTH_MAX,
  LENGTH_WARN,
  schemeFromJson,
  schemeJson,
  schemeUrl,
  type Scheme,
} from '../lib/share'

interface ShareDialogProps {
  scheme: Scheme
  onApply: (scheme: Scheme) => void
  onClose: () => void
  copy: (text: string, what: string) => void
  showToast: (message: string) => void
}

export function ShareDialog({ scheme, onApply, onClose, copy, showToast }: ShareDialogProps) {
  const { patterns, literals } = countKinds(scheme.targets)
  const [includeLiterals, setIncludeLiterals] = useState(false)
  const [url, setUrl] = useState('')
  const [json, setJson] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Compression is async, so the link arrives a tick after the dialog does.
  useEffect(() => {
    let alive = true
    const base = `${location.origin}${location.pathname}`
    encodeScheme(scheme, includeLiterals)
      .then((payload) => alive && setUrl(schemeUrl(payload, base)))
      .catch(() => alive && setUrl(''))
    setJson(schemeJson(scheme, includeLiterals))
    return () => {
      alive = false
    }
  }, [scheme, includeLiterals])

  const tooLong = url.length > LENGTH_MAX
  const longish = url.length > LENGTH_WARN

  return (
    <div className="redact-dialog-backdrop" onClick={onClose}>
      <div
        className="redact-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Share this redaction scheme"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Share this scheme</strong>
          <div className="spacer" />
          <button className="redact-icon" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="redact-dialog-body">
          <p className="redact-dialog-lede">
            The link carries your mask, your space setting and {patterns} pattern
            {patterns === 1 ? '' : 's'}. It never carries the text you pasted — that stays in your
            tab.
          </p>

          {literals > 0 && (
            <div className={`redact-literals${includeLiterals ? ' on' : ''}`}>
              <label className="redact-check">
                <input
                  type="checkbox"
                  checked={includeLiterals}
                  onChange={(event) => setIncludeLiterals(event.target.checked)}
                />
                <span>
                  Include the {literals} term{literals === 1 ? '' : 's'} you picked by hand
                </span>
              </label>
              <p>
                {includeLiterals
                  ? 'Anyone with the link can read these — they are the very values you redacted:'
                  : 'Left out. They are the values you redacted, so a link holding them would undo the point:'}
              </p>
              <ul>
                {scheme.targets
                  .filter((target) => target.kind === 'literal')
                  .map((target) => (
                    <li key={target.value}>
                      <code>{target.value}</code>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <label className="redact-field">
            <span className="redact-label">Link</span>
            <div className="redact-field-row">
              <input type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <button
                className="redact-primary"
                disabled={!url || tooLong}
                onClick={() => copy(url, 'Link')}
              >
                <span className="material-symbols-outlined">link</span>
                Copy link
              </button>
            </div>
            <span className={`redact-length${tooLong ? ' bad' : longish ? ' warn' : ''}`}>
              {url.length} characters
              {tooLong
                ? ' — too long to paste reliably; drop some targets or share the JSON instead'
                : longish
                  ? ' — long enough that some mail clients will break it; the JSON below is safer'
                  : ' — short enough for chat, email or a QR code'}
            </span>
          </label>

          <label className="redact-field">
            <span className="redact-label">Or as JSON, to keep in a repo</span>
            <textarea
              className="mono"
              value={json}
              spellCheck={false}
              onChange={(event) => setJson(event.target.value)}
              aria-label="Scheme as JSON"
            />
            <div className="redact-field-row">
              <button onClick={() => copy(json, 'Scheme JSON')}>Copy JSON</button>
              <button
                onClick={() => {
                  const parsed = schemeFromJson(json)
                  if (!parsed) return showToast('That JSON is not a redaction scheme')
                  onApply(parsed)
                  showToast('Scheme applied')
                  onClose()
                }}
              >
                Apply JSON
              </button>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
