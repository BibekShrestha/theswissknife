import type { ReactNode } from 'react'
import { tools } from './registry'
import { Link, navigate, usePath } from './router'
import { useTheme } from './theme'

interface ToolHeaderProps {
  brand: ReactNode
  localLabel?: string
  /** Content rendered between the brand and the tool-switcher (e.g. tabs). */
  beforeSwitcher?: ReactNode
  /** Content rendered after the spacer, before the theme toggle. */
  children?: ReactNode
}

export function ToolHeader({ brand, localLabel, beforeSwitcher, children }: ToolHeaderProps) {
  const path = usePath()
  const [theme, toggleTheme] = useTheme()

  return (
    <header className="shell-toolbar">
      <Link to="/" className="home-link" title="All tools — The Swiss Knife">
        <span className="material-symbols-outlined">home</span>
      </Link>
      <div className="shell-brand">{brand}</div>
      {localLabel && <span className="shell-local-badge">{localLabel}</span>}
      {beforeSwitcher}
      <select className="tool-switcher" value={path} onChange={(e) => navigate(`/${e.target.value}`)} aria-label="Switch tool">
        {tools.filter((t) => t.slug !== path).map((t) => (
          <option key={t.slug} value={t.slug}>{t.name}</option>
        ))}
      </select>
      <div className="spacer" />
      {children}
      <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
    </header>
  )
}
