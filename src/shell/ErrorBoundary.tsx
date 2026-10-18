import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from './router'

interface Props {
  children: ReactNode
  /** Rendered instead of the tool error screen — a function gets the error. */
  fallback?: ReactNode | ((error: Error) => ReactNode)
  onError?: (error: Error) => void
}

interface State {
  error: Error | null
}

const URL_PATTERN = /(?:https?|file):\/\/[^\s]+/g

/** Local paths and stack frames, scrubbed from the text between URLs. */
const scrubText = (text: string) =>
  text
    .replace(/(\/[a-zA-Z0-9_\-./]+)+(\.\w+)/g, '[path]')
    .replace(/at\s+[^(]+\([^)]+\)/g, '[stack frame]') // strip detailed stack frames

/**
 * Sanitize error messages to avoid leaking internal paths or environment
 * details to the user-facing UI. The full error is still logged to the
 * developer console. The site's own URLs (a chunk or stylesheet that failed to
 * load) are shown as their path: there is nothing to hide in them, and calling
 * them "[external url]" sent people looking for a third party.
 */
export function sanitizeMessage(message: string, origin = globalThis.location?.origin): string {
  let out = ''
  let last = 0
  for (const match of message.matchAll(URL_PATTERN)) {
    const url = match[0]
    out += scrubText(message.slice(last, match.index))
    if (url.startsWith('file:')) out += '[file]'
    else if (origin && url.startsWith(`${origin}/`)) out += url.slice(origin.length)
    else out += '[external url]'
    last = match.index + url.length
  }
  return (out + scrubText(message.slice(last))).trim()
}

/** Vite's preload helper rejects a lazy chunk with this when its stylesheet fails to load. */
export function isCssLoadError(error: Error): boolean {
  return /unable to preload css/i.test(error.message)
}

/**
 * A tab left open across a deploy asks for chunk names that no longer exist.
 * Browsers word that failure differently; all of them name the import. A tool
 * stylesheet that 404s fails the same import, worded by Vite.
 */
export function isStaleChunkError(error: Error): boolean {
  return isCssLoadError(error) || /dynamically imported module|importing a module script failed|error loading dynamically imported module|failed to fetch dynamically/i.test(error.message)
}

export interface ErrorView {
  title: string
  body: string
  /** Offer a full reload — the only reliable retry for a failed chunk or stylesheet. */
  reload: boolean
}

export function describeError(error: Error, online: boolean): ErrorView {
  if (isStaleChunkError(error)) {
    // A tool that has never been opened is not in the offline cache, so its
    // lazy chunk fails to load. That is not a crash — say so.
    if (!online) {
      return {
        title: 'Offline',
        body: "This tool hasn't been downloaded yet. Open it once while online and it will work offline from then on.",
        reload: false,
      }
    }
    return {
      title: 'A newer version is available',
      body: "The site was updated since this tab opened, so this tool's old files are gone. Reload to get the current version.",
      reload: true,
    }
  }
  return { title: 'Something went wrong', body: sanitizeMessage(error.message) || 'An unexpected error occurred.', reload: false }
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
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    if (fallback !== undefined) return fallback instanceof Function ? fallback(error) : fallback

    const view = describeError(error, typeof navigator === 'undefined' || navigator.onLine)
    return (
      // #main-content: the tool's own landmark went down with it, and the
      // skip link still needs somewhere to land.
      <main id="main-content" tabIndex={-1} className="shell-error">
        <div role="alert">
          <h1>{view.title}</h1>
          <pre>{view.body}</pre>
        </div>
        {view.reload && (
          <button type="button" className="shell-reload-btn" onClick={() => window.location.reload()}>
            <span className="material-symbols-outlined" aria-hidden>refresh</span> Reload
          </button>
        )}
        <Link to="/" className="shell-home-btn">
          <span className="material-symbols-outlined" aria-hidden>arrow_back</span> All tools
        </Link>
      </main>
    )
  }
}
