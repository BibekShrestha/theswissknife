import { useDeferredValue, useMemo, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { generate, targets, type Target } from './generate'
import { parseCurl, splitPairs, splitUrl, type CurlRequest } from './parse'
import { findSecrets, maskValue, redactInput } from './secrets'
import type { Dialect } from './tokenize'
import { describeBody } from './view'
import './curl.css'

const SAMPLE = `curl 'https://api.example.com/v2/orders?status=open&api_key=demo_k3y_9f8e7d6c5b4a' \\
  -H 'accept: application/json' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.c2lnbmF0dXJl' \\
  -H 'content-type: application/json' \\
  -b 'session_id=demo-5e55-10n; theme=dark' \\
  -H 'origin: https://app.example.com' \\
  -H 'referer: https://app.example.com/orders' \\
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36' \\
  --data-raw $'{"item":"Widget","qty":2,"note":"Don\\'t ship before Friday"}'`

type Tab = 'request' | Target

const dialectLabel: Record<Dialect, string> = { bash: 'bash', cmd: 'Windows cmd' }

export default function CurlTool() {
  const [input, setInput] = useState(SAMPLE)
  const [choice, setChoice] = useState<Dialect | 'auto'>('auto')
  const [tab, setTab] = useState<Tab>('request')
  const [undo, setUndo] = useState<string | null>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const deferred = useDeferredValue(input)
  const parsed = useMemo(() => parseCurl(deferred, choice), [deferred, choice])
  const secrets = useMemo(() => findSecrets(parsed), [parsed])
  const code = useMemo(() => (parsed.ok && tab !== 'request' ? generate(tab, parsed.request) : ''), [parsed, tab])
  const stale = deferred !== input
  const target = targets.find((item) => item.id === tab)
  const warnings = parsed.notes.filter((note) => note.level === 'warn')
  const infos = parsed.notes.filter((note) => note.level === 'info')

  const edit = (next: string) => {
    setInput(next)
    setUndo(null)
  }

  const replace = () => {
    if (stale || !secrets.length) return
    setUndo(input)
    setInput(redactInput(parsed, secrets))
    showToast(`${secrets.length} ${secrets.length === 1 ? 'value' : 'values'} replaced with placeholders`)
  }

  return (
    <div className="curl-app">
      <ToolHeader brand={<><span className="material-symbols-outlined" aria-hidden>code</span> cURL converter</>} localLabel="never sent">
        <button type="button" onClick={() => edit(SAMPLE)} aria-label="Load the sample command" title="Sample">
          <span className="material-symbols-outlined" aria-hidden>auto_fix_high</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="curl-main">
        <p className="curl-notice">
          Paste a browser’s “Copy as cURL” (Chrome, Firefox or Safari; bash or Windows cmd). The command is only read and rewritten here — the request is never sent, and what you paste stays in your browser.
        </p>

        <div className="curl-grid">
          <div className="curl-col">
            <section className="curl-pane" aria-labelledby="curl-input-title">
              <header>
                <h2 id="curl-input-title">Command</h2>
                <div className="curl-seg" role="group" aria-label="Shell syntax">
                  {(['auto', 'bash', 'cmd'] as const).map((item) => (
                    <button key={item} type="button" className={choice === item ? 'on' : ''} aria-pressed={choice === item} onClick={() => setChoice(item)}>
                      {item === 'auto' ? 'Auto' : dialectLabel[item]}
                    </button>
                  ))}
                </div>
                <span className="curl-detect">
                  {choice === 'auto' ? `Detected ${dialectLabel[parsed.detected]}` : `Reading as ${dialectLabel[choice]}${parsed.detected !== choice ? ` (looks like ${dialectLabel[parsed.detected]})` : ''}`}
                </span>
                <button type="button" className="curl-icon-btn" onClick={() => edit('')} disabled={!input} aria-label="Clear the command" title="Clear">
                  <span className="material-symbols-outlined" aria-hidden>close</span>
                </button>
              </header>
              <textarea
                value={input}
                onChange={(event) => edit(event.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                aria-label="curl command"
                aria-invalid={!parsed.ok && Boolean(input.trim())}
                placeholder="curl 'https://example.com/api' -H 'accept: application/json'"
              />
              {!parsed.ok && input.trim() && <p className="curl-error" role="alert">{parsed.error}</p>}
            </section>

            {(warnings.length > 0 || infos.length > 0) && (
              <section className="curl-notes" aria-labelledby="curl-notes-title">
                <h2 id="curl-notes-title">Notes <span>{warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}</span></h2>
                <ul>
                  {[...warnings, ...infos].map((note) => (
                    <li key={note.text} className={note.level === 'warn' ? 'warn' : ''}>
                      <span className="material-symbols-outlined" aria-hidden>{note.level === 'warn' ? 'warning' : 'info'}</span>
                      <span><span className="curl-sr">{note.level === 'warn' ? 'Warning: ' : 'Note: '}</span>{note.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="curl-secrets" aria-labelledby="curl-secrets-title">
              <header>
                <h2 id="curl-secrets-title">Secrets <span>{secrets.length} found</span></h2>
                {undo !== null && (
                  <button type="button" onClick={() => { setInput(undo); setUndo(null) }}>Undo</button>
                )}
                <button type="button" className="curl-primary" onClick={replace} disabled={!secrets.length || stale}>
                  <span className="material-symbols-outlined" aria-hidden>visibility_off</span> Replace with placeholders
                </button>
              </header>
              {secrets.length > 0 ? (
                <ul>
                  {secrets.map((secret) => (
                    <li key={`${secret.token}:${secret.start}`}>
                      <span>{secret.label}</span>
                      <code title={`${secret.value.length} characters`}>{maskValue(secret.value)}</code>
                      <code className="curl-placeholder">{secret.placeholder}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="curl-empty">
                  <span className="material-symbols-outlined" aria-hidden>check_circle</span> Nothing that looks like a credential.
                </p>
              )}
              <p className="curl-fine">
                Looks at Authorization headers, every cookie (-b or Cookie), -u, --oauth2-bearer, URL user:password, headers named like
                x-api-key or *-token, token / key / sig / password-style fields in the query, form and JSON body, and JWT-shaped values —
                then at any other place the same value appears. Replacing rewrites the command above, so every output follows it.
              </p>
            </section>
          </div>

          <section className="curl-pane curl-out" aria-label="Output">
            <header>
              <div className="curl-tabs" role="tablist" aria-label="Output format">
                <button type="button" role="tab" aria-selected={tab === 'request'} className={tab === 'request' ? 'on' : ''} onClick={() => setTab('request')}>Request</button>
                {targets.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
                ))}
              </div>
              {parsed.ok && (target
                ? <button type="button" onClick={() => void copy(code, target.language)}><span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy {target.language}</button>
                : <button type="button" onClick={() => void copy(parsed.request.url, 'URL')}><span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy URL</button>)}
            </header>
            <div className="curl-out-body" role="tabpanel" aria-label={target ? target.language : 'Parsed request'}>
              {!parsed.ok
                ? <p className="curl-empty">{input.trim() ? 'Fix the command to see the request.' : 'Paste a curl command to convert it.'}</p>
                : target
                  ? <pre className="curl-code"><code>{code}</code></pre>
                  : <RequestView request={parsed.request} />}
            </div>
          </section>
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}

function RequestView({ request }: { request: CurlRequest }) {
  const parts = splitUrl(request.url)
  const query = splitPairs(parts.query)
  const body = describeBody(request)
  const options = [
    request.followRedirects ? 'Follows redirects (-L)' : 'Does not follow redirects',
    request.insecure && 'Skips certificate checks (-k)',
    request.compressed && 'Asks for a compressed response (--compressed)',
  ].filter(Boolean) as string[]

  return (
    <div className="curl-request">
      <div className="curl-reqline">
        <span className="curl-method">{request.method}</span>
        <code>{request.url}</code>
      </div>
      <ul className="curl-chips" aria-label="Options">
        {options.map((option) => <li key={option}>{option}</li>)}
      </ul>

      {query.length > 0 && (
        <section>
          <h3>Query <span>{query.length}</span></h3>
          <table className="curl-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Value (decoded)</th></tr></thead>
            <tbody>{query.map((pair, index) => <tr key={index}><td>{pair.name}</td><td>{pair.value}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Headers <span>{request.headers.length + (request.auth ? 1 : 0)}</span></h3>
        {request.headers.length || request.auth ? (
          <table className="curl-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {request.auth && <tr><td>Authorization <em>from -u</em></td><td>Basic, user “{request.auth.user}”{request.auth.password ? ', with a password' : ', no password'}</td></tr>}
              {request.headers.map((header, index) => <tr key={index}><td>{header.name}</td><td>{header.value}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="curl-muted">Only curl’s defaults.</p>}
        {request.removed.length > 0 && <p className="curl-muted">Removed: {request.removed.join(', ')} (-H &apos;Name:&apos; stops curl sending its own)</p>}
      </section>

      {body && (
        <section>
          <h3>Body</h3>
          {body.kind === 'json' && <pre className="curl-code">{body.pretty}</pre>}
          {body.kind === 'text' && <pre className="curl-code">{body.text || '(empty)'}</pre>}
          {body.kind === 'file' && <p className="curl-muted">Read from the file {body.path}{body.stripNewlines ? ' (curl -d strips CR and LF from it)' : ''}.</p>}
          {body.kind === 'form' && (
            <table className="curl-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Value (decoded)</th></tr></thead>
              <tbody>{body.fields.map((field, index) => <tr key={index}><td>{field.name}</td><td>{field.value}</td></tr>)}</tbody>
            </table>
          )}
          {body.kind === 'multipart' && (
            <table className="curl-table">
              <thead><tr><th scope="col">Part</th><th scope="col">Content</th></tr></thead>
              <tbody>
                {body.parts.map((part, index) => (
                  <tr key={index}>
                    <td>{part.name}{part.filename !== undefined && <em> file “{part.filename}”</em>}{part.type && <em> {part.type}</em>}</td>
                    <td>{part.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
