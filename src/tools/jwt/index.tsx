import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '../../shell/router'
import { useTheme } from '../../shell/theme'
import { ALGS, isHmac, signJws, verifyJws, type Alg, type VerifyResult } from './crypto'
import { b64urlEncodeString, describeTimeClaims, parseJwt } from './jwt'
import './jwt.css'

// The canonical jwt.io sample token (HS256, secret: your-256-bit-secret).
const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const SAMPLE_SECRET = 'your-256-bit-secret'

const pretty = (json: string) => JSON.stringify(JSON.parse(json), null, 2)

/** Minimal JSON token colorizer (duplicated per-tool by design). */
function colorJson(text: string) {
  const re = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const cls =
      tok[0] === '"'
        ? /^\s*:/.test(text.slice(m.index + tok.length))
          ? 'tok-key'
          : 'tok-str'
        : tok === 'true' || tok === 'false' || tok === 'null'
          ? 'tok-lit'
          : 'tok-num'
    nodes.push(
      <span key={k++} className={cls}>
        {tok}
      </span>,
    )
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function JwtTool() {
  const [theme, toggleTheme] = useTheme()
  const [token, setToken] = useState(SAMPLE_TOKEN)
  const [headerJson, setHeaderJson] = useState(() => pretty('{"alg":"HS256","typ":"JWT"}'))
  const [payloadJson, setPayloadJson] = useState(() =>
    pretty('{"sub":"1234567890","name":"John Doe","iat":1516239022}'),
  )
  const [alg, setAlg] = useState<Alg>('HS256')
  const [secret, setSecret] = useState(SAMPLE_SECRET)
  const [secretIsB64, setSecretIsB64] = useState(false)
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [verify, setVerify] = useState<VerifyResult | { state: 'none' }>({ state: 'none' })
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const toastTimer = useRef<number | undefined>(undefined)
  const verifySeq = useRef(0)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const parsed = useMemo(() => parseJwt(token), [token])
  const parts = token.trim().split('.')

  // ---- token edited → update decoded panels -----------------------------
  const onTokenChange = useCallback((next: string) => {
    setToken(next)
    setSignError(null)
    const p = parseJwt(next)
    if ('error' in p) {
      setDecodeError(p.error)
      return
    }
    setDecodeError(null)
    setHeaderJson(JSON.stringify(p.header, null, 2))
    setPayloadJson(JSON.stringify(p.payload, null, 2))
    const headerAlg = p.header.alg
    if (typeof headerAlg === 'string' && (ALGS as readonly string[]).includes(headerAlg)) {
      setAlg(headerAlg as Alg)
    }
  }, [])

  // ---- decoded edited → re-sign (or reassemble with the old signature) --
  const signingKey = useMemo(
    () => (isHmac(alg) ? { text: secret, secretIsB64 } : { text: privateKey, secretIsB64: false }),
    [alg, secret, secretIsB64, privateKey],
  )
  const canSign = isHmac(alg) ? secret.length > 0 : privateKey.trim().length > 0

  const reencode = useCallback(
    async (nextHeader: string, nextPayload: string) => {
      setSignError(null)
      let h: string
      let p: string
      try {
        h = JSON.stringify(JSON.parse(nextHeader))
        p = JSON.stringify(JSON.parse(nextPayload))
      } catch {
        setSignError('Decoded JSON is invalid — token not updated.')
        return
      }
      setDecodeError(null)
      if (canSign) {
        try {
          setToken(await signJws(alg, h, p, signingKey))
          return
        } catch (err) {
          setSignError(`Could not sign: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      // no signing key: reassemble, keeping the (now stale) signature
      const oldSig = token.trim().split('.')[2] ?? ''
      setToken(`${b64urlEncodeString(h)}.${b64urlEncodeString(p)}.${oldSig}`)
    },
    [alg, canSign, signingKey, token],
  )

  const onHeaderChange = (v: string) => {
    setHeaderJson(v)
    void reencode(v, payloadJson)
  }
  const onPayloadChange = (v: string) => {
    setPayloadJson(v)
    void reencode(headerJson, v)
  }
  const onAlgChange = (next: Alg) => {
    setAlg(next)
    try {
      const h = JSON.parse(headerJson) as Record<string, unknown>
      h.alg = next
      const nextHeader = JSON.stringify(h, null, 2)
      setHeaderJson(nextHeader)
      void reencode(nextHeader, payloadJson)
    } catch {
      // header not valid JSON right now — alg applies on next valid edit
    }
  }

  // ---- auto-verify -------------------------------------------------------
  useEffect(() => {
    const seq = ++verifySeq.current
    if ('error' in parsed) {
      setVerify({ state: 'none' })
      return
    }
    const key = isHmac(alg) ? { text: secret, secretIsB64 } : { text: publicKey, secretIsB64: false }
    if (!key.text.trim()) {
      setVerify({ state: 'none' })
      return
    }
    const t = setTimeout(() => {
      void verifyJws(alg, parsed.signingInput, parsed.signatureB64, key).then((r) => {
        if (verifySeq.current === seq) setVerify(r)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [parsed, alg, secret, secretIsB64, publicKey])

  const claims = useMemo(
    () => ('error' in parsed ? [] : describeTimeClaims(parsed.payload, now)),
    [parsed, now],
  )

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${what} copied`)
    } catch {
      showToast('Copy failed — clipboard unavailable')
    }
  }

  const verifyBadge =
    verify.state === 'valid' ? (
      <span className="sig-badge ok">✓ signature verified</span>
    ) : verify.state === 'invalid' ? (
      <span className="sig-badge err">✗ invalid signature</span>
    ) : verify.state === 'error' ? (
      <span className="sig-badge warn" title={verify.message}>
        ⚠ {verify.message}
      </span>
    ) : (
      <span className="sig-badge muted">{isHmac(alg) ? 'enter the secret to verify' : 'paste the public key to verify'}</span>
    )

  return (
    <div className="jwt-app">
      <header className="jwt-top">
        <Link to="/" className="home-link" title="All tools — The Swiss Knife">
          ✚
        </Link>
        <div className="jwt-brand">
          <span className="jwt-brand-mark">JWT</span> decoder
        </div>
        <span className="jwt-privacy">🔒 runs locally — tokens & keys never leave your browser</span>
        <div className="spacer" />
        <button onClick={() => onTokenChange(SAMPLE_TOKEN)} title="Load the jwt.io sample token">
          Sample
        </button>
        <button className="icon-btn theme-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <main className="jwt-panes">
        <section className="jwt-pane">
          <div className="jwt-pane-head">
            <span className="jwt-pane-title">Encoded token</span>
            <div className="jwt-actions">
              <button onClick={() => void copy(token, 'Token')}>Copy</button>
              <button onClick={() => onTokenChange('')}>Clear</button>
            </div>
          </div>
          <textarea
            className="jwt-token-input"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="eyJhbGciOi…  (paste a JWT)"
            spellCheck={false}
          />
          {parts.length === 3 && !decodeError && (
            <div className="jwt-token-colored" aria-hidden>
              <span className="jwt-seg-h">{parts[0]}</span>
              <span className="jwt-dot">.</span>
              <span className="jwt-seg-p">{parts[1]}</span>
              <span className="jwt-dot">.</span>
              <span className="jwt-seg-s">{parts[2]}</span>
            </div>
          )}
          {decodeError && <div className="jwt-error">{decodeError}</div>}
          {signError && <div className="jwt-error">{signError}</div>}
        </section>

        <section className="jwt-pane">
          <div className="jwt-block">
            <div className="jwt-block-head">
              <span className="jwt-seg-h">header</span>
            </div>
            <div className="jwt-json-wrap">
              <pre className="jwt-json-color" aria-hidden>
                {colorJson(headerJson)}
              </pre>
              <textarea
                className="jwt-json-edit"
                value={headerJson}
                onChange={(e) => onHeaderChange(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>

          <div className="jwt-block">
            <div className="jwt-block-head">
              <span className="jwt-seg-p">payload</span>
            </div>
            <div className="jwt-json-wrap">
              <pre className="jwt-json-color" aria-hidden>
                {colorJson(payloadJson)}
              </pre>
              <textarea
                className="jwt-json-edit"
                value={payloadJson}
                onChange={(e) => onPayloadChange(e.target.value)}
                spellCheck={false}
              />
            </div>
            {claims.length > 0 && (
              <table className="jwt-claims">
                <tbody>
                  {claims.map((c) => (
                    <tr key={c.claim} className={c.problem ? 'problem' : ''}>
                      <td>
                        <code>{c.claim}</code> {c.label}
                      </td>
                      <td>{c.iso}</td>
                      <td>
                        {c.relative}
                        {c.claim === 'exp' && c.problem && <strong> — expired</strong>}
                        {c.claim === 'nbf' && c.problem && <strong> — not valid yet</strong>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="jwt-block">
            <div className="jwt-block-head">
              <span className="jwt-seg-s">signature</span>
              {verifyBadge}
            </div>
            <div className="jwt-sig-controls">
              <label className="jwt-alg">
                alg
                <select value={alg} onChange={(e) => onAlgChange(e.target.value as Alg)}>
                  {ALGS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              {isHmac(alg) ? (
                <>
                  <input
                    className="jwt-secret mono"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="secret"
                    spellCheck={false}
                  />
                  <label className="jwt-b64">
                    <input
                      type="checkbox"
                      checked={secretIsB64}
                      onChange={(e) => setSecretIsB64(e.target.checked)}
                    />
                    secret is base64url
                  </label>
                </>
              ) : (
                <div className="jwt-keys">
                  <textarea
                    className="mono"
                    value={publicKey}
                    onChange={(e) => setPublicKey(e.target.value)}
                    placeholder={'Public key for verification\n-----BEGIN PUBLIC KEY----- … or JWK {"kty":…}'}
                    spellCheck={false}
                  />
                  <textarea
                    className="mono"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder={'Private key to (re)sign edits — optional\n-----BEGIN PRIVATE KEY----- … or JWK'}
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
            <p className="jwt-sig-hint">
              {isHmac(alg)
                ? 'The same secret verifies the token and re-signs your edits.'
                : 'The public key verifies; add the private key to re-sign edited claims.'}
            </p>
          </div>
        </section>
      </main>

      {toast && <div className="jwt-toast">{toast}</div>}
    </div>
  )
}
