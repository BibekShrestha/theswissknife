import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './shell/App'
import './shell/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
