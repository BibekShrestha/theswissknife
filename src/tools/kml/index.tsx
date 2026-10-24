import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { INSUNITS, sniff, type Direction, type Summary } from './convert'
import { CrsError, LONLAT, parseProj, UNITS, utmProj, WEB_MERCATOR } from './proj/crs'
import { createConvertRunner, type Job, type RunOutcome } from './runner'
import { SAMPLE_KML, SAMPLE_NAME } from './sample'
import './kml.css'

const spawnWorker = () => new Worker(new URL('./kml.worker.ts', import.meta.url), { type: 'module' })

interface LoadedFile {
  id: number
  name: string
  size: number
  bytes: Uint8Array<ArrayBuffer>
  direction: Direction
}

type CrsMode = 'auto' | 'utm' | 'lonlat' | 'webmerc' | 'custom' | 'none'

const CRS_MODES: { id: CrsMode; label: string; kml: boolean; dxf: boolean }[] = [
  { id: 'auto', label: 'UTM — zone from the data', kml: true, dxf: false },
  { id: 'none', label: 'Choose…', kml: false, dxf: true },
  { id: 'utm', label: 'UTM — pick the zone', kml: true, dxf: true },
  { id: 'lonlat', label: 'Longitude / latitude (degrees)', kml: true, dxf: true },
  { id: 'webmerc', label: 'Web Mercator (EPSG:3857)', kml: true, dxf: true },
  { id: 'custom', label: 'Other — PROJ string', kml: true, dxf: true },
]

const DIRECTION_LABEL: Record<Direction, string> = { 'kml-to-dxf': 'KML → DXF', 'dxf-to-kml': 'DXF → KML' }

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}

let nextFileId = 0

function crsString(mode: CrsMode, zone: number, south: boolean, custom: string): string {
  switch (mode) {
    case 'auto': return 'utm-auto'
    case 'utm': return utmProj(zone, south)
    case 'lonlat': return LONLAT
    case 'webmerc': return WEB_MERCATOR
    case 'custom': return custom.trim()
    case 'none': return ''
  }
}

function Preview({ summary }: { summary: Summary }) {
  const { preview } = summary
  if (!preview.paths.length) return null
  // Strokes keep their screen width whatever the drawing's scale.
  return (
    <figure className="kml-preview">
      <svg viewBox={`-8 -8 ${preview.width + 16} ${preview.height + 16}`} role="img" aria-label="Outline of the converted geometry">
        {preview.paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            className={`kml-preview-${p.kind}`}
            style={{ color: p.color || undefined }}
          />
        ))}
      </svg>
      {preview.partial && <figcaption>Outline shortened — the drawing is too large to show in full.</figcaption>}
    </figure>
  )
}

export default function KmlTool() {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<CrsMode>('auto')
  const [zone, setZone] = useState(32)
  const [south, setSouth] = useState(false)
  const [custom, setCustom] = useState('')
  const [units, setUnits] = useState('auto')
  const [altitude, setAltitude] = useState(false)
  const [labels, setLabels] = useState(true)
  const [folders, setFolders] = useState(true)
  const [polygons, setPolygons] = useState(true)
  const [texts, setTexts] = useState(true)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [kmz, setKmz] = useState(false)
  const [outcome, setOutcome] = useState<{ key: string; value: RunOutcome } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const runner = useRef<ReturnType<typeof createConvertRunner> | null>(null)
  const { toast, showToast } = useToast()

  useEffect(() => {
    runner.current = createConvertRunner(spawnWorker)
    return () => runner.current?.dispose()
  }, [])

  const direction = file?.direction ?? 'kml-to-dxf'
  const deferredCustom = useDeferredValue(custom)
  const crs = crsString(mode, zone, south, mode === 'custom' ? deferredCustom : custom)
  const crsCheck = useMemo(() => {
    if (!crs || crs === 'utm-auto') return { error: '', label: '' }
    try {
      return { error: '', label: parseProj(crs).label }
    } catch (error) {
      return { error: error instanceof CrsError ? error.message : String(error), label: '' }
    }
  }, [crs])

  // An empty PROJ field is a prompt, not an error; KML can't be projected without one.
  const waitingForProj = mode === 'custom' && !crs
  const job: Job | null = useMemo(() => {
    if (!file || crsCheck.error || (waitingForProj && file.direction === 'kml-to-dxf')) return null
    return file.direction === 'kml-to-dxf'
      ? { direction: 'kml-to-dxf', options: { crs, altitude, labels, folders } }
      : { direction: 'dxf-to-kml', options: { crs, units, altitude, polygons, texts, includeHidden, kmz } }
  }, [file, crs, crsCheck.error, waitingForProj, altitude, labels, folders, units, polygons, texts, includeHidden, kmz])
  const jobKey = file && job ? `${file.id}|${JSON.stringify(job)}` : ''

  useEffect(() => {
    if (!file || !job || !runner.current) return
    let cancelled = false
    void runner.current.run(file.id, file.name, file.bytes, job).then((value) => {
      if (!cancelled) setOutcome({ key: jobKey, value })
    })
    return () => { cancelled = true }
  }, [file, job, jobKey])

  const current = outcome?.key === jobKey ? outcome.value : null
  const busy = Boolean(file && job && !current)
  const result = current && 'result' in current ? current.result : null
  const summary = result?.ok ? result.summary : null

  // A CRS comment this tool wrote is trusted outright; a degrees guess waits for a click.
  useEffect(() => {
    const suggestion = summary?.suggestion
    if (summary?.needsCrs && suggestion && suggestion.proj !== LONLAT) {
      setMode('custom')
      setCustom(suggestion.proj)
    }
  }, [summary])

  const load = (name: string, bytes: Uint8Array<ArrayBuffer>) => {
    const kind = sniff(bytes, name)
    if (typeof kind !== 'string') { showToast(kind.error); return }
    setFile({ id: ++nextFileId, name, size: bytes.length, bytes, direction: kind })
    setOutcome(null)
    if (kind === 'dxf-to-kml') {
      setMode((m) => (m === 'auto' ? 'none' : m))
      setUnits('auto')
    } else {
      setMode((m) => (m === 'none' ? 'auto' : m))
    }
  }

  const openFile = async (picked: File | undefined) => {
    if (!picked) return
    try {
      load(picked.name, new Uint8Array(await picked.arrayBuffer()))
    } catch (error) {
      showToast(`Could not read the file: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFile(event.dataTransfer.files[0])
  }

  const loadSample = () => load(SAMPLE_NAME, new TextEncoder().encode(SAMPLE_KML))

  const download = () => {
    const output = summary?.output
    if (!output) return
    const url = URL.createObjectURL(new Blob([output.data], { type: output.mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = output.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const fileUnits = summary?.insunits !== undefined ? INSUNITS[summary.insunits] : undefined
  const modes = CRS_MODES.filter((m) => (direction === 'kml-to-dxf' ? m.kml : m.dxf))

  return (
    <div className="kml-app" onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={drop}>
      <ToolHeader
        brand={<><span className="material-symbols-outlined" aria-hidden>map</span> KML ⇄ DXF</>}
        localLabel="local conversion"
      >
        <button onClick={loadSample} aria-label="Load the sample KML" title="Load the sample KML"><span className="material-symbols-outlined" aria-hidden>auto_fix_high</span></button>
      </ToolHeader>

      <main id="main-content" className="kml-main">
        <section className="kml-settings" aria-label="Conversion settings">
          <article className="kml-pane">
            <header><span className="kml-step">01</span><h2>File</h2>{file && <span className="kml-badge">{DIRECTION_LABEL[file.direction]}</span>}</header>
            <div className={`kml-drop${dragging ? ' dragging' : ''}`}>
              {file ? (
                <div className="kml-file">
                  <span className="material-symbols-outlined" aria-hidden>description</span>
                  <div>
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)} · read in this browser, not uploaded</span>
                  </div>
                  <button onClick={() => fileRef.current?.click()}>Change</button>
                  <button onClick={() => { setFile(null); setOutcome(null) }} aria-label="Close file" title="Close file"><span className="material-symbols-outlined" aria-hidden>close</span></button>
                </div>
              ) : (
                <div className="kml-empty">
                  <span className="material-symbols-outlined" aria-hidden>upload_file</span>
                  <p>Drop a Google Earth <b>.kml</b> / <b>.kmz</b> or an AutoCAD <b>.dxf</b> here</p>
                  <div>
                    <button className="kml-primary" onClick={() => fileRef.current?.click()}>Choose file</button>
                    <button onClick={loadSample}>Try a sample</button>
                  </div>
                  <p className="kml-hint">DWG files can’t be read in a browser — save them as DXF from AutoCAD first.</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept=".kml,.kmz,.dxf" hidden onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
            </div>
          </article>

          <article className="kml-pane">
            <header><span className="kml-step">02</span><h2>Coordinate system</h2></header>
            <div className="kml-body">
              <p className="kml-hint">
                {direction === 'kml-to-dxf'
                  ? 'KML is longitude/latitude on WGS84. CAD drawings are flat, so the points are projected into the grid your drawing uses.'
                  : 'The grid the drawing’s coordinates are in. DXF files don’t record it, so it has to be chosen.'}
              </p>
              <label className="kml-field">
                <span>Projection</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as CrsMode)} aria-label="Projection">
                  {modes.map((m) => <option key={m.id} value={m.id} disabled={m.id === 'none'}>{m.label}</option>)}
                </select>
              </label>
              {mode === 'utm' && (
                <div className="kml-row">
                  <label className="kml-field kml-narrow">
                    <span>Zone</span>
                    <input type="number" min={1} max={60} aria-label="UTM zone" value={zone} onChange={(event) => setZone(Math.min(60, Math.max(1, Math.round(Number(event.target.value)) || 1)))} />
                  </label>
                  <div className="kml-seg" role="group" aria-label="Hemisphere">
                    <button className={!south ? 'on' : ''} aria-pressed={!south} onClick={() => setSouth(false)}>North</button>
                    <button className={south ? 'on' : ''} aria-pressed={south} onClick={() => setSouth(true)}>South</button>
                  </div>
                </div>
              )}
              {mode === 'custom' && (
                <label className="kml-field">
                  <span>PROJ string</span>
                  <textarea value={custom} onChange={(event) => setCustom(event.target.value)} rows={3} spellCheck={false} aria-label="PROJ string" placeholder="+proj=tmerc +lat_0=0 +lon_0=84 +k=0.9999 +x_0=500000 +y_0=0 +ellps=evrst30 +towgs84=… +units=m" aria-invalid={Boolean(crsCheck.error)} />
                  <small>Supports longlat, utm, tmerc, lcc and merc with +towgs84 datum shifts. epsg.io lists the PROJ string for most EPSG codes (Export → PROJ.4).</small>
                </label>
              )}
              {crsCheck.error && <p className="kml-error" role="alert">{crsCheck.error}</p>}
              {summary?.suggestion && summary.needsCrs && summary.suggestion.proj === LONLAT && (
                <div className="kml-suggest">
                  <p>{summary.suggestion.reason}</p>
                  <button onClick={() => setMode('lonlat')}>Use longitude / latitude</button>
                </div>
              )}
              {(summary?.crs || crsCheck.label) && <p className="kml-crs"><span>Using</span> {summary?.crs?.label ?? crsCheck.label}</p>}
              {direction === 'dxf-to-kml' && mode !== 'lonlat' && (
                <label className="kml-field">
                  <span>Drawing units</span>
                  <select value={units} onChange={(event) => setUnits(event.target.value)} aria-label="Drawing units">
                    <option value="auto">{fileUnits ? `From the file (${UNITS[fileUnits.key].label})` : 'Same as the coordinate system'}</option>
                    {Object.entries(UNITS).map(([key, unit]) => <option key={key} value={key}>{unit.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          </article>

          <article className="kml-pane">
            <header><span className="kml-step">03</span><h2>Options</h2></header>
            <div className="kml-body kml-checks">
              {direction === 'kml-to-dxf' ? (
                <>
                  <label><input type="checkbox" checked={folders} onChange={(event) => setFolders(event.target.checked)} /> One layer per folder</label>
                  <label><input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} /> Point names as text</label>
                  <label><input type="checkbox" checked={altitude} onChange={(event) => setAltitude(event.target.checked)} /> Altitude as Z (3D polylines)</label>
                </>
              ) : (
                <>
                  <label><input type="checkbox" checked={polygons} onChange={(event) => setPolygons(event.target.checked)} /> Closed shapes as filled polygons</label>
                  <label><input type="checkbox" checked={texts} onChange={(event) => setTexts(event.target.checked)} /> Text as labels</label>
                  <label><input type="checkbox" checked={altitude} onChange={(event) => setAltitude(event.target.checked)} /> Z as altitude (absolute)</label>
                  <label><input type="checkbox" checked={includeHidden} onChange={(event) => setIncludeHidden(event.target.checked)} /> Hidden layers (off or frozen)</label>
                  <div className="kml-seg" role="group" aria-label="Output format">
                    <button className={!kmz ? 'on' : ''} aria-pressed={!kmz} onClick={() => setKmz(false)}>.kml</button>
                    <button className={kmz ? 'on' : ''} aria-pressed={kmz} onClick={() => setKmz(true)}>.kmz</button>
                  </div>
                </>
              )}
            </div>
          </article>
        </section>

        <section className="kml-pane kml-result" aria-label="Result" aria-busy={busy}>
          <header>
            <span className="kml-step">04</span><h2>Result</h2>
            {summary?.output && (
              <button className="kml-primary kml-download" onClick={download}>
                <span className="material-symbols-outlined" aria-hidden>download</span> {summary.output.name} · {formatBytes(summary.output.size)}
              </button>
            )}
          </header>
          <div className="kml-body">
            {!file && <p className="kml-placeholder">Open a file to see its outline, what was converted and the download.</p>}
            {busy && <p className="kml-placeholder" role="status">Converting…</p>}
            {file && crsCheck.error && <p className="kml-placeholder">Fix the coordinate system to convert.</p>}
            {file && waitingForProj && file.direction === 'kml-to-dxf' && <p className="kml-placeholder">Paste a PROJ string to convert.</p>}
            {current && 'stopped' in current && <p className="kml-error" role="alert">Stopped after {current.timeoutMs / 1000} s — the file is too large or too complex to convert here.</p>}
            {result && !result.ok && <p className="kml-error" role="alert">{result.error}</p>}
            {summary && (
              <>
                {summary.needsCrs && <p className="kml-suggest-line" role="status">Choose the drawing’s coordinate system to write the KML.</p>}
                <Preview summary={summary} />
                <dl className="kml-facts">
                  {summary.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                </dl>
                {summary.counts.length > 0 && (
                  <ul className="kml-counts" aria-label="Converted">
                    {summary.counts.map(([k, n]) => <li key={k}><b>{n.toLocaleString('en-US')}</b> {n === 1 || k === k.toUpperCase() ? k : `${k}s`}</li>)}
                  </ul>
                )}
                {summary.notes.length > 0 && (
                  <ul className="kml-notes" aria-label="Notes">
                    {summary.notes.map((note) => (
                      <li key={note.text} className={note.level}>
                        <span className="material-symbols-outlined" aria-hidden>{note.level === 'warn' ? 'warning' : 'info'}</span>
                        <p>{note.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
