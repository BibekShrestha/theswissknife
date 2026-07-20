import { useCallback, useRef, useState } from 'react'
import { Link } from '../../shell/router'
import { useTheme } from '../../shell/theme'
import DecodeView, { type DecodeViewHandle } from './DecodeView'
import GenerateView from './GenerateView'
import './jwt.css'

type Mode = 'decode' | 'generate'

export default function JwtTool() {
  const [theme, toggleTheme] = useTheme()
  const [mode, setMode] = useState<Mode>('decode')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const decodeRef = useRef<DecodeViewHandle | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  const copy = useCallback(
    async (text: string, what: string) => {
      try {
        await navigator.clipboard.writeText(text)
        showToast(`${what} copied`)
      } catch {
        showToast('Copy failed — clipboard unavailable')
      }
    },
    [showToast],
  )

  return (
    <div className="jwt-app">
      <header className="jwt-top">
        <Link to="/" className="home-link" title="All tools — The Swiss Knife">
          ✚
        </Link>
        <div className="jwt-brand">
          <span className="jwt-brand-mark">JWT</span> {mode === 'decode' ? 'decoder' : 'generator'}
        </div>
        <div className="jwt-tabs" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'decode'} className={mode === 'decode' ? 'on' : ''} onClick={() => setMode('decode')}>
            Decode
          </button>
          <button role="tab" aria-selected={mode === 'generate'} className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>
            Generate
          </button>
        </div>
        <span className="jwt-privacy">🔒 runs locally — tokens & keys never leave your browser</span>
        <div className="spacer" />
        {mode === 'decode' && (
          <button onClick={() => decodeRef.current?.loadSample()} title="Load the jwt.io sample token">
            Sample
          </button>
        )}
        <button className="icon-btn theme-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      {/* both views stay mounted so switching tabs never loses state */}
      <div className={mode === 'decode' ? '' : 'jwt-hidden'}>
        <DecodeView onCopy={copy} handleRef={decodeRef} />
      </div>
      <div className={mode === 'generate' ? '' : 'jwt-hidden'}>
        <GenerateView onCopy={copy} />
      </div>

      {toast && <div className="jwt-toast">{toast}</div>}
    </div>
  )
}
