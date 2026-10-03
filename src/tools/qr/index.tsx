import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { BATCH_LIMIT, parseBatch } from './batch'
import { buildPayload, presets, type Fields, type PresetId } from './payload'
import {
  canvasBlob, colorWarnings, dataMode, drawCanvas, drawQr, ECC_LEVELS, encodeQr, logoRisk, MAX_BYTES, toSvg, utf8Length,
  type Ecc, type EncodeOptions, type EyeStyle, type Logo, type ModuleStyle, type Style,
} from './render'
import './qr.css'

type Mode = 'single' | 'batch'
type Format = 'png' | 'svg' | 'jpeg' | 'webp'

interface Settings {
  encode: EncodeOptions
  style: Style
  px: number
  format: Format
  logoScale: number
  logoPlate: boolean
}

const DEFAULTS: Settings = {
  encode: { ecc: 'M', minVersion: 1, maskPattern: -1, boostEcc: false },
  style: { margin: 4, moduleStyle: 'square', eyeStyle: 'square', fg: '#000000', bg: '#ffffff', eyeColor: '', transparent: false },
  px: 1024,
  format: 'png',
  logoScale: 0.22,
  logoPlate: true,
}

// Only the look is remembered — never the content, which may be a Wi-Fi password.
const STORE_KEY = 'qr.settings.v1'

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Settings> | null
    if (!saved) return DEFAULTS
    return {
      ...DEFAULTS,
      ...saved,
      encode: { ...DEFAULTS.encode, ...saved.encode },
      style: { ...DEFAULTS.style, ...saved.style },
    }
  } catch {
    return DEFAULTS
  }
}

const INITIAL_FIELDS: Record<PresetId, Fields> = {
  text: { text: 'https://theswissknife.com' },
  wifi: { security: 'WPA' },
  email: {},
  phone: {},
  sms: {},
  contact: {},
  geo: {},
  event: {},
}

interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'password' | 'select' | 'checkbox' | 'datetime-local' | 'email' | 'tel' | 'url'
  placeholder?: string
  options?: [string, string][]
  wide?: boolean
}

const FORMS: Record<Exclude<PresetId, 'text'>, FieldDef[]> = {
  wifi: [
    { key: 'ssid', label: 'Network name (SSID)', placeholder: 'HomeNetwork' },
    { key: 'security', label: 'Security', type: 'select', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']] },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'hidden', label: 'Hidden network', type: 'checkbox' },
  ],
  email: [
    { key: 'to', label: 'To', type: 'email', placeholder: 'name@example.com', wide: true },
    { key: 'subject', label: 'Subject', wide: true },
    { key: 'body', label: 'Body', type: 'textarea', wide: true },
  ],
  phone: [{ key: 'number', label: 'Phone number', type: 'tel', placeholder: '+1 555 010 0000', wide: true }],
  sms: [
    { key: 'number', label: 'Phone number', type: 'tel', placeholder: '+1 555 010 0000', wide: true },
    { key: 'message', label: 'Message', type: 'textarea', wide: true },
  ],
  contact: [
    { key: 'first', label: 'First name' },
    { key: 'last', label: 'Last name' },
    { key: 'org', label: 'Organisation' },
    { key: 'title', label: 'Job title' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'url', label: 'Website', type: 'url', wide: true },
    { key: 'address', label: 'Address', wide: true },
    { key: 'note', label: 'Note', type: 'textarea', wide: true },
  ],
  geo: [
    { key: 'lat', label: 'Latitude', placeholder: '27.7172' },
    { key: 'lng', label: 'Longitude', placeholder: '85.3240' },
    { key: 'label', label: 'Label (optional)', wide: true },
  ],
  event: [
    { key: 'title', label: 'Title', wide: true },
    { key: 'start', label: 'Starts', type: 'datetime-local' },
    { key: 'end', label: 'Ends', type: 'datetime-local' },
    { key: 'location', label: 'Location', wide: true },
    { key: 'description', label: 'Description', type: 'textarea', wide: true },
  ],
}

const MIME: Record<Format, string> = { png: 'image/png', svg: 'image/svg+xml', jpeg: 'image/jpeg', webp: 'image/webp' }
const PREVIEW_PX = 720

type Scan = { state: 'unsupported' | 'idle' | 'checking' | 'ok' | 'unreadable' } | { state: 'mismatch'; got: string }

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
interface DetectorCtor { new(opts: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> }

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function loadLogo(file: File): Promise<Logo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => resolve({ src, img, width: img.naturalWidth || 1, height: img.naturalHeight || 1 })
      img.onerror = () => reject(new Error('That file is not an image the browser can draw'))
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

async function renderFile(payload: string, s: Settings, logo: Logo | null): Promise<Blob> {
  const { code, error } = encodeQr(payload, s.encode)
  if (!code) throw new Error(error)
  const drawing = drawQr(code, s.style, logo, { scale: s.logoScale, plate: s.logoPlate })
  if (s.format === 'svg') return new Blob([toSvg(drawing, s.style, s.px, logo)], { type: MIME.svg })
  const canvas = document.createElement('canvas')
  // JPEG has no alpha: flatten onto the background colour rather than black.
  const style = s.format === 'jpeg' ? { ...s.style, transparent: false } : s.style
  drawCanvas(canvas, drawing, style, s.px, logo)
  return canvasBlob(canvas, MIME[s.format], 0.92)
}

export default function QrTool() {
  const [mode, setMode] = useState<Mode>('single')
  const [preset, setPreset] = useState<PresetId>('text')
  const [fields, setFields] = useState(INITIAL_FIELDS)
  const [settings, setSettings] = useState(loadSettings)
  const [logo, setLogo] = useState<Logo | null>(null)
  const [batchText, setBatchText] = useState('https://theswissknife.com/qr\nhttps://theswissknife.com/jq\nhttps://theswissknife.com/jwt')
  const [busy, setBusy] = useState(false)
  const [scan, setScan] = useState<Scan>({ state: 'idle' })
  const [showSecret, setShowSecret] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const { encode: enc, style } = settings
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }))
  const setEnc = (patch: Partial<EncodeOptions>) => setSettings((s) => ({ ...s, encode: { ...s.encode, ...patch } }))
  const setStyle = (patch: Partial<Style>) => setSettings((s) => ({ ...s, style: { ...s.style, ...patch } }))
  const setField = (key: string, value: string) => setFields((f) => ({ ...f, [preset]: { ...f[preset], [key]: value } }))

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)) } catch { /* private mode: settings just won't stick */ }
  }, [settings])

  const built = useMemo(() => buildPayload(preset, fields[preset]), [preset, fields])
  const encoded = useMemo(() => built.error ? { error: built.error } : encodeQr(built.payload, enc), [built, enc])
  const code = encoded.code
  const drawing = useMemo(
    () => code ? drawQr(code, style, logo, { scale: settings.logoScale, plate: settings.logoPlate }) : null,
    [code, style, logo, settings.logoScale, settings.logoPlate],
  )

  useEffect(() => {
    if (mode !== 'single' || !drawing || !canvasRef.current) return
    drawCanvas(canvasRef.current, drawing, style, PREVIEW_PX, logo)
  }, [mode, drawing, style, logo])

  // Scan check: decode our own render with the platform barcode reader. It is
  // the honest answer to "will this still scan with my logo and colours?".
  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
    if (!Ctor) { setScan({ state: 'unsupported' }); return }
    if (mode !== 'single' || !drawing || !code) { setScan({ state: 'idle' }); return }
    let cancelled = false
    setScan({ state: 'checking' })
    const timer = setTimeout(async () => {
      try {
        if (!(await Ctor.getSupportedFormats()).includes('qr_code')) { if (!cancelled) setScan({ state: 'unsupported' }); return }
        // Flatten onto white so a transparent render is judged like a print would be.
        const check = document.createElement('canvas')
        drawCanvas(check, drawing, { ...style, transparent: false, bg: style.transparent ? '#ffffff' : style.bg }, 480, logo)
        const found = await new Ctor({ formats: ['qr_code'] }).detect(check)
        if (cancelled) return
        if (!found.length) setScan({ state: 'unreadable' })
        else if (found[0].rawValue === built.payload) setScan({ state: 'ok' })
        else setScan({ state: 'mismatch', got: found[0].rawValue })
      } catch {
        if (!cancelled) setScan({ state: 'unsupported' })
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [mode, drawing, code, style, logo, built.payload])

  const exportName = `qr-${preset}`

  const save = async () => {
    try {
      download(await renderFile(built.payload, settings, logo), `${exportName}.${settings.format === 'jpeg' ? 'jpg' : settings.format}`)
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const copyImage = async () => {
    try {
      const blob = renderFile(built.payload, { ...settings, format: 'png' }, logo)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      showToast('Image copied')
    } catch {
      showToast('This browser will not copy images — use Download instead')
    }
  }

  const copySvg = () => {
    if (drawing) void copy(toSvg(drawing, style, settings.px, logo), 'SVG markup')
  }

  const onLogo = async (file: File | undefined) => {
    if (!file) return
    try {
      setLogo(await loadLogo(file))
      if (enc.ecc === 'L' || enc.ecc === 'M') {
        setEnc({ ecc: 'H' })
        showToast('Error correction raised to H so the logo can cover modules')
      }
    } catch (e) {
      showToast((e as Error).message)
    }
  }

  const warnings = useMemo(() => {
    const out = colorWarnings(style)
    if (logo && code) {
      const risk = logoRisk(settings.logoScale, code.ecc)
      if (risk === 'risky') out.unshift(`The logo covers more than ECC ${code.ecc} can safely recover — shrink it or raise the level`)
      else if (risk === 'tight') out.push(`Logo is close to the ECC ${code.ecc} recovery budget — test with a few phones`)
      if (!settings.logoPlate) out.push('Without a plate the logo sits on top of live modules — scanners must recover them as errors')
    }
    if (style.margin < 2) out.push('Quiet zone under 2 modules — the spec asks for 4; scanners may not find the edge')
    if (drawing && settings.px / drawing.dim < 3) out.push(`Only ${(settings.px / drawing.dim).toFixed(1)} px per module at ${settings.px}px — increase the size`)
    return out
  }, [style, logo, code, settings.logoScale, settings.logoPlate, settings.px, drawing])

  const batch = useMemo(() => mode === 'batch' ? parseBatch(batchText) : [], [mode, batchText])
  const batchRows = useMemo(() => batch.slice(0, BATCH_LIMIT).map((item) => ({ ...item, ...encodeQr(item.content, enc) })), [batch, enc])
  const batchErrors = batchRows.filter((row) => row.error)

  const saveZip = async () => {
    setBusy(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const ext = settings.format === 'jpeg' ? 'jpg' : settings.format
      for (const row of batchRows) {
        if (row.code) zip.file(`${row.name}.${ext}`, await renderFile(row.content, settings, logo))
      }
      download(await zip.generateAsync({ type: 'blob' }), `qr-codes-${batchRows.length - batchErrors.length}.zip`)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ratio = drawing ? settings.px / drawing.dim : 0
  const modeSwitch = <Segmented label="Mode" value={mode} onChange={setMode} options={[['single', 'Single'], ['batch', 'Batch']]} className="qr-mode" />

  return (
    <div className="qr-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">qr_code_2</span> QR code generator</>}
        localLabel="generated locally"
      />

      <main id="main-content" className="qr-main">
        <div className="qr-left">
          {mode === 'single' ? (
            <Panel step="01" title="Content" aside={modeSwitch}>
              <div className="qr-presets" role="tablist" aria-label="Content type">
                {presets.map((p) => (
                  <button key={p.id} role="tab" aria-selected={preset === p.id} className={preset === p.id ? 'on' : ''} onClick={() => setPreset(p.id)}>
                    <span className="material-symbols-outlined" aria-hidden>{p.icon}</span>{p.label}
                  </button>
                ))}
              </div>
              {preset === 'text' ? (
                <textarea
                  className="qr-text"
                  value={fields.text.text ?? ''}
                  onChange={(e) => setField('text', e.target.value)}
                  placeholder="Paste a link or type any text"
                  aria-label="Text or URL to encode"
                  spellCheck={false}
                  autoFocus
                />
              ) : (
                <div className="qr-form">
                  {FORMS[preset].map((def) => (
                    <FormField
                      key={def.key}
                      def={def}
                      value={fields[preset][def.key] ?? ''}
                      onChange={(v) => setField(def.key, v)}
                      showSecret={showSecret}
                      onToggleSecret={() => setShowSecret((v) => !v)}
                      disabled={def.key === 'password' && fields.wifi.security === 'nopass'}
                    />
                  ))}
                </div>
              )}
              {preset !== 'text' && !built.error && (
                <details className="qr-raw">
                  <summary>Encoded content · {utf8Length(built.payload).toLocaleString()} B</summary>
                  <pre>{built.payload}</pre>
                  <button onClick={() => void copy(built.payload, 'Content')}><span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy</button>
                </details>
              )}
            </Panel>
          ) : (
            <Panel step="01" title="Batch" hint="One code per line · name⇥content sets the file name" aside={modeSwitch}>
              <textarea
                className="qr-text qr-batch-text"
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                placeholder={'https://example.com/a\nhttps://example.com/b\nmenu\thttps://example.com/menu'}
                aria-label="Batch input, one entry per line"
                spellCheck={false}
                wrap="off"
              />
              <p className="qr-note">
                {batch.length.toLocaleString()} code{batch.length === 1 ? '' : 's'}
                {batch.length > BATCH_LIMIT && ` · only the first ${BATCH_LIMIT} are generated`}
                {batchErrors.length > 0 && <span className="qr-bad"> · {batchErrors.length} too long to encode</span>}
                {' · '}Logo and style settings below apply to every code.
              </p>
            </Panel>
          )}

          <Panel step="02" title="Customise" collapsible defaultOpen={false} hint="Colours, shape, logo, error correction">
            <div className="qr-grid">
              <Group title="Shape">
                <Segmented label="Modules" value={style.moduleStyle} onChange={(v: ModuleStyle) => setStyle({ moduleStyle: v })} options={[['square', 'Square'], ['rounded', 'Rounded'], ['dots', 'Dots']]} />
                <Segmented label="Corner eyes" value={style.eyeStyle} onChange={(v: EyeStyle) => setStyle({ eyeStyle: v })} options={[['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]} />
                <Range label="Quiet zone" value={style.margin} min={0} max={10} step={1} unit=" modules" onChange={(v) => setStyle({ margin: v })} />
              </Group>

              <Group title="Colour">
                <div className="qr-colors">
                  <ColorInput label="Modules" value={style.fg} onChange={(v) => setStyle({ fg: v })} />
                  <ColorInput label="Background" value={style.bg} onChange={(v) => setStyle({ bg: v })} disabled={style.transparent} />
                  <ColorInput label="Eyes" value={style.eyeColor || style.fg} onChange={(v) => setStyle({ eyeColor: v === style.fg ? '' : v })} />
                </div>
                <div className="qr-inline">
                  <label className="qr-check"><input type="checkbox" checked={style.transparent} onChange={(e) => setStyle({ transparent: e.target.checked })} /> Transparent background</label>
                  <button className="qr-link" onClick={() => setStyle({ fg: style.bg, bg: style.fg, eyeColor: '' })} disabled={style.transparent}>Swap</button>
                  <button className="qr-link" onClick={() => setStyle({ fg: DEFAULTS.style.fg, bg: DEFAULTS.style.bg, eyeColor: '', transparent: false })}>Reset</button>
                </div>
              </Group>

              <Group title="Logo">
                {logo ? (
                  <>
                    <div className="qr-logo-row">
                      <img src={logo.src} alt="" className="qr-logo-thumb" />
                      <button onClick={() => setLogo(null)}><span className="material-symbols-outlined" aria-hidden>delete</span> Remove</button>
                    </div>
                    <Range label="Size" value={Math.round(settings.logoScale * 100)} min={8} max={35} step={1} unit="%" onChange={(v) => update({ logoScale: v / 100 })} />
                    <label className="qr-check"><input type="checkbox" checked={settings.logoPlate} onChange={(e) => update({ logoPlate: e.target.checked })} /> Clear modules behind the logo</label>
                  </>
                ) : (
                  <label className="qr-drop">
                    <input type="file" accept="image/*" onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = '' }} />
                    <span className="material-symbols-outlined" aria-hidden>add_photo_alternate</span>
                    Add a logo — PNG, SVG, JPEG… it stays on this device
                  </label>
                )}
              </Group>

              <Group title="Encoding">
                <Segmented label="Error correction" value={enc.ecc} onChange={(v: Ecc) => setEnc({ ecc: v })} options={ECC_LEVELS.map((l) => [l.id, l.label])} />
                <label className="qr-check"><input type="checkbox" checked={enc.boostEcc} onChange={(e) => setEnc({ boostEcc: e.target.checked })} /> Boost to the highest level that fits the same size</label>
                <div className="qr-inline">
                  <label className="qr-field qr-narrow">
                    <span>Min version</span>
                    <input type="number" min={1} max={40} value={enc.minVersion} onChange={(e) => setEnc({ minVersion: Math.min(40, Math.max(1, Number(e.target.value) || 1)) })} />
                  </label>
                  <label className="qr-field qr-narrow">
                    <span>Mask</span>
                    <select value={enc.maskPattern} onChange={(e) => setEnc({ maskPattern: Number(e.target.value) })}>
                      <option value={-1}>Auto</option>
                      {[0, 1, 2, 3, 4, 5, 6, 7].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
              </Group>
            </div>
            <div className="qr-reset-all">
              <button className="qr-link" onClick={() => { setSettings(DEFAULTS); setLogo(null) }}>Reset all customisation</button>
            </div>
          </Panel>
        </div>

        <aside className="qr-right" aria-label="Preview and export">
          {mode === 'single' ? (
            <div className="qr-preview">
              <div className={`qr-stage${style.transparent ? ' is-transparent' : ''}`}>
                {code ? <canvas ref={canvasRef} aria-label={`QR code for ${built.payload.slice(0, 80)}`} role="img" /> : (
                  <div className="qr-empty" role="alert">
                    <span className="material-symbols-outlined" aria-hidden>{built.error ? 'edit_note' : 'error'}</span>
                    {encoded.error}
                  </div>
                )}
              </div>
              {code && (
                <p className="qr-stats">
                  <span>v{code.version}</span>
                  <span>{code.size}×{code.size}</span>
                  <span title={code.ecc !== enc.ecc ? `Boosted from ${enc.ecc}` : undefined}>ECC {code.ecc}{code.ecc !== enc.ecc && '↑'}</span>
                  <span>mask {code.mask}</span>
                  <span>{dataMode(built.payload)}</span>
                  <span title={`Version 40 holds up to ${MAX_BYTES[code.ecc].toLocaleString()} bytes at ECC ${code.ecc}`}>{utf8Length(built.payload).toLocaleString()} B</span>
                </p>
              )}
              {code && <ScanBadge scan={scan} caveat={warnings.length > 0} />}
            </div>
          ) : (
            <div className="qr-batch-grid">
              {batchRows.slice(0, 60).map((row) => (
                <figure key={row.name} className={row.error ? 'has-error' : ''} title={row.error ?? row.content}>
                  {row.code ? <BatchThumb row={row} style={style} logo={logo} scale={settings.logoScale} plate={settings.logoPlate} /> : <span className="material-symbols-outlined">error</span>}
                  <figcaption>{row.name}</figcaption>
                </figure>
              ))}
              {batchRows.length > 60 && <p className="qr-note">+{batchRows.length - 60} more in the ZIP</p>}
              {!batchRows.length && <p className="qr-note">Add a line on the left to start.</p>}
            </div>
          )}

          {warnings.length > 0 && (mode === 'single' ? code : batchRows.length > 0) && (
            <ul className="qr-warnings">
              {warnings.map((w) => <li key={w}><span className="material-symbols-outlined" aria-hidden>warning</span>{w}</li>)}
            </ul>
          )}

          <div className="qr-export">
            <div className="qr-inline">
              <label className="qr-field">
                <span>Format</span>
                <select value={settings.format} onChange={(e) => update({ format: e.target.value as Format })}>
                  <option value="png">PNG</option>
                  <option value="svg">SVG (vector)</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
              <label className="qr-field">
                <span>Size</span>
                <select value={[256, 512, 1024, 2048, 4096].includes(settings.px) ? settings.px : 'custom'} onChange={(e) => e.target.value !== 'custom' && update({ px: Number(e.target.value) })}>
                  {[256, 512, 1024, 2048, 4096].map((px) => <option key={px} value={px}>{px} px</option>)}
                  <option value="custom">Custom…</option>
                </select>
              </label>
              <label className="qr-field qr-narrow">
                <span>px</span>
                <input type="number" min={64} max={8192} value={settings.px} onChange={(e) => update({ px: Math.min(8192, Math.max(64, Number(e.target.value) || 64)) })} aria-label="Exact size in pixels" />
              </label>
            </div>
            {mode === 'single' ? (
              <>
                <div className="qr-actions">
                  <button className="qr-primary" onClick={() => void save()} disabled={!code}>
                    <span className="material-symbols-outlined" aria-hidden>download</span> Download {settings.format.toUpperCase()}
                  </button>
                  <button onClick={() => void copyImage()} disabled={!code} title="Copy as PNG image"><span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy image</button>
                  <button onClick={copySvg} disabled={!code} title="Copy SVG markup"><span className="material-symbols-outlined" aria-hidden>code</span> SVG</button>
                </div>
                {code && <p className="qr-note">{ratio.toFixed(ratio < 10 ? 1 : 0)} px per module · prints sharp up to ~{Math.max(1, Math.round((settings.px / 300) * 2.54 * 10) / 10)} cm at 300 dpi{settings.format === 'svg' && ' (SVG scales to any size)'}</p>}
              </>
            ) : (
              <div className="qr-actions">
                <button className="qr-primary" onClick={() => void saveZip()} disabled={busy || batchRows.length === batchErrors.length}>
                  <span className="material-symbols-outlined" aria-hidden>{busy ? 'hourglass_top' : 'folder_zip'}</span>
                  {busy ? 'Building ZIP…' : `Download ${batchRows.length - batchErrors.length} as ZIP`}
                </button>
              </div>
            )}
          </div>
        </aside>
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function Panel({ step, title, hint, aside, children, collapsible, defaultOpen = true }: { step: string; title: string; hint?: string; aside?: ReactNode; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean }) {
  const head = <><span className="qr-step">{step}</span><strong>{title}</strong>{hint && <span className="qr-hint">{hint}</span>}{aside && <div className="qr-aside">{aside}</div>}</>
  if (collapsible) {
    return (
      <details className="qr-panel" open={defaultOpen || undefined}>
        <summary className="qr-panel-head">{head}<span className="material-symbols-outlined qr-chevron" aria-hidden>expand_more</span></summary>
        <div className="qr-panel-body">{children}</div>
      </details>
    )
  }
  return (
    <section className="qr-panel">
      <header className="qr-panel-head">{head}</header>
      <div className="qr-panel-body">{children}</div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="qr-group"><legend>{title}</legend>{children}</fieldset>
}

function Segmented<T extends string>({ label, value, onChange, options, className = '' }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][]; className?: string }) {
  return (
    <div className={`qr-seg-wrap ${className}`}>
      <span className="qr-label">{label}</span>
      <div className="qr-seg" role="group" aria-label={label}>
        {options.map(([id, text]) => (
          <button key={id} className={value === id ? 'on' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>
        ))}
      </div>
    </div>
  )
}

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="qr-range">
      <span className="qr-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{value}{unit}</output>
    </label>
  )
}

function ColorInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className={`qr-color${disabled ? ' is-disabled' : ''}`}>
      <span className="qr-label">{label}</span>
      <span className="qr-color-row">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={`${label} colour`} />
        <input
          type="text"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${label} hex`}
          onChange={(e) => {
            setDraft(e.target.value)
            const hex = e.target.value.trim().replace(/^#?/, '#')
            if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase())
          }}
        />
      </span>
    </label>
  )
}

function FormField({ def, value, onChange, showSecret, onToggleSecret, disabled }: { def: FieldDef; value: string; onChange: (v: string) => void; showSecret: boolean; onToggleSecret: () => void; disabled?: boolean }) {
  const cls = `qr-field${def.wide ? ' is-wide' : ''}`
  if (def.type === 'checkbox') {
    return <label className="qr-check is-wide"><input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(String(e.target.checked))} /> {def.label}</label>
  }
  if (def.type === 'select') {
    return (
      <label className={cls}>
        <span>{def.label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {def.options!.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </label>
    )
  }
  if (def.type === 'textarea') {
    return <label className={cls}><span>{def.label}</span><textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} /></label>
  }
  if (def.type === 'password') {
    return (
      <label className={cls}>
        <span>{def.label}</span>
        <span className="qr-secret">
          <input type={showSecret ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} autoComplete="off" spellCheck={false} />
          <button type="button" onClick={onToggleSecret} aria-label={showSecret ? 'Hide password' : 'Show password'} disabled={disabled}>
            <span className="material-symbols-outlined" aria-hidden>{showSecret ? 'visibility_off' : 'visibility'}</span>
          </button>
        </span>
      </label>
    )
  }
  return (
    <label className={cls}>
      <span>{def.label}</span>
      <input type={def.type ?? 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} spellCheck={false} />
    </label>
  )
}

function ScanBadge({ scan, caveat }: { scan: Scan; caveat: boolean }) {
  const map: Record<Scan['state'], [string, string, string]> = {
    unsupported: ['info', 'muted', 'Scan check needs a browser with a built-in QR reader (Chrome on macOS/Android)'],
    idle: ['qr_code_scanner', 'muted', 'Scan check'],
    checking: ['progress_activity', 'muted', 'Checking it scans…'],
    // A clean on-screen render is the easy case; a camera reading print is harsher.
    ok: caveat
      ? ['verified', 'ok', 'Decodes on screen — but heed the warnings below for print and phone cameras']
      : ['verified', 'ok', 'Scan check passed — decodes to exactly this content'],
    unreadable: ['gpp_bad', 'bad', 'Scan check failed — this browser’s reader could not decode it. Try less logo, more contrast or higher ECC'],
    mismatch: ['gpp_maybe', 'bad', 'Scan check decoded different content'],
  }
  const [icon, tone, text] = map[scan.state]
  return (
    <p className={`qr-scan is-${tone}`} role="status">
      <span className="material-symbols-outlined" aria-hidden>{icon}</span>
      <span>{text}{scan.state === 'mismatch' && <code>{scan.got.slice(0, 120)}</code>}</span>
    </p>
  )
}

function BatchThumb({ row, style, logo, scale, plate }: { row: { code?: ReturnType<typeof encodeQr>['code'] }; style: Style; logo: Logo | null; scale: number; plate: boolean }) {
  const src = useMemo(() => {
    const svg = toSvg(drawQr(row.code!, style, logo, { scale, plate }), style, 160, logo)
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }, [row.code, style, logo, scale, plate])
  return <img src={src} alt="" width={160} height={160} />
}
