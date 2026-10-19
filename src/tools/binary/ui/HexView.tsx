import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { hexByte } from '../util'
import { HEX_ROW_BYTES, hexWindow, scrollTopForRow } from './model'

const ROW_H = 20

export interface Selection {
  start: number
  head: number
  end: number
  keyStart?: number
  keyEnd?: number
}

interface HexViewProps {
  bytes: Uint8Array
  selection: Selection | null
  /** An offset to mark (an error or warning that was picked). */
  mark: number | null
  onPick: (offset: number) => void
}

const ascii = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')

/**
 * A windowed hex dump: only the rows on screen are in the DOM, so a 32 MB
 * file costs a few dozen rows. Past the browser's element-height limit the
 * scroll position is scaled (model.ts). Clicking a byte selects the
 * innermost decoded item that covers it; the tree is the keyboard path.
 */
export function HexView({ bytes, selection, mark, onPick }: HexViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(320)
  const rows = Math.max(1, Math.ceil(bytes.length / HEX_ROW_BYTES))

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setHeight(el.clientHeight || 320)
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [])
  // The pane's height follows its content (max-height), so measure again when the bytes change too.
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.clientHeight || 320)
  }, [bytes])

  const target = mark ?? selection?.keyStart ?? selection?.start ?? null
  useEffect(() => {
    const el = ref.current
    if (!el || target === null) return
    const row = Math.floor(target / HEX_ROW_BYTES)
    const win = hexWindow(el.scrollTop, el.clientHeight || height, rows, ROW_H)
    if (row < win.first || row >= win.first + win.count - 1) {
      el.scrollTop = scrollTopForRow(Math.max(0, row - 2), el.clientHeight || height, rows, ROW_H)
      setScrollTop(el.scrollTop)
    }
    // Only when the target moves, not on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, bytes])

  const win = hexWindow(scrollTop, height, rows, ROW_H)

  const classOf = (offset: number): string => {
    let cls = ''
    if (selection) {
      if (selection.keyStart !== undefined && offset >= selection.keyStart && offset < selection.keyEnd!) cls = ' bin-hl-key'
      else if (offset >= selection.start && offset < selection.head) cls = ' bin-hl-head'
      else if (offset >= selection.head && offset < selection.end) cls = ' bin-hl-body'
    }
    if (offset === mark) cls += ' bin-hl-mark'
    return cls
  }

  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const offset = (event.target as HTMLElement).dataset.o
    if (offset !== undefined) onPick(Number(offset))
  }

  const lines = []
  for (let r = win.first; r < win.first + win.count; r++) {
    const base = r * HEX_ROW_BYTES
    const hexCells = []
    const textCells = []
    for (let i = 0; i < HEX_ROW_BYTES; i++) {
      const o = base + i
      if (o >= bytes.length) break
      const cls = classOf(o)
      hexCells.push(<span key={i} data-o={o} className={`bin-b${cls}${i === 8 ? ' gap' : ''}`}>{hexByte(bytes[o])}</span>)
      textCells.push(<span key={i} data-o={o} className={`bin-c${cls}`}>{ascii(bytes[o])}</span>)
    }
    lines.push(
      <div key={r} className="bin-hexrow" style={{ top: win.top + (r - win.first) * ROW_H }}>
        <span className="bin-hexoff">{base.toString(16).padStart(8, '0')}</span>
        <span className="bin-hexbytes">{hexCells}</span>
        <span className="bin-hextext">{textCells}</span>
      </div>,
    )
  }

  return (
    <div
      ref={ref}
      className="bin-hex"
      role="region"
      aria-label={`Hex view, ${bytes.length.toLocaleString('en-US')} bytes. Click a byte to select the item that covers it.`}
      tabIndex={0}
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop)
        setHeight(event.currentTarget.clientHeight || 320)
      }}
      onClick={pick}
    >
      <div className="bin-hex-space" style={{ height: win.total }}>{lines}</div>
    </div>
  )
}
