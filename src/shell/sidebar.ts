import { useSyncExternalStore } from 'react'

/**
 * Whether the tool index drawer (narrow screens) is open. A tiny store rather
 * than App state so every menu toggle — ToolHeader's, the loading skeleton's —
 * can report aria-expanded without a prop threaded through each tool.
 */
let open = false
const listeners = new Set<() => void>()

export function setSidebarOpen(value: boolean) {
  if (open === value) return
  open = value
  listeners.forEach((fn) => fn())
}

export const openSidebar = () => setSidebarOpen(true)

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export const useSidebarOpen = () => useSyncExternalStore(subscribe, () => open, () => false)
