import { useEffect, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { Durations } from './Durations'
import { Planner } from './Planner'
import { readHash, type HashState } from './share'
import './dates.css'

type Tab = 'zones' | 'durations'

export default function DatesTool() {
  const [initial, setInitial] = useState<HashState>(() => readHash(window.location.hash))
  const [tab, setTab] = useState<Tab>(() => (initial.tab ?? 'zones'))
  const [generation, setGeneration] = useState(0)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  // A pasted link (hash change from outside) reloads that tab's state.
  useEffect(() => {
    const onHash = () => {
      const next = readHash(window.location.hash)
      if (!next.tab) return
      setInitial(next)
      setTab(next.tab)
      setGeneration((g) => g + 1)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const plannerInitial = initial.tab === 'zones' ? initial.planner : {}
  const durationsInitial = initial.tab === 'durations' ? initial.durations : {}

  return (
    <div className="dates-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent">TZ</span> Dates &amp; time zones</>}
        localLabel="computed locally"
        beforeSwitcher={
          <div className="dates-tabs" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={tab === 'zones'} className={tab === 'zones' ? 'on' : ''} onClick={() => setTab('zones')}>Time zones</button>
            <button role="tab" aria-selected={tab === 'durations'} className={tab === 'durations' ? 'on' : ''} onClick={() => setTab('durations')}>Durations</button>
          </div>
        }
      >
        <button onClick={() => void copy(window.location.href, 'Link')}>Copy link</button>
      </ToolHeader>

      <main id="main-content" className="dates-main">
        <div hidden={tab !== 'zones'} role="tabpanel" aria-label="Time zones">
          <Planner key={`p${generation}`} initial={plannerInitial} active={tab === 'zones'} copy={copy} showToast={showToast} />
        </div>
        <div hidden={tab !== 'durations'} role="tabpanel" aria-label="Durations">
          <Durations key={`d${generation}`} initial={durationsInitial} active={tab === 'durations'} copy={copy} />
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}
