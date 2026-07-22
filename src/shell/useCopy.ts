import { useCallback } from 'react'

export function useCopy(showToast: (msg: string) => void) {
  return useCallback(async (text: string, what: string) => {
    try {
      // Modern async clipboard API (requires secure context + user gesture)
      await navigator.clipboard.writeText(text)
      showToast(`${what} copied`)
      return
    } catch {
      // Fallback: execCommand (works in more restricted environments)
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        textarea.style.pointerEvents = 'none'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        showToast(`${what} copied`)
        return
      } catch {
        showToast('Copy failed — clipboard unavailable')
      }
    }
  }, [showToast])
}
