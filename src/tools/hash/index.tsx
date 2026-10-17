import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import {
  compareDigest, decodeKey, digestAll, encodeDigest, hmacAll, utf8,
  type DigestRow, type KeyEncoding, type OutputEncoding,
} from './hash'
import './hash.css'

const SAMPLE = 'The Swiss Knife — local by design ✓'

interface FileSource { kind: 'file'; name: string; size: number; bytes: Uint8Array<ArrayBuffer> }

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

export default function HashTool() {
  const [text, setText] = useState(SAMPLE)
  const [file, setFile] = useState<FileSource | null>(null)
  const [reading, setReading] = useState(false)
  const [key, setKey] = useState('')
  const [keyEncoding, setKeyEncoding] = useState<KeyEncoding>('utf8')
  const [output, setOutput] = useState<OutputEncoding>('hex')
  const [expected, setExpected] = useState('')
  const [rows, setRows] = useState<DigestRow[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const data = useMemo(() => file ? file.bytes : utf8(text), [file, text])
  const keyResult = useMemo(() => key ? decodeKey(key, keyEncoding) : null, [key, keyEncoding])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const plain = await digestAll(data)
        const macs = keyResult?.bytes && keyResult.bytes.length > 0 ? await hmacAll(keyResult.bytes, data) : []
        if (!cancelled) { setRows([...plain, ...macs]); setError('') }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
    return () => { cancelled = true }
  }, [data, keyResult])

  const comparison = useMemo(() => compareDigest(expected, rows), [expected, rows])
  const matched = new Set(comparison.status === 'match' ? comparison.matches.map((m) => m.id) : [])

  const openFile = async (picked: File | undefined) => {
    if (!picked) return
    setReading(true)
    try {
      const bytes = new Uint8Array(await picked.arrayBuffer())
      setFile({ kind: 'file', name: picked.name, size: picked.size, bytes })
    } catch (err) {
      showToast(`Could not read file: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReading(false)
    }
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFile(event.dataTransfer.files[0])
  }

  const plainRows = rows.filter((row) => !row.hmac)
  const macRows = rows.filter((row) => row.hmac)
  const keyEmptyBytes = keyResult?.bytes && keyResult.bytes.length === 0

  const renderRows = (list: DigestRow[]) => list.map((row) => {
    const value = encodeDigest(row.bytes, output)
    const isMatch = matched.has(row.id)
    return (
      <div className={`hash-row${isMatch ? ' is-match' : ''}`} key={row.id}>
        <span className="hash-alg">{row.id}{isMatch && <span className="hash-badge">match</span>}</span>
        <code className="hash-value">{value}</code>
        <button onClick={() => void copy(value, row.id)} aria-label={`Copy ${row.id}`} title={`Copy ${row.id}`}><span className="material-symbols-outlined">content_copy</span></button>
      </div>
    )
  })

  return (
    <div className="hash-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent">#</span> Hash &amp; HMAC</>}
        localLabel="WebCrypto · local"
      >
        <button onClick={() => { setFile(null); setText(SAMPLE) }} aria-label="Reset to sample" title="Reset to sample text"><span className="material-symbols-outlined">auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="hash-main">
        <section className="hash-grid">
          <article className="hash-pane">
            <header>
              <div><span className="hash-step">01</span><strong>Input</strong></div>
              <span>{file ? `${file.name} · ${formatBytes(file.size)}` : `${text.length.toLocaleString()} chars · ${formatBytes(data.length)} UTF-8`}</span>
              <button onClick={() => fileRef.current?.click()} aria-label="Choose file" title="Hash a file"><span className="material-symbols-outlined">upload_file</span></button>
              <button onClick={() => { setFile(null); setText('') }} disabled={!file && !text} aria-label="Clear" title="Clear"><span className="material-symbols-outlined">close</span></button>
              <input ref={fileRef} type="file" hidden onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
            </header>
            <div
              className={`hash-drop${dragging ? ' dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={drop}
            >
              {file ? (
                <div className="hash-file">
                  <span className="material-symbols-outlined" aria-hidden>description</span>
                  <strong>{file.name}</strong>
                  <span>{formatBytes(file.size)} · read in this browser, not uploaded</span>
                  <button onClick={() => setFile(null)}>Back to text</button>
                </div>
              ) : (
                <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} aria-label="Text to hash" placeholder="Type or paste text (hashed as UTF-8), or drop a file here" />
              )}
              {reading && <div className="hash-reading">Reading file…</div>}
            </div>
          </article>

          <article className="hash-pane hash-side">
            <header><div><span className="hash-step">02</span><strong>HMAC key</strong></div><span>optional</span></header>
            <div className="hash-side-body">
              <div className="hash-seg" role="group" aria-label="Key encoding">
                {(['utf8', 'hex', 'base64'] as const).map((enc) => (
                  <button key={enc} className={keyEncoding === enc ? 'on' : ''} aria-pressed={keyEncoding === enc} onClick={() => setKeyEncoding(enc)}>
                    {enc === 'utf8' ? 'Text' : enc === 'hex' ? 'Hex' : 'Base64'}
                  </button>
                ))}
              </div>
              <input className="hash-input" value={key} onChange={(event) => setKey(event.target.value)} spellCheck={false} autoComplete="off" aria-label="HMAC key" placeholder={keyEncoding === 'utf8' ? 'secret' : keyEncoding === 'hex' ? '0b0b0b…' : 'c2VjcmV0'} />
              {keyResult?.error && <p className="hash-error" role="alert">{keyResult.error}</p>}
              {keyEmptyBytes && <p className="hash-note">Key decodes to zero bytes — enter at least one byte.</p>}
              <p className="hash-note">Enter a key to add HMAC-SHA rows. The key is never stored.</p>

              <div className="hash-step-head"><span className="hash-step">03</span><strong>Compare</strong></div>
              <input className="hash-input" value={expected} onChange={(event) => setExpected(event.target.value)} spellCheck={false} autoComplete="off" aria-label="Expected checksum" placeholder="Paste expected checksum (hex or Base64)" />
              <p className={`hash-compare is-${comparison.status}`} role="status">
                {comparison.status === 'empty' && 'Paste a bare checksum or a sha256sum line. Hex is matched case-insensitively.'}
                {comparison.status === 'invalid' && 'Not hex or Base64.'}
                {comparison.status === 'none' && 'No match against any digest below.'}
                {comparison.status === 'match' && `Matches ${comparison.matches.map((m) => `${m.id} (${m.encoding === 'hex' ? 'hex' : 'Base64'})`).join(', ')}`}
              </p>
            </div>
          </article>
        </section>

        <section className="hash-pane hash-results" aria-label="Digests">
          <header>
            <div><span className="hash-step">04</span><strong>Digests</strong></div>
            <div className="hash-seg" role="group" aria-label="Output encoding">
              <button className={output === 'hex' ? 'on' : ''} aria-pressed={output === 'hex'} onClick={() => setOutput('hex')}>Hex</button>
              <button className={output === 'base64' ? 'on' : ''} aria-pressed={output === 'base64'} onClick={() => setOutput('base64')}>Base64</button>
            </div>
          </header>
          {error ? <div className="hash-error" role="alert">{error}</div> : (
            <div className="hash-rows">
              {renderRows(plainRows)}
              {macRows.length > 0 && renderRows(macRows)}
            </div>
          )}
        </section>
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
