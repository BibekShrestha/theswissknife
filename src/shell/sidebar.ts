const OPEN = 'shell:open-sidebar'

export const openSidebar = () => window.dispatchEvent(new Event(OPEN))

export function onOpenSidebar(fn: () => void) {
  window.addEventListener(OPEN, fn)
  return () => window.removeEventListener(OPEN, fn)
}
