import { useEffect, useRef, useState } from 'react'
import { encodeState, LENGTH_MAX, LENGTH_WARN, MAX_SUBJECT, shareUrl, type LabState } from '../share'

interface Props {
  state: LabState
  onClose: () => void
  copy: (text: string, what: string) => void
}

export function ShareDialog({ state, onClose, copy }: Props) {
  const [includeSubject, setIncludeSubject] = useState(false)
  const [includeCases, setIncludeCases] = useState(false)
  const [url, setUrl] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const subjectLength = state.subject?.length ?? 0
  const caseCount = state.cases?.length ?? 0
  const subjectTooBig = subjectLength > MAX_SUBJECT

  useEffect(() => {
    closeRef.current?.focus()
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
    encodeState(state, { subject: includeSubject && !subjectTooBig, cases: includeCases })
      .then((payload) => alive && setUrl(shareUrl(payload, base)))
      .catch(() => alive && setUrl(''))
    return () => {
      alive = false
    }
  }, [state, includeSubject, includeCases, subjectTooBig])

  const tooLong = url.length > LENGTH_MAX
  const longish = url.length > LENGTH_WARN

  return (
    <div className="regex-dialog-backdrop" onClick={onClose}>
      <div className="regex-dialog" role="dialog" aria-modal="true" aria-labelledby="regex-share-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong id="regex-share-title">Share link</strong>
          <div className="spacer" />
          <button ref={closeRef} className="regex-icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined" aria-hidden>close</span>
          </button>
        </header>
        <div className="regex-dialog-body">
          <p>
            The link carries the pattern, the flags, the operation and the replacement. It is all in the part after
            <code>#</code>, which browsers never send to a server.
          </p>
          <label className="regex-check">
            <input
              type="checkbox"
              checked={includeSubject && !subjectTooBig}
              disabled={subjectLength === 0 || subjectTooBig}
              onChange={(event) => setIncludeSubject(event.target.checked)}
            />
            <span>
              Include the subject ({subjectLength.toLocaleString('en-US')} characters)
              {subjectTooBig && ` — too large for a link (over ${MAX_SUBJECT.toLocaleString('en-US')})`}
            </span>
          </label>
          <label className="regex-check">
            <input type="checkbox" checked={includeCases} disabled={caseCount === 0} onChange={(event) => setIncludeCases(event.target.checked)} />
            <span>Include the test cases ({caseCount})</span>
          </label>
          {(includeSubject || includeCases) && (
            <p className="regex-dialog-warn">Anyone with the link can read the text you include. Leave real data out.</p>
          )}
          <input className="regex-share-url" type="text" readOnly value={url} aria-label="Share link" onFocus={(event) => event.target.select()} />
          {tooLong ? (
            <p className="regex-dialog-warn">This link is {url.length.toLocaleString('en-US')} characters — too long to paste anywhere useful. Leave the subject out.</p>
          ) : longish ? (
            <p className="regex-dialog-note">{url.length.toLocaleString('en-US')} characters: some chat and ticket tools cut long links short.</p>
          ) : null}
          <div className="regex-dialog-actions">
            <button className="regex-primary" disabled={!url || tooLong} onClick={() => copy(url, 'Link')}>
              <span className="material-symbols-outlined" aria-hidden>link</span>
              Copy link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
