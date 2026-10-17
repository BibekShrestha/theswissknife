import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from './router'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error) => void
}

interface State {
  error: Error | null
}

/**
 * Sanitize error messages to avoid leaking internal paths or environment
 * details to the user-facing UI.  The full error is still logged to the
 * developer console.
 */
function sanitizeMessage(message: string): string {
  // Remove common internal path patterns
  return message
    .replace(/https?:\/\/[^\s]+/g, '[external url]')
    .replace(/(\/[a-zA-Z0-9_\-./]+)+(\.\w+)/g, '[path]')
    .replace(/(file:\/\/)[^\s]+/g, '[file]')
    .replace(/at\s+[^(]+\([^)]+\)/g, '[stack frame]') // strip detailed stack frames
    .trim()
}

/**
 * A tab left open across a deploy asks for chunk names that no longer exist.
 * Browsers word that failure differently; all of them name the import.
 */
export function isStaleChunkError(error: Error): boolean {
  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to fetch dynamically/i.test(error.message)
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tool error:', error, info.componentStack)
    this.props.onError?.(error)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      // A tool that has never been opened is not in the offline cache, so its
      // lazy chunk fails to load. That is not a crash — say so.
      const offline = !navigator.onLine
      const stale = !offline && isStaleChunkError(this.state.error)
      const message = sanitizeMessage(this.state.error.message)
      return (
        <div className="shell-error" role="alert">
          <h1>{offline ? 'Offline' : stale ? 'A newer version is available' : 'Something went wrong'}</h1>
          <pre>
            {offline
              ? "This tool hasn't been downloaded yet. Open it once while online and it will work offline from then on."
              : stale
                ? 'The site was updated since this tab opened, so this tool\'s old files are gone. Reload to get the current version.'
                : message || 'An unexpected error occurred.'}
          </pre>
          {stale && (
            <button type="button" className="shell-reload-btn" onClick={() => window.location.reload()}>
              <span className="material-symbols-outlined" aria-hidden>refresh</span> Reload
            </button>
          )}
          <Link to="/" className="shell-home-btn">
            <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}
