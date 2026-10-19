import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ErrorText } from '../components/ErrorText'
import { addPoint, endStroke, type Pt } from './pad'
import { drawnSignature, INK_COLORS, paintStrokes, PEN_WIDTH, pickedSignature, SCRIPT_FONTS, typedSignature, type SignatureImage } from './raster'

type Mode = 'pad' | 'typed' | 'file'
const MODES: { id: Mode; label: string }[] = [
  { id: 'pad', label: 'Draw' },
  { id: 'typed', label: 'Type' },
  { id: 'file', label: 'Upload' },
]

const PAD_HEIGHT = 180

interface Props {
  onClose: () => void
  onDone: (signature: SignatureImage) => void
}

/** The drawing surface: pointer events (mouse, pen, touch), each stroke smoothed as it is drawn. */
function DrawPad({ strokes, setStrokes, color, onSize }: { strokes: Pt[][]; setStrokes: (s: Pt[][]) => void; color: string; onSize: (w: number, h: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef<Pt[] | null>(null)
  const lastRaw = useRef<Pt | undefined>(undefined)
  const [width, setWidth] = useState(0)

  // the pad fills the dialog's width; its backing store follows the device pixel ratio
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    onSize(width, PAD_HEIGHT)
  }, [width, onSize])

  const repaint = (extra?: Pt[]) => {
    const el = canvas.current
    if (!el || !width) return
    const dpr = window.devicePixelRatio || 1
    if (el.width !== Math.round(width * dpr)) {
      el.width = Math.round(width * dpr)
      el.height = Math.round(PAD_HEIGHT * dpr)
    }
    const ctx = el.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, el.width, el.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintStrokes(ctx, extra ? [...strokes, extra] : strokes, color, PEN_WIDTH)
  }

  useEffect(() => repaint(), [strokes, color, width]) // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = []
    lastRaw.current = point(e)
    addPoint(live.current, lastRaw.current)
    repaint(live.current)
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    const stroke = live.current
    if (!stroke) return
    // coalesced events carry every sample since the last frame: smoother curves on fast strokes
    const samples = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : []
    let changed = false
    const r = e.currentTarget.getBoundingClientRect()
    for (const s of samples.length ? samples : [e.nativeEvent]) {
      lastRaw.current = { x: s.clientX - r.left, y: s.clientY - r.top }
      changed = addPoint(stroke, lastRaw.current) || changed
    }
    if (changed) repaint(stroke)
  }

  function up() {
    const stroke = live.current
    live.current = null
    if (!stroke || !stroke.length) return
    endStroke(stroke, lastRaw.current)
    lastRaw.current = undefined
    setStrokes([...strokes, stroke])
  }

  return (
    <canvas
      ref={canvas}
      className="pdf-fs-pad"
      style={{ height: PAD_HEIGHT }}
      role="img"
      aria-label="Signature drawing pad: draw with a mouse, pen or finger. With a keyboard, use the Type or Upload tab instead."
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  )
}

/**
 * Makes a signature image: drawn on a pad, typed in a handwriting font, or
 * picked from a file. A modal dialog — focus moves in, stays in, and goes
 * back to the opener on close (PdfPreviewModal's pattern).
 */
export function SignatureDialog({ onClose, onDone }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const [mode, setMode] = useState<Mode>('pad')
  const [color, setColor] = useState<string>(INK_COLORS[0].value)
  const [strokes, setStrokes] = useState<Pt[][]>([])
  const padSize = useRef({ width: 0, height: PAD_HEIGHT })
  const onPadSize = useCallback((width: number, height: number) => {
    padSize.current = { width, height }
  }, [])
  const [typed, setTyped] = useState('')
  const [font, setFont] = useState<string>(SCRIPT_FONTS[0].id)
  const [clearPaper, setClearPaper] = useState(true)
  const [picked, setPicked] = useState<File | null>(null)
  const [upload, setUpload] = useState<SignatureImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const uploadRef = useRef<SignatureImage | null>(null)
  const handedOver = useRef(false)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    tabs.current[0]?.focus()
    return () => {
      // a preview that was never used is discarded with the dialog
      if (!handedOver.current && uploadRef.current) URL.revokeObjectURL(uploadRef.current.url)
      opener?.focus()
    }
  }, [])

  // a picked image is converted as soon as it is chosen, so the preview shows what will be placed
  useEffect(() => {
    if (!picked) return
    let cancelled = false
    setError('')
    pickedSignature(picked, clearPaper).then(
      (sig) => {
        if (cancelled) return URL.revokeObjectURL(sig.url)
        if (uploadRef.current) URL.revokeObjectURL(uploadRef.current.url)
        uploadRef.current = sig
        setUpload(sig)
      },
      (e: Error) => {
        if (cancelled) return
        if (uploadRef.current) URL.revokeObjectURL(uploadRef.current.url)
        uploadRef.current = null
        setUpload(null)
        setError(e.message)
      },
    )
    return () => {
      cancelled = true
    }
  }, [picked, clearPaper])

  const stack = SCRIPT_FONTS.find((f) => f.id === font)!.stack
  const ready = mode === 'pad' ? strokes.length > 0 : mode === 'typed' ? typed.trim() !== '' : upload !== null

  async function use() {
    setBusy(true)
    setError('')
    try {
      let sig: SignatureImage | null = null
      if (mode === 'pad') sig = await drawnSignature(strokes, color, padSize.current.width, padSize.current.height)
      else if (mode === 'typed') sig = await typedSignature(typed, stack, color)
      else sig = upload
      if (!sig) {
        setError(mode === 'typed' ? 'Nothing visible was drawn for that text — try another style.' : 'Draw a signature first.')
        return
      }
      handedOver.current = sig === upload
      if (sig !== upload && uploadRef.current) URL.revokeObjectURL(uploadRef.current.url)
      uploadRef.current = null
      onDone(sig)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The signature could not be made.')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !dialog.current) return
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function onTabKey(e: KeyboardEvent, i: number) {
    const n = MODES.length
    const next = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (next < 0) return
    e.preventDefault()
    setMode(MODES[next].id)
    setError('')
    tabs.current[next]?.focus()
  }

  const inkPicker = (
    <div className="pdf-fs-row" role="group" aria-label="Ink colour">
      <span className="pdf-fs-row-label" aria-hidden="true">Ink</span>
      {INK_COLORS.map((c) => (
        <button key={c.id} type="button" className="pdf-fs-chip" aria-pressed={color === c.value} onClick={() => setColor(c.value)}>
          <span className="pdf-fs-swatch" style={{ background: c.value }} aria-hidden="true" />
          {c.label}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div className="pdf-preview-backdrop" onClick={onClose} />
      <div className="pdf-preview-modal pdf-fs-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-privacy`} ref={dialog} onKeyDown={onKeyDown}>
        <div className="pdf-preview-head">
          <h3 id={`${id}-title`}>Add a signature</h3>
          <div className="pdf-preview-controls">
            <button type="button" onClick={onClose} aria-label="Close">
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
        <div className="pdf-fs-dialog-body">
          <div className="pdf-fs-tabs" role="tablist" aria-label="How to make the signature">
            {MODES.map((m, i) => (
              <button
                key={m.id}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${m.id}`}
                aria-selected={mode === m.id}
                aria-controls={`${id}-panel`}
                tabIndex={mode === m.id ? 0 : -1}
                className={`pdf-fs-tab${mode === m.id ? ' on' : ''}`}
                onClick={() => {
                  setMode(m.id)
                  setError('')
                }}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${mode}`} className="pdf-fs-panel">
            {mode === 'pad' && (
              <>
                <DrawPad strokes={strokes} setStrokes={setStrokes} color={color} onSize={onPadSize} />
                <div className="pdf-fs-row">
                  {inkPicker}
                  <span className="pdf-fs-spacer" />
                  <button type="button" className="pdf-fs-btn" disabled={strokes.length === 0} onClick={() => setStrokes(strokes.slice(0, -1))}>
                    <span className="material-symbols-outlined" aria-hidden="true">undo</span> Undo
                  </button>
                  <button type="button" className="pdf-fs-btn" disabled={strokes.length === 0} onClick={() => setStrokes([])}>
                    Clear
                  </button>
                </div>
              </>
            )}

            {mode === 'typed' && (
              <>
                <label className="pdf-form-label" htmlFor={`${id}-typed`}>Your name</label>
                <input id={`${id}-typed`} className="pdf-text-input pdf-fs-plain" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
                <fieldset className="pdf-fs-fieldset">
                  <legend className="pdf-form-label">Style</legend>
                  <div className="pdf-fs-styles">
                    {SCRIPT_FONTS.map((f) => (
                      <label key={f.id} className={`pdf-fs-style${font === f.id ? ' on' : ''}`}>
                        <input type="radio" name={`${id}-font`} value={f.id} checked={font === f.id} onChange={() => setFont(f.id)} />
                        <span className="pdf-fs-style-sample" style={{ fontFamily: f.stack, color }} aria-hidden="true">{typed.trim() || 'Your name'}</span>
                        <span className="pdf-fs-style-name">{f.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {inkPicker}
                <p className="pdf-form-hint">Drawn with a handwriting-style font already on this device — nothing is downloaded, so the look varies between systems.</p>
              </>
            )}

            {mode === 'file' && (
              <>
                <label className="pdf-form-label" htmlFor={`${id}-file`}>Signature image</label>
                <input id={`${id}-file`} className="pdf-fs-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
                <label className="pdf-checkbox">
                  <input type="checkbox" checked={clearPaper} onChange={(e) => setClearPaper(e.target.checked)} />
                  Make a white background transparent
                </label>
                {upload && (
                  <div className="pdf-fs-upload-preview">
                    <img src={upload.url} alt="The signature as it will be placed" />
                  </div>
                )}
              </>
            )}
          </div>

          <ErrorText message={error} />
          <p className="pdf-form-hint" id={`${id}-privacy`}>
            The signature stays in this tab’s memory only — it is never saved, stored or sent, and it is gone when you leave PDF Buddy.
          </p>
          <div className="pdf-fs-row pdf-fs-dialog-actions">
            <span className="pdf-fs-spacer" />
            <button type="button" className="pdf-fs-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="pdf-fs-btn primary" disabled={!ready || busy} onClick={use}>
              Use signature
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
