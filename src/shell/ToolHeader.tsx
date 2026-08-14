import type { ReactNode } from 'react'
import { openPalette, paletteKeyLabel } from './palette'
import { Link } from './router'
import { useTheme } from './theme'

interface ToolHeaderProps {
  brand: ReactNode
  localLabel?: string
  /** Content rendered between the brand and the spacer (e.g. tabs). */
  beforeSwitcher?: ReactNode
  /** Content rendered after the spacer, before the theme toggle. */
  children?: ReactNode
}

export function ToolHeader({ brand, localLabel, beforeSwitcher, children }: ToolHeaderProps) {
  const [theme, toggleTheme] = useTheme()

  return (
    <header className="shell-toolbar">
      <Link to="/" className="home-link" title="All tools — The Swiss Knife">
        <span className="material-symbols-outlined">home</span>
      </Link>
      <div className="shell-brand">{brand}</div>
      {localLabel && <span className="shell-local-badge">{localLabel}</span>}
      {beforeSwitcher}
      <div className="spacer" />
      {children}
      <button className="palette-btn" onClick={openPalette} aria-label="Search tools" title="Search tools">
        <span className="material-symbols-outlined" aria-hidden>search</span>
        <kbd>{paletteKeyLabel()}</kbd>
      </button>
      <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
    </header>
  )
}
