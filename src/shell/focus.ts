import { useEffect, useRef, type RefObject } from 'react'

/**
 * Focus handling for the shell's overlays — the command palette and the two
 * index drawers. Shell-internal: tools own their own modals.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]

/** Open overlays, innermost last: only the top one answers Tab and Escape (a palette over a drawer). */
const stack: HTMLElement[] = []

interface ModalFocusOptions {
  /** Called on Escape. */
  onEscape?: () => void
  /**
   * Behave as a modal only while this media query matches — a drawer that is
   * a plain column on wide screens must not trap Tab there.
   */
  media?: string
  /** Where focus goes on open: the first control (default) or the container itself. */
  initial?: 'first' | 'container'
}

/**
 * While `active`: moves focus into `ref`, keeps Tab and Shift+Tab inside it,
 * closes on Escape, and on close hands focus back to whatever had it before —
 * unless the user has since put focus somewhere else on purpose.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, active: boolean, options: ModalFocusOptions = {}) {
  // Kept in a ref so an inline onEscape doesn't re-run the effect (and
  // re-capture the opener) on every render.
  const latest = useRef(options)
  latest.current = options
  const { media, initial = 'first' } = options

  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    if (media && typeof matchMedia === 'function' && !matchMedia(media).matches) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!root.contains(document.activeElement)) {
      const target = initial === 'container' ? root : focusables(root)[0] ?? root
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      target.focus()
    }

    stack.push(root)

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== root) return
      if (event.key === 'Escape') {
        latest.current.onEscape?.()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables(root)
      const first = list[0]
      const last = list[list.length - 1]
      const current = document.activeElement
      const outside = !root.contains(current)
      if (!first) {
        event.preventDefault()
        root.focus()
      } else if (event.shiftKey && (outside || current === first || current === root)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stack.splice(stack.lastIndexOf(root), 1)
      const current = document.activeElement
      const lost = !current || current === document.body || root.contains(current)
      if (opener?.isConnected && lost) opener.focus()
    }
  }, [ref, active, media, initial])
}
