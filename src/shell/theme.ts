import { useEffect, useState } from 'react'

const KEY = 'tsk.theme'
const LEGACY_KEY = 'jqplay.theme'

type Theme = 'dark' | 'light'

function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // storage unavailable
  }
  return null
}

const systemQuery = () => window.matchMedia('(prefers-color-scheme: light)')
const systemTheme = (): Theme => (systemQuery().matches ? 'light' : 'dark')

/**
 * Site-wide theme; only one page (landing or a tool) is mounted at a time.
 * Until the toggle is used the page follows the OS, including later changes;
 * only an explicit toggle is remembered.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#121212' : '#f7f7f5',
    )
  }, [theme])

  useEffect(() => {
    const query = systemQuery()
    const onChange = () => { if (!storedTheme()) setTheme(systemTheme()) }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const toggle = () => setTheme((current) => {
    const next = current === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // not fatal
    }
    return next
  })
  return [theme, toggle]
}
