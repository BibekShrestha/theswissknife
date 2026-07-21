import { useCallback, useRef, useState } from 'react'
import { Link, navigate, usePath } from '../../shell/router'
import { tools } from '../../shell/registry'
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
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
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
          <span className="material-symbols-outlined">home</span>
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
        <span className="jwt-privacy"><span className="material-symbols-outlined" aria-hidden>lock</span> runs locally — tokens & keys never leave your browser</span>
        <select className="tool-switcher" value={usePath()} onChange={(e) => navigate(`/${e.target.value}`)} aria-label="Switch tool">
          {tools.filter((t) => t.slug !== 'jwt').map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
        <div className="spacer" />
        {mode === 'decode' && (
          <button onClick={() => decodeRef.current?.loadSample()} title="Load the jwt.io sample token">
            Sample
          </button>
        )}
        <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
          <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
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
