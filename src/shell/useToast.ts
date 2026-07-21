import { useCallback, useEffect, useRef, useState } from 'react'

const VISIBLE_MS = 4000

export function useToast() {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number>(undefined)

  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), VISIBLE_MS)
  }, [])

  return { toast, showToast }
}
