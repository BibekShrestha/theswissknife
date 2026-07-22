import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from './router'

interface Props {
  children: ReactNode
  fallback?: ReactNode
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

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tool error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback
      const message = sanitizeMessage(this.state.error.message)
      return (
        <div className="shell-error">
          <h1>Something went wrong</h1>
          <pre>{message || 'An unexpected error occurred.'}</pre>
          <Link to="/" className="shell-home-btn">
            <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}
