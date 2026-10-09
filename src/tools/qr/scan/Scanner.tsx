import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useCopy } from '../../../shell/useCopy'
import { Panel } from '../panel'
import { createScanner, Superseded, type ScanResult } from './decode'
import type { Found } from './engine'
import { describe, type Field } from './parse'

type State =
  | { phase: 'idle' }
  | { phase: 'scanning'; name: string; fallback: boolean }
  | { phase: 'done'; name: string; result: ScanResult }
  | { phase: 'error'; name: string; message: string }

/** First image on a clipboard or in a drop, if there is one. */
function firstImage(files: Iterable<File> | ArrayLike<File>): File | undefined {
  return Array.from(files).find((f) => f.type.startsWith('image/'))
}

export default function Scanner({ active, showToast }: { active: boolean; showToast: (message: string) => void }) {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const scannerRef = useRef<ReturnType<typeof createScanner>>(null)
  const copy = useCopy(showToast)

  useEffect(() => {
    const scanner = createScanner(() => new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' }))
    scannerRef.current = scanner
    return () => {
      scannerRef.current = null
      scanner.dispose()
    }
  }, [])

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const scan = async (blob: Blob, name: string) => {
    const scanner = scannerRef.current
    if (!scanner) return
    setPreview(URL.createObjectURL(blob))
    setState({ phase: 'scanning', name, fallback: false })
    try {
      const result = await scanner.scan(blob, () => setState({ phase: 'scanning', name, fallback: true }))
      setState({ phase: 'done', name, result })
    } catch (e) {
      if (!(e instanceof Superseded)) setState({ phase: 'error', name, message: (e as Error).message })
    }
  }

  const take = (file: File | undefined, origin: string) => {
    if (file) void scan(file, file.name && file.name !== 'image.png' ? file.name : origin)
    else showToast(`No image in the ${origin.toLowerCase()} — copy a screenshot or image of the code`)
  }

  // ⌘V / Ctrl+V anywhere while the Scan tab is showing.
  useEffect(() => {
    if (!active) return
    const onPaste = (e: ClipboardEvent) => {
      // Leave pastes into a field (the ⌘K search) alone.
      const target = e.target as HTMLElement | null
      if (!e.clipboardData || target?.closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
      take(firstImage(e.clipboardData.files), 'Pasted image')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const pasteButton = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return void scan(await item.getType(type), 'Pasted image')
      }
      showToast('No image on the clipboard — copy a screenshot or image of the code')
    } catch {
      showToast(`This browser will not read the clipboard from a button — press ${/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'}V instead`)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    take(firstImage(e.dataTransfer.files), 'Dropped file')
  }

  const reset = () => {
    setState({ phase: 'idle' })
    setPreview(null)
  }

  const result = state.phase === 'done' ? state.result : null
  const found = result?.found ?? []
  // Outline labels scale with the picture so they read the same at any size.
  const labelSize = result ? Math.max(14, Math.max(result.width, result.height) / 40) : 0

  return (
    <div
      className={`qr-main${dragging ? ' is-dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={onDrop}
    >
      <div className="qr-left">
        <Panel step="01" title="Image" hint="Screenshot, photo or saved code · every code in it is read">
          <div className="qr-actions">
            <label className="qr-primary qr-file">
              <input type="file" accept="image/*" onChange={(e) => { take(e.target.files?.[0], 'File'); e.target.value = '' }} />
              <span className="material-symbols-outlined" aria-hidden>upload_file</span> Choose image
            </label>
            <button onClick={() => void pasteButton()}><span className="material-symbols-outlined" aria-hidden>content_paste</span> Paste image</button>
            {state.phase !== 'idle' && <button onClick={reset}><span className="material-symbols-outlined" aria-hidden>close</span> Clear</button>}
          </div>

          {preview ? (
            <figure className="qr-shot">
              <div className="qr-shot-frame">
                {result ? (
                  // Picture and outline share one viewBox, so the outline cannot drift
                  // from the code however the box is sized.
                  <svg viewBox={`0 0 ${result.width} ${result.height}`} width={result.width} height={result.height} role="img" aria-label={`Scanned image: ${state.phase === 'done' ? state.name : ''}`}>
                    <image href={preview} width={result.width} height={result.height} />
                    {found.map((f, i) => (
                      <g key={i}>
                        <polygon points={f.corners.map((p) => `${p.x},${p.y}`).join(' ')} vectorEffect="non-scaling-stroke" />
                        {found.length > 1 && (
                          <text x={centre(f).x} y={centre(f).y} fontSize={labelSize} textAnchor="middle" dominantBaseline="central">{i + 1}</text>
                        )}
                      </g>
                    ))}
                  </svg>
                ) : (
                  <img src={preview} alt={state.phase === 'idle' ? '' : `Scanned image: ${state.name}`} />
                )}
              </div>
              {state.phase !== 'idle' && <figcaption>{state.name}{result && ` · ${result.width}×${result.height}`}</figcaption>}
            </figure>
          ) : (
            <div className="qr-drop qr-dropzone" aria-hidden>
              <span className="material-symbols-outlined">qr_code_scanner</span>
              <span>Drop an image here, or press <kbd>{/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'}V</kbd> to paste a screenshot</span>
              <small>PNG, JPEG, WebP, GIF, SVG… decoded on this device; nothing is uploaded or stored, and the camera is never used</small>
            </div>
          )}
        </Panel>
      </div>

      <aside className="qr-right" aria-label="Decoded content" aria-live="polite">
        {state.phase === 'idle' && <Empty icon="center_focus_weak" text="The decoded content appears here." />}
        {state.phase === 'scanning' && (
          <Empty
            icon="progress_activity"
            text={state.fallback
              ? 'Nothing yet — trying the deep decoder. The first time, it loads ~2.5 MB from this site, then works offline.'
              : 'Looking for QR codes…'}
          />
        )}
        {state.phase === 'error' && <Empty icon="error" text={state.message} bad />}
        {state.phase === 'done' && !found.length && (
          <Empty
            icon="search_off"
            text="No QR code found. Crop closer to the code, make sure all four corners and some margin are in the picture, and avoid glare."
            bad
          />
        )}
        {found.length > 1 && <p className="qr-found-count">{found.length} codes found — numbered on the image</p>}
        {found.map((f, i) => (
          <Decoded key={i} found={f} index={found.length > 1 ? i + 1 : undefined} engine={result!.engine!} onCopy={(value, label) => void copy(value, label)} />
        ))}
      </aside>
    </div>
  )
}

function Empty({ icon, text, bad }: { icon: string; text: string; bad?: boolean }) {
  return (
    <div className={`qr-empty qr-scan-empty${bad ? ' qr-bad' : ''}`} role={bad ? 'alert' : undefined}>
      <span className="material-symbols-outlined" aria-hidden>{icon}</span>
      {text}
    </div>
  )
}

const centre = (f: Found) => ({
  x: f.corners.reduce((s, p) => s + p.x, 0) / 4,
  y: f.corners.reduce((s, p) => s + p.y, 0) / 4,
})

const ENGINE_LABEL = { zxing: 'ZXing', wechat: 'WeChat decoder' }

function Decoded({ found, index, engine, onCopy }: { found: Found; index?: number; engine: keyof typeof ENGINE_LABEL; onCopy: (value: string, label: string) => void }) {
  const { text, version, bytes, ecLevel } = found
  const info = describe(text)
  return (
    <div className="qr-decoded">
      <header className="qr-decoded-head">
        {index !== undefined && <span className="qr-found-index">{index}</span>}
        <span className="material-symbols-outlined" aria-hidden>{info.icon}</span>
        <strong>{info.label}</strong>
      </header>
      <p className="qr-stats">
        {version !== undefined && <span>v{version}</span>}
        {version !== undefined && <span>{17 + version * 4}×{17 + version * 4}</span>}
        {ecLevel && <span>ECC {ecLevel}</span>}
        {bytes !== undefined && <span>{bytes.toLocaleString()} B</span>}
        <span title="The decoder that read this code">{ENGINE_LABEL[engine]}</span>
      </p>

      {info.fields.length > 0 && (
        <dl className="qr-fields">
          {info.fields.map((f) => <FieldRow key={f.label} field={f} onCopy={onCopy} />)}
        </dl>
      )}

      {info.href && (
        <div className="qr-open">
          <a className="qr-primary" href={info.href} target="_blank" rel="noopener noreferrer">
            <span className="material-symbols-outlined" aria-hidden>open_in_new</span> Open link
          </a>
          <p className="qr-note">Check the host above first — a QR code hides where it leads, which makes it a favourite for phishing.</p>
        </div>
      )}

      {/* Collapsed when it holds a secret, or it would show the masked password in full. */}
      <details className="qr-raw-out" open={!info.fields.some((f) => f.secret) || undefined}>
        <summary className="qr-label">Raw content · {text.length.toLocaleString()} characters</summary>
        <pre>{text}</pre>
        <div className="qr-actions">
          <button onClick={() => onCopy(text, 'Content')}><span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy</button>
        </div>
      </details>
    </div>
  )
}

function FieldRow({ field, onCopy }: { field: Field; onCopy: (value: string, label: string) => void }) {
  const [shown, setShown] = useState(!field.secret)
  return (
    <div className="qr-field-row">
      <dt>{field.label}</dt>
      <dd>
        <span className={shown ? '' : 'qr-masked'}>{shown ? field.value : '•'.repeat(Math.min(12, field.value.length))}</span>
        {field.secret && (
          <button className="qr-icon" onClick={() => setShown((v) => !v)} aria-label={shown ? `Hide ${field.label}` : `Show ${field.label}`}>
            <span className="material-symbols-outlined" aria-hidden>{shown ? 'visibility_off' : 'visibility'}</span>
          </button>
        )}
        <button className="qr-icon" onClick={() => onCopy(field.value, field.label)} aria-label={`Copy ${field.label}`}>
          <span className="material-symbols-outlined" aria-hidden>content_copy</span>
        </button>
      </dd>
    </div>
  )
}
