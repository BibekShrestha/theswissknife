import { useDeferredValue, useEffect, useMemo, useState, type ClipboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { asciiDigits, formatDecimal, formatDms, parseAngle, parsePair } from './angle'
import { convertRows, MAX_LINES, parseBatch, parseMetres, toCsv, type InputKind, type Order } from './batch'
import { EVEREST_1830, FALSE_EASTING, fromGrid, gridProblem, K0, nearestZone, NEPAL, roughDistance, SHIFTS, toGrid, warningsFor, ZONES, type Geo, type Grid, type ShiftId, type Zone } from './mutm'
import { readFragment, writeFragment, type State } from './share'
import './nepal-coords.css'

const TABLE_ROWS = 200
const BAD_SHOWN = 50

/** A single grid field: spaces and thousands commas are dropped. */
function readMetres(text: string): number | null {
  return parseMetres(text.replace(/[,\s_]/g, ''))
}

type Single =
  | { kind: 'empty' }
  | { kind: 'error'; field: 'first' | 'second' | 'both'; message: string }
  | { kind: 'ok'; geo: Geo; grid: Grid; zone: Zone; zoneAuto: boolean }

function convertSingle(state: State): Single {
  if (state.input === 'grid') {
    if (!state.e.trim() && !state.n.trim()) return { kind: 'empty' }
    const e = readMetres(state.e), n = readMetres(state.n)
    if (e === null) return { kind: 'error', field: 'first', message: 'Easting: use plain metres, such as 630391.974.' }
    if (n === null) return { kind: 'error', field: 'second', message: 'Northing: use plain metres, such as 3066418.735.' }
    const grid = { e, n }
    const problem = gridProblem(grid)
    if (problem) return { kind: 'error', field: 'both', message: problem }
    const zone = state.zone === 'auto' ? 84 : state.zone
    return { kind: 'ok', grid, geo: fromGrid(grid, zone, state.shift), zone, zoneAuto: false }
  }
  if (!state.lat.trim() && !state.lon.trim()) return { kind: 'empty' }
  const lat = parseAngle(state.lat, 'lat'), lon = parseAngle(state.lon, 'lon')
  if (!lat.ok) return { kind: 'error', field: 'first', message: `Latitude: ${lat.error}.` }
  if (!lon.ok) return { kind: 'error', field: 'second', message: `Longitude: ${lon.error}.` }
  const geo = { lat: lat.value, lon: lon.value }
  const zone = state.zone === 'auto' ? nearestZone(geo.lon) : state.zone
  return { kind: 'ok', geo, grid: toGrid(geo, zone, state.shift), zone, zoneAuto: state.zone === 'auto' }
}

function CopyButton({ text, what, onCopy }: { text: string; what: string; onCopy: (text: string, what: string) => void }) {
  return (
    <button className="ncoord-copy" onClick={() => onCopy(text, what)} aria-label={`Copy ${what}`} title="Copy">
      <span className="material-symbols-outlined" aria-hidden>content_copy</span>
    </button>
  )
}

function ZonePicker({ value, allowAuto, autoLabel, onChange, label }: { value: Zone | 'auto'; allowAuto: boolean; autoLabel: string; onChange: (z: Zone | 'auto') => void; label: string }) {
  const options: (Zone | 'auto')[] = allowAuto ? ['auto', ...ZONES] : [...ZONES]
  return (
    <div className="ncoord-seg" role="group" aria-label={label}>
      {options.map((z) => (
        <button key={z} className={value === z ? 'on' : ''} aria-pressed={value === z} onClick={() => onChange(z)}>
          {z === 'auto' ? autoLabel : `${z}° E`}
        </button>
      ))}
    </div>
  )
}

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function NepalCoordsTool() {
  const [state, setState] = useState<State>(() => readFragment(window.location.hash))
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const onCopy = (text: string, what: string) => void copy(text, what)

  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#i=')) setState(readFragment(window.location.hash)) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const fragment = writeFragment(state)
  useEffect(() => {
    if (window.location.hash !== fragment) window.history.replaceState(window.history.state, '', fragment)
  }, [fragment])

  const single = useMemo(() => convertSingle(state), [state])
  const shift = SHIFTS[state.shift]

  const setInput = (input: InputKind) => {
    if (input === state.input) return
    // Carry the current result over as the new input.
    if (single.kind === 'ok') {
      if (input === 'grid') setState({ ...state, input, zone: single.zone, e: single.grid.e.toFixed(3), n: single.grid.n.toFixed(3) })
      else setState({ ...state, input, zone: single.zone, lat: formatDecimal(single.geo.lat), lon: formatDecimal(single.geo.lon) })
    } else {
      setState({ ...state, input, zone: input === 'grid' && state.zone === 'auto' ? 84 : state.zone })
    }
  }

  // A pasted pair fills both fields.
  const pastePair = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (state.input === 'geo') {
      const pair = parsePair(text)
      if (!pair) return
      event.preventDefault()
      setState({ ...state, lat: formatDecimal(pair.lat), lon: formatDecimal(pair.lon) })
    } else {
      const parts = asciiDigits(text).trim().split(/\s*[,;\t]\s*|\s+/)
      if (parts.length !== 2) return
      const [a, b] = parts.map(parseMetres)
      if (a === null || b === null) return
      event.preventDefault()
      const [e, n] = a < b ? [a, b] : [b, a]
      setState({ ...state, e: String(e), n: String(n) })
    }
  }

  const fields = state.input === 'grid'
    ? [{ key: 'e' as const, label: 'Easting', unit: 'm', placeholder: '630391.974' }, { key: 'n' as const, label: 'Northing', unit: 'm', placeholder: '3066418.735' }]
    : [{ key: 'lat' as const, label: 'Latitude', unit: '', placeholder: `27.7056 or 27°42'20"N` }, { key: 'lon' as const, label: 'Longitude', unit: '', placeholder: `85.3147 or 85°18'53"E` }]

  const badField = single.kind === 'error' ? single.field : null
  const warnings = single.kind === 'ok' ? warningsFor(single.geo, single.zone) : []

  // In "no shift" mode, say how far GPS would put the same point.
  const shiftGap = useMemo(() => {
    if (single.kind !== 'ok' || state.shift !== 'none') return null
    const viaShift = fromGrid(single.grid, single.zone, 'epsg6208')
    return roughDistance(single.geo, viaShift)
  }, [single, state.shift])

  // Batch: local state only — it never goes into the URL.
  const [batchText, setBatchText] = useState('')
  const [batchInput, setBatchInput] = useState<InputKind>('grid')
  const [batchZone, setBatchZone] = useState<Zone | 'auto'>(84)
  const [batchOrder, setBatchOrder] = useState<Order>('auto')
  const deferredText = useDeferredValue(batchText)
  const batch = useMemo(() => {
    const parsed = parseBatch(deferredText, batchInput, batchOrder)
    const zone = batchInput === 'grid' && batchZone === 'auto' ? 84 : batchZone
    const converted = convertRows(parsed.rows, batchInput, zone, state.shift)
    const bad = [...parsed.bad, ...converted.bad].sort((a, b) => a.line - b.line)
    return { parsed, done: converted.done, bad }
  }, [deferredText, batchInput, batchOrder, batchZone, state.shift])

  const setBatchKind = (input: InputKind) => {
    setBatchInput(input)
    if (input === 'grid' && batchZone === 'auto') setBatchZone(84)
  }

  const csv = () => toCsv(batch.done, batch.parsed.header, formatDms)
  const geoLabel = state.shift === 'none' ? 'Nepal 1981' : 'WGS84'

  return (
    <div className="ncoord-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined" aria-hidden>location_on</span> Nepal coordinates</>}
        localLabel="MUTM ⇄ WGS84"
      >
        <button onClick={() => void copy(window.location.href, 'Link')} aria-label="Copy a link to this point" title="Copy link"><span className="material-symbols-outlined" aria-hidden>link</span></button>
      </ToolHeader>

      <main id="main-content" className="ncoord-main">
        <section className="ncoord-pane ncoord-input" aria-labelledby="ncoord-input-title">
          <header><span className="ncoord-step">01</span><h2 id="ncoord-input-title">Point</h2></header>
          <div className="ncoord-body">
            <div className="ncoord-seg ncoord-dir" role="group" aria-label="Convert from">
              <button className={state.input === 'grid' ? 'on' : ''} aria-pressed={state.input === 'grid'} onClick={() => setInput('grid')}>MUTM → lat/lon</button>
              <button className={state.input === 'geo' ? 'on' : ''} aria-pressed={state.input === 'geo'} onClick={() => setInput('geo')}>Lat/lon → MUTM</button>
            </div>

            <div className="ncoord-row">
              <span className="ncoord-label" id="ncoord-zone-label">Zone (central meridian)</span>
              <ZonePicker
                value={state.zone}
                allowAuto={state.input === 'geo'}
                autoLabel="Nearest"
                label="Zone"
                onChange={(zone) => setState({ ...state, zone })}
              />
            </div>

            <div className="ncoord-fields">
              {fields.map((f, i) => (
                <label key={f.key} className="ncoord-field">
                  <span>{f.label}{f.unit && <small> ({f.unit})</small>}{state.input === 'geo' && <small> · {geoLabel}</small>}</span>
                  <input
                    inputMode={state.input === 'grid' ? 'decimal' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    value={state[f.key]}
                    placeholder={f.placeholder}
                    aria-invalid={badField === 'both' || badField === (i === 0 ? 'first' : 'second')}
                    onPaste={pastePair}
                    onChange={(event) => setState({ ...state, [f.key]: event.target.value })}
                  />
                </label>
              ))}
            </div>

            {single.kind === 'error'
              ? <p className="ncoord-error" role="alert">{single.message}</p>
              : <p className="ncoord-hint">{state.input === 'grid'
                  ? 'Metres, as on Survey Department maps and control point lists. Pasting “E, N” into either box fills both.'
                  : 'Decimal degrees or degrees-minutes-seconds (27°42\'36.5"N, 27 42 36.5, 27d42m36.5s), Nepali digits too. Pasting “lat, lon” fills both.'}</p>}

            <label className="ncoord-field">
              <span>Datum shift</span>
              <select value={state.shift} onChange={(event) => setState({ ...state, shift: event.target.value as ShiftId })}>
                {Object.values(SHIFTS).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <p className={state.shift === 'none' ? 'ncoord-warn' : 'ncoord-hint'}>
              {state.shift === 'none'
                ? <>No datum shift: latitude and longitude are on Nepal 1981 (Everest 1830), <b>not</b> GPS or Google Earth — {shift.accuracy.replace(/^not comparable with GPS — /, '')}.</>
                : <>Expected accuracy of the shift: {shift.accuracy}. Latitude/longitude are WGS84, as from GPS or Google Earth.</>}
            </p>
          </div>
        </section>

        <section className="ncoord-pane ncoord-results" aria-labelledby="ncoord-result-title" aria-live="polite">
          <header><span className="ncoord-step">02</span><h2 id="ncoord-result-title">{state.input === 'grid' ? `Latitude / longitude · ${geoLabel}` : 'MUTM grid'}</h2></header>
          <div className="ncoord-body">
            {single.kind !== 'ok' ? (
              <p className="ncoord-placeholder">{single.kind === 'empty' ? (state.input === 'grid' ? 'Enter an easting and a northing.' : 'Enter a latitude and a longitude.') : 'Fix the highlighted field.'}</p>
            ) : (
              <>
                {state.input === 'grid' ? (
                  <div className="ncoord-cards">
                    {(['lat', 'lon'] as const).map((k) => {
                      const v = single.geo[k]
                      const name = k === 'lat' ? 'Latitude' : 'Longitude'
                      return (
                        <article key={k} className="ncoord-card">
                          <h3>{name}</h3>
                          <div className="ncoord-value"><output aria-label={`${name}, decimal degrees`}>{formatDecimal(v)}°</output><CopyButton text={formatDecimal(v)} what={`${name} (decimal)`} onCopy={onCopy} /></div>
                          <div className="ncoord-value ncoord-dms"><output aria-label={`${name}, degrees minutes seconds`}>{formatDms(v, k)}</output><CopyButton text={formatDms(v, k)} what={`${name} (DMS)`} onCopy={onCopy} /></div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="ncoord-cards">
                    {(['e', 'n'] as const).map((k) => {
                      const name = k === 'e' ? 'Easting' : 'Northing'
                      const text = single.grid[k].toFixed(3)
                      return (
                        <article key={k} className="ncoord-card">
                          <h3>{name} <small>m</small></h3>
                          <div className="ncoord-value"><output aria-label={`${name} in metres`}>{text}</output><CopyButton text={text} what={name} onCopy={onCopy} /></div>
                        </article>
                      )
                    })}
                  </div>
                )}

                <div className="ncoord-pairs">
                  {state.input === 'grid' ? (
                    <>
                      <span>Lat, lon</span>
                      <code>{formatDecimal(single.geo.lat)}, {formatDecimal(single.geo.lon)}</code>
                      <CopyButton text={`${formatDecimal(single.geo.lat)}, ${formatDecimal(single.geo.lon)}`} what="Lat, lon" onCopy={onCopy} />
                    </>
                  ) : (
                    <>
                      <span>E, N</span>
                      <code>{single.grid.e.toFixed(3)}, {single.grid.n.toFixed(3)}</code>
                      <CopyButton text={`${single.grid.e.toFixed(3)}, ${single.grid.n.toFixed(3)}`} what="E, N" onCopy={onCopy} />
                    </>
                  )}
                </div>

                <p className="ncoord-hint">
                  Zone {single.zone}° E{single.zoneAuto ? ' — the zone whose central meridian is nearest this point' : state.input === 'geo' ? ' (chosen)' : ''}.
                  {' '}{state.shift === 'none'
                    ? <>No datum shift{shiftGap !== null ? <>: through EPSG:6208 this point would be about {Math.round(shiftGap)} m away</> : null}.</>
                    : <>Datum shift EPSG:6208, accurate to {shift.accuracy.replace(/ \(.*\)$/, '')}; the projection itself is exact to 1 mm.</>}
                </p>

                {warnings.length > 0 && (
                  <div className="ncoord-warn" role="note">
                    <ul>{warnings.map((w) => <li key={w.kind}>{w.text}</li>)}</ul>
                  </div>
                )}

                <button className="ncoord-swap" onClick={() => setInput(state.input === 'grid' ? 'geo' : 'grid')}>
                  <span className="material-symbols-outlined" aria-hidden>swap_horiz</span> Use as input
                </button>
              </>
            )}
          </div>
        </section>

        <section className="ncoord-pane ncoord-batch" aria-labelledby="ncoord-batch-title">
          <header><span className="ncoord-step">03</span><h2 id="ncoord-batch-title">Many points</h2></header>
          <div className="ncoord-body">
            <div className="ncoord-batch-bar">
              <div className="ncoord-seg" role="group" aria-label="Batch input is">
                <button className={batchInput === 'grid' ? 'on' : ''} aria-pressed={batchInput === 'grid'} onClick={() => setBatchKind('grid')}>MUTM E/N</button>
                <button className={batchInput === 'geo' ? 'on' : ''} aria-pressed={batchInput === 'geo'} onClick={() => setBatchKind('geo')}>Lat/lon</button>
              </div>
              <ZonePicker value={batchZone} allowAuto={batchInput === 'geo'} autoLabel="Nearest each" label="Batch zone" onChange={setBatchZone} />
              <label className="ncoord-inline">
                <span>Columns</span>
                <select value={batchOrder} onChange={(event) => setBatchOrder(event.target.value as Order)}>
                  <option value="auto">{batchInput === 'grid' ? 'Auto (northing is larger)' : 'Auto (longitude is larger)'}</option>
                  <option value="normal">{batchInput === 'grid' ? 'E, N' : 'Lat, lon'}</option>
                  <option value="swapped">{batchInput === 'grid' ? 'N, E' : 'Lon, lat'}</option>
                </select>
              </label>
            </div>
            <textarea
              className="ncoord-textarea"
              aria-label={batchInput === 'grid' ? 'Points, one per line: optional id, easting, northing' : 'Points, one per line: optional id, latitude, longitude'}
              spellCheck={false}
              rows={8}
              value={batchText}
              placeholder={batchInput === 'grid'
                ? 'Point,Easting,Northing,Height\nBM1,630391.974,3066418.735,1337.2\nBM2\t631002.10\t3066950.55\n3 629870.4 3065511.9'
                : 'id,lat,lon\nKTM,27.7056,85.3147\nPKR\t28°12\'34.6"N\t83°59\'08.2"E'}
              onChange={(event) => setBatchText(event.target.value)}
            />
            <p className="ncoord-hint">
              One point per line, columns split by tab, comma or semicolon (or spaces). A point id may come first;
              columns after the two coordinates (height, code) are copied to the output unchanged — heights are not converted.
              A first line of words is read as a header. In Auto, the larger number is taken as the {batchInput === 'grid' ? 'northing' : 'longitude'}, which holds everywhere in Nepal{batchInput === 'geo' ? '; N/S/E/W letters decide when present' : ''}.
              Up to {MAX_LINES.toLocaleString('en')} lines; nothing leaves this page.
            </p>

            {batchText.trim() && (
              <>
                <div className="ncoord-batch-summary" aria-live="polite">
                  <span>{batch.done.length.toLocaleString('en')} converted{batch.bad.length ? `, ${batch.bad.length.toLocaleString('en')} not` : ''}{batch.parsed.header ? ' · header skipped' : ''}{batch.parsed.skipped ? ` · ${batch.parsed.skipped.toLocaleString('en')} lines past the limit not read` : ''}</span>
                  <button disabled={!batch.done.length} onClick={() => { download(csv(), 'nepal-coordinates.csv'); showToast('CSV downloaded') }}>
                    <span className="material-symbols-outlined" aria-hidden>download</span> CSV
                  </button>
                  <button disabled={!batch.done.length} onClick={() => onCopy(csv(), 'CSV')}>
                    <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy CSV
                  </button>
                </div>

                {batch.bad.length > 0 && (
                  <div className="ncoord-error">
                    <ul>
                      {batch.bad.slice(0, BAD_SHOWN).map((b) => <li key={b.line}>Line {b.line}: {b.reason}</li>)}
                    </ul>
                    {batch.bad.length > BAD_SHOWN && <p>…and {batch.bad.length - BAD_SHOWN} more.</p>}
                  </div>
                )}

                {batch.done.length > 0 && (
                  <div className="ncoord-table-wrap">
                    <table className="ncoord-table">
                      <caption className="ncoord-sr">Converted points</caption>
                      <thead>
                        <tr><th scope="col">Line</th><th scope="col">Id</th><th scope="col">Zone</th><th scope="col">Easting</th><th scope="col">Northing</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Note</th></tr>
                      </thead>
                      <tbody>
                        {batch.done.slice(0, TABLE_ROWS).map((c) => (
                          <tr key={c.row.line}>
                            <td>{c.row.line}</td>
                            <td>{c.row.id}</td>
                            <td>{c.zone}</td>
                            <td>{c.grid.e.toFixed(3)}</td>
                            <td>{c.grid.n.toFixed(3)}</td>
                            <td>{formatDecimal(c.geo.lat)}</td>
                            <td>{formatDecimal(c.geo.lon)}</td>
                            <td>{c.warnings.map((w) => (w === 'outside' ? 'outside Nepal' : 'far from meridian')).join('; ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {batch.done.length > TABLE_ROWS && <p className="ncoord-hint">Showing the first {TABLE_ROWS} of {batch.done.length.toLocaleString('en')}; the CSV has them all.</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="ncoord-pane ncoord-defs" aria-labelledby="ncoord-defs-title">
          <header><span className="ncoord-step">04</span><h2 id="ncoord-defs-title">Definitions</h2></header>
          <div className="ncoord-body">
            <dl>
              <div><dt>MUTM (Modified UTM)</dt><dd>Transverse Mercator, scale factor {K0} on the central meridian, false easting {FALSE_EASTING.toLocaleString('en')} m, false northing 0, latitude of origin 0°. Three zones, 3° wide: central meridians 81°, 84° and 87° E.</dd></div>
              <div><dt>Ellipsoid</dt><dd>Everest 1830 (1937 adjustment): a = {EVEREST_1830.a} m, 1/f = 300.8017.</dd></div>
              <div><dt>Datum</dt><dd>Nepal 1981 (Nagarkot), EPSG:6207. Area of use {NEPAL.south}–{NEPAL.north}° N, {NEPAL.west}–{NEPAL.east}° E.</dd></div>
              {Object.values(SHIFTS).map((s) => (
                <div key={s.id}>
                  <dt>{s.label}</dt>
                  <dd>{s.parameters} {s.source} Accuracy: {s.accuracy}.</dd>
                </div>
              ))}
              <div><dt>Not included</dt><dd>Other published parameter sets for Nepal give several values or no single named source, so they are not offered. Heights are never changed: the shift is two-dimensional, as in PROJ.</dd></div>
            </dl>
          </div>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
