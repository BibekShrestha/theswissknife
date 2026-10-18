import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ALGS, declaredAlg, derivePublicPem, generateKeyMaterial, hasKeyMaterial, headerAlgProblem, isHmac, signJws, type Alg,
} from './crypto'
import { minifyJson, setTopLevel } from './jsontext'
import { describeTimeClaims } from './jwt'
import { Card, ColoredToken, JsonEditor } from './ui'

const DEFAULT_PAYLOAD = JSON.stringify(
  { sub: '1234567890', name: 'Ada Lovelace', admin: true },
  null,
  2,
)

const EXP_CHOICES = [
  ['5m', 300],
  ['1h', 3600],
  ['24h', 86400],
  ['7d', 604800],
  ['30d', 2592000],
] as const

export default function GenerateView({ onCopy }: { onCopy: (text: string, what: string) => void }) {
  const [alg, setAlg] = useState<Alg>('HS256')
  const [headerJson, setHeaderJson] = useState('{\n  "alg": "HS256",\n  "typ": "JWT"\n}')
  const [payloadJson, setPayloadJson] = useState(DEFAULT_PAYLOAD)
  const [secret, setSecret] = useState('')
  const [secretIsB64, setSecretIsB64] = useState(false)
  const [privateKey, setPrivateKey] = useState('')
  const [publicPem, setPublicPem] = useState('')
  const [expChoice, setExpChoice] = useState<number>(3600)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const signSeq = useRef(0)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const hasKey = hasKeyMaterial(alg, isHmac(alg) ? secret : privateKey)

  // ---- claim helpers -----------------------------------------------------
  const mergeClaims = (patch: Record<string, unknown>) => {
    try {
      // edit the text in place so no other claim's value is re-serialised
      let next = payloadJson
      for (const [k, v] of Object.entries(patch)) next = setTopLevel(next, k, JSON.stringify(v))
      setPayloadJson(next)
    } catch {
      setError('Payload is not a valid JSON object — fix it before adding claims.')
    }
  }

  const onAlgChange = (next: Alg) => {
    setAlg(next)
    try {
      setHeaderJson(setTopLevel(headerJson, 'alg', JSON.stringify(next)))
    } catch {
      setHeaderJson(JSON.stringify({ alg: next, typ: 'JWT' }, null, 2))
    }
  }

  // the header's alg drives the dropdown, so the two cannot disagree
  const onHeaderChange = (v: string) => {
    setHeaderJson(v)
    try {
      const h = JSON.parse(v) as Record<string, unknown>
      const declared = h && typeof h === 'object' ? declaredAlg(h) : null
      if (declared?.ok) setAlg(declared.alg)
    } catch {
      // not valid JSON yet — the signing effect reports it
    }
  }

  // ---- public key, always derived from the current private key and alg ---
  useEffect(() => {
    let live = true
    setPublicPem('')
    if (!isHmac(alg) && privateKey.trim()) {
      derivePublicPem(alg, privateKey).then(
        (pem) => { if (live) setPublicPem(pem) },
        () => {},
      )
    }
    return () => { live = false }
  }, [alg, privateKey])

  const generateKey = async () => {
    setGenerating(true)
    setError(null)
    try {
      const key = await generateKeyMaterial(alg)
      if (key.kind === 'secret') {
        setSecret(key.secret)
        setSecretIsB64(true)
      } else {
        setPrivateKey(key.privatePem)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  // ---- live signing ------------------------------------------------------
  useEffect(() => {
    const seq = ++signSeq.current
    if (!hasKey) {
      setToken('')
      return
    }
    let h: string
    let p: string
    let header: unknown
    let payload: unknown
    try {
      header = JSON.parse(headerJson)
      payload = JSON.parse(payloadJson)
      h = minifyJson(headerJson)
      p = minifyJson(payloadJson)
    } catch {
      setToken('')
      setError('Header or payload is not valid JSON.')
      return
    }
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
    if (!isObj(header) || !isObj(payload)) {
      setToken('')
      setError('Header and payload must be JSON objects.')
      return
    }
    const mismatch = headerAlgProblem(header, alg)
    if (mismatch) {
      setToken('')
      setError(mismatch)
      return
    }
    setError(null)
    const key = isHmac(alg) ? { text: secret, secretIsB64 } : { text: privateKey, secretIsB64: false }
    const t = setTimeout(() => {
      signJws(alg, h, p, key)
        .then((tok) => {
          if (signSeq.current === seq) {
            setToken(tok)
            setError(null)
          }
        })
        .catch((err) => {
          if (signSeq.current === seq) {
            setToken('')
            setError(err instanceof Error ? err.message : String(err))
          }
        })
    }, 250)
    return () => clearTimeout(t)
  }, [alg, headerJson, payloadJson, secret, secretIsB64, privateKey, hasKey])

  const claims = useMemo(() => {
    try {
      return describeTimeClaims(JSON.parse(payloadJson) as Record<string, unknown>, now)
    } catch {
      return []
    }
  }, [payloadJson, now])

  const nowSec = () => Math.floor(Date.now() / 1000)

  return (
    <div className="jwt-panes">
      <div className="jwt-col">
        <Card tone="p" title="claims (payload)">
          <JsonEditor value={payloadJson} onChange={setPayloadJson} minRows={7} ariaLabel="Payload JSON" />
          <div className="jwt-chiprow">
            <span className="jwt-chiprow-label">quick claims</span>
            <button onClick={() => mergeClaims({ iat: nowSec() })}>iat = now</button>
            <span className="jwt-expgroup">
              <button onClick={() => mergeClaims({ exp: nowSec() + expChoice })}>exp = now +</button>
              <select value={expChoice} onChange={(e) => setExpChoice(Number(e.target.value))} aria-label="Expiry duration">
                {EXP_CHOICES.map(([label, sec]) => (
                  <option key={label} value={sec}>
                    {label}
                  </option>
                ))}
              </select>
            </span>
            <button onClick={() => mergeClaims({ nbf: nowSec() })}>nbf = now</button>
            <button onClick={() => mergeClaims({ jti: crypto.randomUUID() })}>jti = uuid</button>
          </div>
        </Card>

        <Card tone="h" title="header">
          <JsonEditor value={headerJson} onChange={onHeaderChange} minRows={3} ariaLabel="Header JSON" />
        </Card>

        <Card
          tone="s"
          title="signing key"
          actions={
            <button onClick={() => void generateKey()} disabled={generating} title="Generate fresh key material for the selected algorithm">
              {generating ? 'Generating…' : isHmac(alg) ? 'Random secret' : 'Generate keypair'}
            </button>
          }
        >
          <div className="jwt-form">
            <label className="jwt-form-row">
              <span className="jwt-form-label">alg</span>
              <select value={alg} onChange={(e) => onAlgChange(e.target.value as Alg)} aria-label="Signing algorithm">
                {ALGS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {isHmac(alg) ? (
              <div className="jwt-form-row">
                <span className="jwt-form-label" aria-hidden>secret</span>
                <input
                  className="mono"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="enter or generate a secret"
                  spellCheck={false}
                  aria-label="HMAC secret"
                />
                <label className="jwt-check">
                  <input
                    type="checkbox"
                    checked={secretIsB64}
                    onChange={(e) => setSecretIsB64(e.target.checked)}
                  />
                  base64url
                </label>
              </div>
            ) : (
              <div className="jwt-keys single">
                <textarea
                  className="mono"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder={'Private key to sign with\n-----BEGIN PRIVATE KEY----- or JWK — or click Generate keypair'}
                  spellCheck={false}
                  aria-label="Private key to sign with"
                />
              </div>
            )}
            <p className="jwt-hint">Everything runs locally — generated keys never leave this page.</p>
          </div>
        </Card>
      </div>

      <div className="jwt-col">
        <Card
          title="generated token"
          fill
          actions={<button onClick={() => void onCopy(token, 'Token')} disabled={!token} aria-label="Copy"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>}
        >
          {token ? (
            <>
              <div className="jwt-token-out mono">
                <ColoredToken token={token} />
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
                        <td>{c.relative}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="jwt-empty">
              {error ? null : hasKey ? 'Signing…' : isHmac(alg)
                ? 'Enter (or generate) a secret to produce a signed token.'
                : 'Paste or generate a private key to produce a signed token.'}
            </div>
          )}
          {error && <div className="jwt-error">{error}</div>}
        </Card>

        {publicPem && (
          <Card
            title="public key (share this to verify)"
            actions={<button onClick={() => void onCopy(publicPem, 'Public key')} aria-label="Copy"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>}
          >
            <textarea className="jwt-pubkey mono" value={publicPem} readOnly spellCheck={false} aria-label="Generated public key" />
          </Card>
        )}
      </div>
    </div>
  )
}
