import { useEffect, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { Durations } from './Durations'
import { Converter } from './Converter'
import { readHash, type HashState } from './share'
import './dates.css'

type Tab = 'convert' | 'durations'

export default function DatesTool() {
  const [initial, setInitial] = useState<HashState>(() => readHash(window.location.hash))
  const [tab, setTab] = useState<Tab>(() => (initial.tab ?? 'convert'))
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

  const converterInitial = initial.tab === 'convert' ? initial.converter : {}
  const durationsInitial = initial.tab === 'durations' ? initial.durations : {}

  return (
    <div className="dates-app">
      <ToolHeader
        brand={<><span className="tool-mark-accent">TZ</span> Dates &amp; time zones</>}
        localLabel="computed locally"
        beforeSwitcher={
          <div className="dates-tabs" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={tab === 'convert'} className={tab === 'convert' ? 'on' : ''} onClick={() => setTab('convert')}>Convert</button>
            <button role="tab" aria-selected={tab === 'durations'} className={tab === 'durations' ? 'on' : ''} onClick={() => setTab('durations')}>Durations</button>
          </div>
        }
      >
        <button onClick={() => void copy(window.location.href, 'Link')}>Copy link</button>
      </ToolHeader>

      <main id="main-content" className="dates-main">
        <div hidden={tab !== 'convert'} role="tabpanel" aria-label="Convert">
          <Converter key={`c${generation}`} initial={converterInitial} active={tab === 'convert'} copy={copy} />
        </div>
        <div hidden={tab !== 'durations'} role="tabpanel" aria-label="Durations">
          <Durations key={`d${generation}`} initial={durationsInitial} active={tab === 'durations'} copy={copy} />
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}
