import { lazy, Suspense, useEffect, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useToast } from '../../shell/useToast'
import Generator from './Generator'
import './qr.css'

// The decoder (jsQR) only loads when someone opens Scan.
const Scanner = lazy(() => import('./scan/Scanner'))

type Tab = 'generate' | 'scan'

/** `#scan` makes the scanner linkable without a second route. */
const tabFromHash = (): Tab => (location.hash === '#scan' ? 'scan' : 'generate')

export default function QrTool() {
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const [scanOpened, setScanOpened] = useState(tab === 'scan')
  const { toast, showToast } = useToast()

  const show = (next: Tab) => {
    setTabState(next)
    if (next === 'scan') setScanOpened(true)
  }

  useEffect(() => {
    const onHash = () => show(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setTab = (next: Tab) => {
    show(next)
    history.replaceState(history.state, '', next === 'scan' ? '#scan' : location.pathname + location.search)
  }

  return (
    <div className="qr-app">
      <ToolHeader
        brand={<><span className="material-symbols-outlined">{tab === 'scan' ? 'qr_code_scanner' : 'qr_code_2'}</span> QR code {tab === 'scan' ? 'scanner' : 'generator'}</>}
        localLabel={tab === 'scan' ? 'decoded locally' : 'generated locally'}
        beforeSwitcher={
          <div className="qr-tabs" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={tab === 'generate'} className={tab === 'generate' ? 'on' : ''} onClick={() => setTab('generate')}>Generate</button>
            <button role="tab" aria-selected={tab === 'scan'} className={tab === 'scan' ? 'on' : ''} onClick={() => setTab('scan')}>Scan</button>
          </div>
        }
      />

      {/* Both stay mounted once opened, so switching never loses work. */}
      <main id="main-content" className="qr-body">
        <div hidden={tab !== 'generate'}>
          <Generator showToast={showToast} />
        </div>
        {scanOpened && (
          <div hidden={tab !== 'scan'}>
            <Suspense fallback={<p className="qr-note">Loading the scanner…</p>}>
              <Scanner active={tab === 'scan'} showToast={showToast} />
            </Suspense>
          </div>
        )}
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
