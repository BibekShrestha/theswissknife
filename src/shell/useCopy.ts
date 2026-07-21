import { useCallback } from 'react'

export function useCopy(showToast: (msg: string) => void) {
  return useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${what} copied`)
    } catch {
      showToast('Copy failed — clipboard unavailable')
    }
  }, [showToast])
}
