import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from './router'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
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
      return (
        <div className="shell-error">
          <h1>Something went wrong</h1>
          <pre>{this.state.error.message}</pre>
          <Link to="/" className="shell-home-btn">
            <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
          </Link>
        </div>
      )
    }
    return this.props.children
  }
}
