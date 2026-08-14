/**
 * What a keystroke means to the shell.
 *
 * Two rules decide every binding here, both learned the hard way:
 *
 * 1. No ⌘/⌃/⌥ combinations. The obvious choices are already taken by the
 *    browser — ⌘1–⌘9 switches tabs and ⌘⇧H goes Home — and those never reach
 *    the page, so a handler bound to them either does nothing or fires
 *    *alongside* the browser's own action.
 * 2. Nothing fires while the user is typing. A global '?' handler that runs
 *    inside a textarea swallows the character the user was trying to type.
 */

export type ShortcutAction =
  | { type: 'help' }
  | { type: 'home' }
  | { type: 'tool'; index: number }

/** <input> types that are buttons or pickers rather than places you type. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

interface TargetLike {
  tagName?: string
  type?: string
  isContentEditable?: boolean
}

/**
 * True when the keystroke belongs to whatever the user is typing in.
 * `isContentEditable` is what covers CodeMirror, whose editor is a
 * contenteditable div rather than a textarea.
 */
export function isTypingTarget(target: unknown): boolean {
  const el = target as TargetLike | null
  if (!el) return false
  if (el.isContentEditable) return true
  switch (el.tagName?.toUpperCase()) {
    case 'TEXTAREA':
    case 'SELECT':
      return true
    case 'INPUT':
      return !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase())
    default:
      return false
  }
}

/** The parts of a KeyboardEvent this module reads. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
  target?: unknown
}

export function resolveShortcut(event: KeyLike, toolCount: number): ShortcutAction | null {
  // Mid-composition keystrokes belong to the IME. Older browsers report the
  // state only as keyCode 229.
  if (event.isComposing || event.keyCode === 229) return null
  // Anything modified belongs to the browser or the OS — never to us.
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (isTypingTarget(event.target)) return null
  if (event.key === '?') return { type: 'help' }
  if (event.key === 'h' || event.key === 'H') return { type: 'home' }
  if (event.key.length === 1 && event.key >= '1' && event.key <= '9') {
    const index = Number(event.key) - 1
    return index < toolCount ? { type: 'tool', index } : null
  }
  return null
}
