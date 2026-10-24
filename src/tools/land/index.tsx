import { useEffect, useMemo, useState, type ClipboardEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { EarthPanel, type EarthData } from './earth/EarthPanel'
import { ellipsoidArea } from './earth/geodesy'
import { readShapes } from './earth/kml'
import { kmlFromFile } from './earth/load'
import { toPlot } from './earth/sketch'
import { PlotEditor } from './plot/PlotEditor'
import { solvePlot, type Solved, type Unsolved } from './plot/solve'
import { readFragment, SIZE, START_PLOT, writeFragment, type Mode, type State } from './share'
import { div, formatQ, fromCompound, mul, parseCompound, parseDecimal, q, SYSTEMS, toCompound, UNIT, UNITS, type Q, type SystemId, type UnitId } from './units'
import './land.css'

const MODES: { id: Mode; label: string }[] = [
  { id: 'hill', label: 'Ropani' },
  { id: 'terai', label: 'Bigha' },
  { id: 'unit', label: 'One unit' },
  { id: 'plot', label: 'Sketch a plot' },
  { id: 'earth', label: 'From Google Earth' },
]

const FOOT = UNIT.ft2.m2
const NEPALI_UNITS = new Set<UnitId>([...SYSTEMS.hill.parts, ...SYSTEMS.terai.parts])

/**
 * The sketch's area in m² as a fraction. It comes from square roots, so it
 * is a double; kept to 1e-8 m² (well under a square millimetre).
 */
function plotArea(solved: Solved, unit: State['lengthUnit']): Q {
  const scaled = metres(solved.area)
  return unit === 'ft' ? mul(scaled, FOOT) : scaled
}

/** A double area as a fraction, to 1e-8 of a unit. */
const metres = (value: number) => q(BigInt(Math.round(value * 1e8)), 100000000n)

/** The area the inputs describe, or which fields don't read as numbers. */
function areaOf(state: State, solved: Solved | Unsolved | null, earth: EarthData | null): { area: Q | null; bad: boolean[] } {
  if (state.mode === 'plot') return { area: solved?.ok ? plotArea(solved, state.lengthUnit) : null, bad: [] }
  if (state.mode === 'earth') {
    const shape = earth?.read.shapes[earth.selected]
    return { area: shape ? metres(ellipsoidArea(shape.rings)) : null, bad: [] }
  }
  const parsed = state.values.map((v) => parseDecimal(v))
  const bad = parsed.map((p) => p === null)
  if (bad.some(Boolean)) return { area: null, bad }
  const values = parsed as Q[]
  switch (state.mode) {
    case 'hill':
    case 'terai':
      return { area: fromCompound(values, state.mode), bad }
    default:
      return { area: mul(values[0], UNIT[state.unit].m2), bad }
  }
}

function CompoundCard({ system, area, onCopy }: { system: SystemId; area: Q; onCopy: (text: string, what: string) => void }) {
  const { parts, text } = toCompound(area, system)
  const ids = SYSTEMS[system].parts
  return (
    <article className="land-card">
      <header>
        <h3>{system === 'hill' ? 'Hill system' : 'Terai system'}</h3>
        <span>{SYSTEMS[system].name}</span>
        <button onClick={() => onCopy(text, SYSTEMS[system].name)} aria-label={`Copy ${SYSTEMS[system].name}`} title="Copy"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
      </header>
      <output className="land-compound" aria-label={`${SYSTEMS[system].name}: ${text}`}>{text}</output>
      <dl>
        {ids.map((id, i) => (
          <div key={id}><dt>{UNIT[id].name} <span lang="ne">{UNIT[id].nepali}</span></dt><dd>{parts[i]}</dd></div>
        ))}
      </dl>
    </article>
  )
}

export default function LandTool() {
  const [state, setState] = useState<State>(() => readFragment(window.location.hash))
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#m=')) setState(readFragment(window.location.hash)) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const fragment = writeFragment(state)
  useEffect(() => {
    if (window.location.hash !== fragment) window.history.replaceState(window.history.state, '', fragment)
  }, [fragment])

  const solved = useMemo(() => (state.mode === 'plot' ? solvePlot(state.plot, state.lengthUnit) : null), [state.mode, state.plot, state.lengthUnit])
  const [earth, setEarth] = useState<EarthData | null>(null)
  const [earthError, setEarthError] = useState('')
  const [earthLoading, setEarthLoading] = useState(false)
  const { area, bad } = useMemo(() => areaOf(state, solved, earth), [state, solved, earth])

  const openEarthFile = async (file: File) => {
    setEarthLoading(true)
    setEarthError('')
    try {
      const text = await kmlFromFile(file.name, new Uint8Array(await file.arrayBuffer()))
      const read = readShapes(text)
      // Start on the largest shape: in a file with several, that is usually the plot.
      const areas = read.shapes.map((s) => ellipsoidArea(s.rings))
      setEarth({ fileName: file.name, read, selected: areas.length ? areas.indexOf(Math.max(...areas)) : 0 })
    } catch (error) {
      setEarth(null)
      setEarthError(error instanceof Error ? error.message : String(error))
    } finally {
      setEarthLoading(false)
    }
  }

  const setMode = (mode: Mode) => {
    if (mode === state.mode) return
    // Carry the current area into the new mode where it has an obvious form.
    let values = Array<string>(SIZE[mode]).fill('')
    if (area && (mode === 'hill' || mode === 'terai')) values = toCompound(area, mode, 4).parts
    else if (area && mode === 'unit') values = [formatQ(div(area, UNIT[state.unit].m2), UNIT[state.unit].digits, false)]
    const plot = mode === 'plot' && !state.plot.points.length ? START_PLOT : state.plot
    setState({ ...state, mode, values, plot })
  }

  const setValue = (i: number, value: string) => {
    const values = [...state.values]
    values[i] = value
    setState({ ...state, values })
  }

  // Pasting "0-4-2-1" into any field of a compound form fills all of them.
  const pasteCompound = (event: ClipboardEvent<HTMLInputElement>) => {
    if (state.mode !== 'hill' && state.mode !== 'terai') return
    const parts = parseCompound(event.clipboardData.getData('text'), state.mode)
    if (!parts) return
    event.preventDefault()
    setState({ ...state, values: parts })
  }

  const fields = (() => {
    switch (state.mode) {
      case 'hill':
      case 'terai':
        return SYSTEMS[state.mode].parts.map((id) => ({ label: UNIT[id].name, nepali: UNIT[id].nepali }))
      case 'unit':
        return [{ label: 'Area', nepali: undefined }]
      case 'plot':
      case 'earth':
        return []
    }
  })()

  const empty = area !== null && area.n === 0n

  return (
    <div className="land-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined" aria-hidden>landscape</span> Land area · Nepal</>}
        localLabel="exact conversion"
      >
        <button onClick={() => void copy(window.location.href, 'Link')} aria-label="Copy a link to this area" title="Copy link"><span className="material-symbols-outlined" aria-hidden>link</span></button>
      </ToolHeader>

      <main id="main-content" className={`land-main${state.mode === 'plot' || state.mode === 'earth' ? ' is-plot' : ''}`}>
        <section className="land-pane" aria-labelledby="land-input-title">
          <header><span className="land-step">01</span><h2 id="land-input-title">Area</h2></header>
          <div className="land-body">
            <div className="land-modes" role="group" aria-label="Enter the area as">
              {MODES.map((m) => (
                <button key={m.id} className={state.mode === m.id ? 'on' : ''} aria-pressed={state.mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
              ))}
            </div>

            {state.mode === 'plot' && solved && (
              <PlotEditor
                plot={state.plot}
                unit={state.lengthUnit}
                result={solved}
                onChange={(plot) => setState((s) => ({ ...s, plot }))}
                onUnit={(lengthUnit) => setState((s) => ({ ...s, lengthUnit }))}
              />
            )}

            {state.mode === 'earth' && (
              <EarthPanel
                data={earth}
                error={earthError}
                loading={earthLoading}
                onFile={(file) => void openEarthFile(file)}
                onSelect={(selected) => setEarth((e) => (e ? { ...e, selected } : e))}
                onSketch={(shape) => {
                  const plot = toPlot(shape.rings[0], state.lengthUnit)
                  if (plot) setState((s) => ({ ...s, mode: 'plot', values: [], plot }))
                }}
              />
            )}

            {state.mode !== 'plot' && state.mode !== 'earth' && <div className={`land-fields land-fields-${state.mode}`}>
              {fields.map((f, i) => (
                <label key={f.label} className="land-field">
                  <span>{f.label} {f.nepali && <span lang="ne">{f.nepali}</span>}</span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={state.values[i] ?? ''}
                    placeholder="0"
                    aria-invalid={bad[i]}
                    onPaste={pasteCompound}
                    onChange={(event) => setValue(i, event.target.value)}
                  />
                </label>
              ))}
              {state.mode === 'unit' && (
                <label className="land-field">
                  <span>Unit</span>
                  <select value={state.unit} onChange={(event) => setState({ ...state, unit: event.target.value as UnitId })}>
                    {UNITS.map((u) => <option key={u.id} value={u.id}>{u.name}{u.nepali ? ` (${u.nepali})` : ''}</option>)}
                  </select>
                </label>
              )}
            </div>}

            {state.mode === 'plot' || state.mode === 'earth' ? null : bad.some(Boolean)
              ? <p className="land-error" role="alert">Use plain numbers — digits and one decimal point (Nepali digits are fine).</p>
              : <p className="land-hint">
                  {state.mode === 'hill' || state.mode === 'terai'
                    ? `Paste a land-record figure such as ${state.mode === 'hill' ? '0-4-2-1' : '1-5-10.5'} into any box to fill them all. Parts may have decimals or go past their usual limit; they are added up.`
                    : 'Every conversion is exact; only the last digit shown is rounded.'}
                </p>}
          </div>
        </section>

        <section className="land-pane land-results" aria-labelledby="land-result-title" aria-live="polite">
          <header><span className="land-step">02</span><h2 id="land-result-title">In every unit</h2></header>
          <div className="land-body">
            {area && !empty ? (
              <>
                {solved?.ok && (solved.conflicts.length > 0 || solved.crossing) && (
                  <p className="land-warn">These figures come from a sketch whose measurements disagree — see the note under the sketch before relying on them.</p>
                )}
                <div className="land-cards">
                  <CompoundCard system="hill" area={area} onCopy={(t, w) => void copy(t, w)} />
                  <CompoundCard system="terai" area={area} onCopy={(t, w) => void copy(t, w)} />
                </div>
                <table className="land-table">
                  <caption className="land-sr">The area in each unit</caption>
                  <tbody>
                    {UNITS.map((u) => {
                      const value = formatQ(div(area, u.m2), u.digits)
                      return (
                        <tr key={u.id}>
                          <th scope="row">{u.name} {u.nepali && <span lang="ne">{u.nepali}</span>}</th>
                          <td>{value}</td>
                          <td><button onClick={() => void copy(value.replace(/,/g, ''), u.name)} aria-label={`Copy ${u.name}`} title="Copy"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="land-placeholder">{state.mode === 'earth' ? 'Drop a KML or KMZ with the plot drawn as a polygon.' : state.mode === 'plot' ? 'Finish measuring the sketch to see its area in every unit.' : area ? 'Enter an area to see it in every unit.' : 'Fix the highlighted field.'}</p>
            )}
          </div>
        </section>

        <section className="land-pane land-defs" aria-labelledby="land-defs-title">
          <header><span className="land-step">03</span><h2 id="land-defs-title">Definitions</h2></header>
          <div className="land-body">
            <p className="land-hint">Both systems are defined in feet; the foot is exactly 0.3048 m, so every figure here is exact before rounding for display. Ropani-Aana-Paisa-Dam is used in the hills and the Kathmandu valley, Bigha-Kattha-Dhur in the Terai.</p>
            <dl>
              {UNITS.filter((u) => u.id !== 'm2').map((u) => (
                <div key={u.id}>
                  <dt>1 {u.name} {u.nepali && <span lang="ne">{u.nepali}</span>}</dt>
                  <dd>{u.definition}{NEPALI_UNITS.has(u.id) ? ` = ${formatQ(u.m2, 8)} m²` : ''}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Toast message={toast} />
    </div>
  )
}
