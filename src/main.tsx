import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './shell/App'
import './shell/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Offline support, in its own chunk so it costs the entry bundle only this
// import. Dev has no service worker on purpose — a stale cache is a miserable
// way to debug.
if (import.meta.env.PROD && 'serviceWorker' in navigator) void import('./shell/pwa')
