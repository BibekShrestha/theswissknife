import { useRef, useState } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import DecodeView, { type DecodeViewHandle } from './DecodeView'
import GenerateView from './GenerateView'
import './jwt.css'

type Mode = 'decode' | 'generate'

export default function JwtTool() {
  const [mode, setMode] = useState<Mode>('decode')
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const decodeRef = useRef<DecodeViewHandle | null>(null)

  return (
    <div className="jwt-app">
      <ToolHeader
        brand={<><span className="jwt-brand-mark">JWT</span> {mode === 'decode' ? 'decoder' : 'generator'}</>}
        beforeSwitcher={
          <>
            <div className="jwt-tabs" role="tablist" aria-label="Mode">
              <button role="tab" aria-selected={mode === 'decode'} className={mode === 'decode' ? 'on' : ''} onClick={() => setMode('decode')}>
                Decode
              </button>
              <button role="tab" aria-selected={mode === 'generate'} className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>
                Generate
              </button>
            </div>
            <span className="jwt-privacy"><span className="material-symbols-outlined" aria-hidden>lock</span> runs locally — tokens & keys never leave your browser</span>
          </>
        }
      >
        {mode === 'decode' && (
          <button onClick={() => decodeRef.current?.loadSample()} title="Load the jwt.io sample token">
            Sample
          </button>
        )}
      </ToolHeader>

      {/* both views stay mounted so switching tabs never loses state */}
      <div className={mode === 'decode' ? '' : 'jwt-hidden'}>
        <DecodeView onCopy={copy} handleRef={decodeRef} />
      </div>
      <div className={mode === 'generate' ? '' : 'jwt-hidden'}>
        <GenerateView onCopy={copy} />
      </div>

      {toast && <div className="shell-toast">{toast}</div>}
    </div>
  )
}
