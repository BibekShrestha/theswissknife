import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ALGS, isHmac, signJws, verifyJws, type Alg, type VerifyResult } from './crypto'
import { b64urlEncodeString, describeTimeClaims, parseJwt } from './jwt'
import { Card, ColoredToken, JsonEditor } from './ui'

// The canonical jwt.io sample token (HS256, secret: your-256-bit-secret).
export const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const SAMPLE_SECRET = 'your-256-bit-secret'

export interface DecodeViewHandle {
  loadSample: () => void
}

export default function DecodeView({
  onCopy,
  handleRef,
}: {
  onCopy: (text: string, what: string) => void
  handleRef: React.RefObject<DecodeViewHandle | null>
}) {
  const [token, setToken] = useState(SAMPLE_TOKEN)
  const [headerJson, setHeaderJson] = useState('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
  const [payloadJson, setPayloadJson] = useState(
    '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
  )
  const [alg, setAlg] = useState<Alg>('HS256')
  const [secret, setSecret] = useState(SAMPLE_SECRET)
  const [secretIsB64, setSecretIsB64] = useState(false)
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [verify, setVerify] = useState<VerifyResult | { state: 'none' }>({ state: 'none' })
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const verifySeq = useRef(0)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const parsed = useMemo(() => parseJwt(token), [token])

  const onTokenChange = useCallback((next: string) => {
    setToken(next)
    setSignError(null)
    const p = parseJwt(next)
    if ('error' in p) {
      setDecodeError(next.trim() ? p.error : null)
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

  useEffect(() => {
    handleRef.current = { loadSample: () => onTokenChange(SAMPLE_TOKEN) }
  }, [handleRef, onTokenChange])

  // ---- decoded edited → re-sign (or reassemble with the old signature) ----
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

  const verifyBadge =
    verify.state === 'valid' ? (
      <span className="sig-badge ok"><span className="material-symbols-outlined" aria-hidden>check_circle</span> signature verified</span>
    ) : verify.state === 'invalid' ? (
      <span className="sig-badge err"><span className="material-symbols-outlined" aria-hidden>cancel</span> invalid signature</span>
    ) : verify.state === 'error' ? (
      <span className="sig-badge warn" title={verify.message}>
        <span className="material-symbols-outlined" aria-hidden>warning</span> {verify.message}
      </span>
    ) : (
      <span className="sig-badge muted">
        {isHmac(alg) ? 'enter the secret to verify' : 'paste the public key to verify'}
      </span>
    )

  return (
    <main id="main-content" className="jwt-panes">
      <div className="jwt-col">
        <Card
          title="encoded token"
          fill
          actions={
            <>
              <button onClick={() => void onCopy(token, 'Token')} aria-label="Copy"><span className="material-symbols-outlined">content_copy</span></button>
              <button onClick={() => onTokenChange('')} aria-label="Clear"><span className="material-symbols-outlined">close</span></button>
            </>
          }
        >
          <div className="jwt-token-wrap">
            <pre className="jwt-token-color" aria-hidden>
              <ColoredToken token={token} />
            </pre>
            <textarea
              className="jwt-token-edit"
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder="eyJhbGciOi…  (paste a JWT)"
              spellCheck={false}
              aria-label="Encoded token"
            />
          </div>
          {(decodeError || signError) && (
            <div className="jwt-error">{decodeError ?? signError}</div>
          )}
          <div className="jwt-legend" aria-hidden>
            <span className="jwt-seg-h">■ header</span>
            <span className="jwt-seg-p">■ payload</span>
            <span className="jwt-seg-s">■ signature</span>
          </div>
        </Card>
      </div>

      <div className="jwt-col">
        <Card tone="h" title="header">
          <JsonEditor value={headerJson} onChange={onHeaderChange} minRows={3} ariaLabel="Header JSON" />
        </Card>

        <Card tone="p" title="payload">
          <JsonEditor value={payloadJson} onChange={onPayloadChange} minRows={5} ariaLabel="Payload JSON" />
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
        </Card>

        <Card tone="s" title="signature" badge={verifyBadge}>
          <div className="jwt-form">
            <label className="jwt-form-row">
              <span className="jwt-form-label">alg</span>
              <select value={alg} onChange={(e) => onAlgChange(e.target.value as Alg)}>
                {ALGS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {isHmac(alg) ? (
              <label className="jwt-form-row">
                <span className="jwt-form-label">secret</span>
                <input
                  className="mono"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="secret"
                  spellCheck={false}
                />
                <label className="jwt-check">
                  <input
                    type="checkbox"
                    checked={secretIsB64}
                    onChange={(e) => setSecretIsB64(e.target.checked)}
                  />
                  base64url
                </label>
              </label>
            ) : (
              <div className="jwt-keys">
                <textarea
                  className="mono"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder={'Public key — verifies\n-----BEGIN PUBLIC KEY----- or JWK {"kty":…}'}
                  spellCheck={false}
                />
                <textarea
                  className="mono"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder={'Private key — re-signs edits (optional)\n-----BEGIN PRIVATE KEY----- or JWK'}
                  spellCheck={false}
                />
              </div>
            )}
            <p className="jwt-hint">
              {isHmac(alg)
                ? 'The same secret verifies the token and re-signs your edits.'
                : 'The public key verifies; add the private key to re-sign edited claims.'}
            </p>
          </div>
        </Card>
      </div>
    </main>
  )
}
