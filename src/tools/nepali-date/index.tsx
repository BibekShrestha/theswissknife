import { useEffect, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { today } from './calendar'
import { Converter } from './Converter'
import { DateMath } from './DateMath'
import { readFragment, writeFragment, type State, type Tab } from './share'
import './nepali-date.css'

const TABS: { id: Tab; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'math', label: 'Date math' },
]

export default function NepaliDateTool() {
  const [state, setState] = useState<State>(() => readFragment(window.location.hash, today()))
  const set = (patch: Partial<State>) => setState((s) => ({ ...s, ...patch }))
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  useEffect(() => {
    const onHash = () => setState(readFragment(window.location.hash, today()))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const fragment = writeFragment(state)
  useEffect(() => {
    if (window.location.hash !== fragment) window.history.replaceState(window.history.state, '', fragment)
  }, [fragment])

  return (
    <div className="ndate-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent">BS</span> Nepali date</>}
        localLabel="2000–2083 BS"
        beforeSwitcher={
          <div className="ndate-tabs" role="tablist" aria-label="Mode">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={state.tab === t.id} className={state.tab === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })}>{t.label}</button>
            ))}
          </div>
        }
      >
        <button onClick={() => void copy(window.location.href, 'Link')} aria-label="Copy a link to these dates" title="Copy link">
          <span className="material-symbols-outlined" aria-hidden>link</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="ndate-main">
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === state.tab)!.label}>
          {state.tab === 'convert'
            ? <Converter value={state.date} onChange={(date) => set({ date })} copy={copy} />
            : <DateMath state={state} set={set} copy={copy} />}
        </div>
        <p className="ndate-source">
          Month lengths for 2000–2083 BS (14 April 1943 – 13 April 2027) are a table, since the Bikram Sambat calendar is fixed year
          by year rather than by a rule; it agrees with the published calendars it was checked against. Later years are left out
          until their calendar is approved, rather than guessed.
        </p>
      </main>
      <Toast message={toast} />
    </div>
  )
}
