import { useEffect, useState } from 'react'

const KEY = 'tsk.theme'
const LEGACY_KEY = 'jqplay.theme'

function initialTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // storage unavailable
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Site-wide theme; only one page (landing or a tool) is mounted at a time. */
export function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // not fatal
    }
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
