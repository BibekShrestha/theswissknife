import { createElement, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

/**
 * Minimal path router. No dependency — the site only needs
 * "pathname → tool slug" with pushState navigation.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

const listeners = new Set<() => void>()
export const emit = () => listeners.forEach((fn) => fn())

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Current route relative to base: '' for the landing page, 'jq', 'jwt', … */
export function currentPath(): string {
  let p = location.pathname
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length)
  return p.replace(/^\/+|\/+$/g, '')
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath)
}

export function navigate(to: string) {
  // pushState treats an empty url as "keep the current one", so the landing
  // page — BASE + '/' — has to be spelled out when BASE is '' (dev, apex site).
  history.pushState(null, '', `${BASE}${to}` || '/')
  emit()
}

interface LinkProps {
  to: string
  className?: string
  title?: string
  children: ReactNode
}

export function Link({ to, className, title, children }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return createElement('a', { href: BASE + to, className, title, onClick }, children)
}
