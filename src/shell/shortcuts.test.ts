import { describe, expect, it } from 'vitest'
import { isTypingTarget, resolveShortcut, type KeyLike } from './shortcuts'
import { tools } from './registry'

const COUNT = tools.length
const press = (key: string, extra: Partial<KeyLike> = {}): KeyLike => ({ key, ...extra })

describe('resolveShortcut', () => {
  it('opens the panel on ?', () => {
    expect(resolveShortcut(press('?'), COUNT)).toEqual({ type: 'help' })
  })

  it('goes home on h, shifted or not', () => {
    expect(resolveShortcut(press('h'), COUNT)).toEqual({ type: 'home' })
    expect(resolveShortcut(press('H', { shiftKey: true }), COUNT)).toEqual({ type: 'home' })
  })

  it('maps digits to tools by position', () => {
    expect(resolveShortcut(press('1'), COUNT)).toEqual({ type: 'tool', index: 0 })
    expect(resolveShortcut(press('9'), COUNT)).toEqual({ type: 'tool', index: 8 })
  })

  it('ignores a digit with no tool behind it', () => {
    expect(resolveShortcut(press('9'), 3)).toBeNull()
    expect(resolveShortcut(press('0'), COUNT)).toBeNull()
  })

  /**
   * The bug this file exists for: '?' is Shift+/ on most layouts, and a global
   * handler that claims it swallows the character inside a text field.
   */
  it('leaves every key alone while the user is typing', () => {
    for (const target of [
      { tagName: 'TEXTAREA' },
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'search' },
      { tagName: 'DIV', isContentEditable: true }, // CodeMirror
    ]) {
      expect(resolveShortcut(press('?', { target }), COUNT)).toBeNull()
      expect(resolveShortcut(press('h', { target }), COUNT)).toBeNull()
      expect(resolveShortcut(press('1', { target }), COUNT)).toBeNull()
    }
  })

  it('still fires when focus is on a checkbox or a button', () => {
    expect(resolveShortcut(press('?', { target: { tagName: 'INPUT', type: 'checkbox' } }), COUNT))
      .toEqual({ type: 'help' })
    expect(resolveShortcut(press('1', { target: { tagName: 'BUTTON' } }), COUNT))
      .toEqual({ type: 'tool', index: 0 })
  })

  /**
   * ⌘1–⌘9 switches browser tabs and ⌘⇧H is Home; the page cannot win those, so
   * it must not try to act on them either.
   */
  it('never claims a modified key', () => {
    expect(resolveShortcut(press('1', { metaKey: true }), COUNT)).toBeNull()
    expect(resolveShortcut(press('1', { ctrlKey: true }), COUNT)).toBeNull()
    expect(resolveShortcut(press('H', { metaKey: true, shiftKey: true }), COUNT)).toBeNull()
    expect(resolveShortcut(press('h', { altKey: true }), COUNT)).toBeNull()
  })

  it('stays out of the way of an IME', () => {
    expect(resolveShortcut(press('h', { isComposing: true }), COUNT)).toBeNull()
    expect(resolveShortcut(press('Process', { keyCode: 229 }), COUNT)).toBeNull()
  })

  it('ignores keys it has no binding for', () => {
    for (const key of ['ArrowLeft', 'Escape', 'a', 'Enter', ' ']) {
      expect(resolveShortcut(press(key), COUNT)).toBeNull()
    }
  })
})

describe('isTypingTarget', () => {
  it('handles a missing target', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })

  it('treats an input with no type as text', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
  })
})
