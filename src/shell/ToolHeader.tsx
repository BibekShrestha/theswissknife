import type { ReactNode } from 'react'
import { BladeMark } from './BladeMark'
import { openPalette, paletteKeyLabel } from './palette'
import { Link } from './router'
import { openSidebar } from './sidebar'
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
      <button type="button" className="shell-menu-toggle" onClick={openSidebar} aria-label="Open tool index">
        <span className="material-symbols-outlined" aria-hidden>menu</span>
      </button>
      <Link to="/" className="home-link" title="All tools — The Swiss Knife">
        <BladeMark className="shell-logo-mark" />
      </Link>
      <div className="shell-tool-identity">
        <div className="shell-brand">{brand}</div>
        <span>theswissknife.com</span>
      </div>
      {localLabel && <span className="shell-local-badge">{localLabel}</span>}
      {beforeSwitcher}
      <div className="spacer" />
      {children}
      <button className="palette-btn" onClick={openPalette} aria-label="Search tools" title="Search tools">
        <span className="material-symbols-outlined" aria-hidden>search</span>
        <span className="palette-btn-label">Search tools…</span>
        <kbd>{paletteKeyLabel()}</kbd>
      </button>
      <a href="https://github.com/BibekShrestha/theswissknife" target="_blank" rel="noreferrer" className="shell-gh-link" aria-label="View The Swiss Knife on GitHub">
        <span className="material-symbols-outlined" aria-hidden>code</span>
        <span>GitHub</span>
      </a>
      <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
    </header>
  )
}
