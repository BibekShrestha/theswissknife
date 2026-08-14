import type { ToolMeta } from './registry'

/**
 * The command palette is the shell's only keyboard entry point, and opening it
 * is the only thing a keystroke can do on its own. Bare keys were tried first
 * and were a mistake: a stray '3' navigated away from whatever was on screen,
 * and nothing about the new page said how to get back. Every jump now costs a
 * modifier chord, a search and a deliberate ↵.
 *
 * Only the matcher and the open signal live here — the palette UI is a lazy
 * chunk, so the shell bundle carries the entry point and nothing more.
 */

const OPEN = 'shell:open-palette'

/** Opens the palette from anywhere, without threading a callback through. */
export const openPalette = () => window.dispatchEvent(new Event(OPEN))

export function onOpenPalette(fn: () => void) {
  window.addEventListener(OPEN, fn)
  return () => window.removeEventListener(OPEN, fn)
}

/** The parts of a KeyboardEvent the matcher reads. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

/** ⌘K on a Mac, Ctrl K elsewhere — and nothing else, in any context. */
export function isPaletteKey(event: KeyLike): boolean {
  // Mid-composition keystrokes belong to the IME; older browsers report the
  // state only as keyCode 229.
  if (event.isComposing || event.keyCode === 229) return false
  if (event.altKey || event.shiftKey) return false
  if (!event.metaKey && !event.ctrlKey) return false
  return event.key.toLowerCase() === 'k'
}

const isApple = () =>
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)

/** Label for the chord, so the hint matches the keyboard in front of you. */
export const paletteKeyLabel = () => (isApple() ? '⌘K' : 'Ctrl K')

export interface Command {
  /** Route this command navigates to. */
  to: string
  name: string
  hint: string
  mark: string
}

/**
 * Home leads, so the way back out of a tool is the first thing in the list
 * rather than something to remember.
 */
export function toCommands(list: ToolMeta[]): Command[] {
  return [
    { to: '/', name: 'All tools', hint: 'Back to the landing page', mark: '⌂' },
    ...list.map((t) => ({ to: `/${t.slug}`, name: t.name, hint: t.tagline, mark: t.mark })),
  ]
}

/** "jwtg" finds "JWT decode & generate". */
function isSubsequence(haystack: string, needle: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

function score(command: Command, query: string): number {
  const name = command.name.toLowerCase()
  const slug = command.to.slice(1).toLowerCase()
  if (name.startsWith(query) || (slug !== '' && slug.startsWith(query))) return 5
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(query))) return 4
  if (name.includes(query) || slug.includes(query)) return 3
  if (isSubsequence(name, query)) return 2
  if (command.hint.toLowerCase().includes(query)) return 1
  return 0
}

/** Best match first; ties keep registry order so the list never jitters. */
export function rank(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (q === '') return commands
  return commands
    .map((command, index) => ({ command, index, score: score(command, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.command)
}
