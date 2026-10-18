/**
 * Cell edits live only in the parsed rows, so anything that re-reads the
 * text would drop them. These run the real tool in a DOM to pin down what
 * happens to edits, and what a paste into the grid does.
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CsvTool from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class NoResize {
  observe() {}
  disconnect() {}
  unobserve() {}
}

let root: Root
let host: HTMLDivElement
let confirmSpy: ReturnType<typeof vi.fn>

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)
const button = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const cell = (row: number, column: number) =>
  host.querySelectorAll('.csv-row')[row]?.querySelectorAll<HTMLElement>('[role="gridcell"]')[column]
const editsLabel = () => $('.csv-foot-edits')?.textContent ?? ''

function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function editCell(row: number, column: number, value: string) {
  await act(async () => {
    cell(row, column)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  const input = $<HTMLInputElement>('.csv-editor')!
  await act(async () => setValue(input, value))
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

function paste(target: EventTarget, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  target.dispatchEvent(event)
  return event
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', NoResize)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }))
  confirmSpy = vi.fn(() => false)
  vi.stubGlobal('confirm', confirmSpy)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<CsvTool />))
  await act(async () => button('Load sample CSV').click())
  await settle()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('CSV-1: edits and re-parsing', () => {
  it('asks before a parse option discards edits, and keeps them on cancel', async () => {
    await editCell(0, 1, 'Edited name')
    expect(editsLabel()).toBe('1 edit')

    await act(async () => $<HTMLButtonElement>('button[title="Parsing options"]')!.click())
    const trim = Array.from(host.querySelectorAll('label')).find((l) => l.textContent?.includes('Trim fields'))!
      .querySelector('input')!
    await act(async () => trim.click())
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(trim.checked).toBe(false)
    expect(cell(0, 1)!.textContent).toBe('Edited name')
    expect(editsLabel()).toBe('1 edit')

    confirmSpy.mockReturnValue(true)
    await act(async () => trim.click())
    await settle()
    expect(trim.checked).toBe(true)
    // The re-parse is honest about it: the edit is gone and so is the count.
    expect(cell(0, 1)!.textContent).toBe('Alvarez, Renata')
    expect(editsLabel()).toBe('')
  })

  it('asks before typing in the pasted text discards edits, and says the text lacks them', async () => {
    await editCell(0, 1, 'Edited name')
    await act(async () => button('Show the pasted text').click())
    expect($('.csv-source-edits')?.textContent).toMatch(/1 cell edit/)

    const textarea = $<HTMLTextAreaElement>('textarea')!
    await act(async () => setValue(textarea, `${textarea.value}\n9,x`))
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(cell(0, 1)!.textContent).toBe('Edited name')
  })

  it('asks before Load sample discards edits', async () => {
    await editCell(0, 1, 'Edited name')
    await act(async () => button('Load sample CSV').click())
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(cell(0, 1)!.textContent).toBe('Edited name')
  })
})

describe('CSV-11: no-op edits', () => {
  it('does not count leaving a cell unchanged', async () => {
    await editCell(0, 1, 'Alvarez, Renata')
    expect(editsLabel()).toBe('')
  })
})

describe('CSV-4: paste while the grid has focus', () => {
  it('leaves the file alone', async () => {
    const grid = $('[role="grid"]')!
    let event!: Event
    await act(async () => {
      event = paste(cell(0, 0)!, 'x,y\n1,2')
    })
    await settle()
    expect(event.defaultPrevented).toBe(false)
    expect(grid.isConnected && cell(0, 1)!.textContent).toBe('Alvarez, Renata')
  })

  it('asks before a paste elsewhere discards edits', async () => {
    await editCell(0, 1, 'Edited name')
    await act(async () => {
      paste(document.body, 'x,y\n1,2')
    })
    await settle()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(cell(0, 1)!.textContent).toBe('Edited name')
  })
})

describe('CSV-8: the keyboard cursor is exposed to assistive tech', () => {
  it('points aria-activedescendant at the selected cell', async () => {
    await act(async () => {
      cell(1, 2)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const grid = $('[role="grid"]')!
    const id = grid.getAttribute('aria-activedescendant')
    expect(id).toBeTruthy()
    const active = document.getElementById(id!)!
    expect(active).toBe(cell(1, 2))
    expect(active.getAttribute('aria-selected')).toBe('true')

    await act(async () => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.getElementById(grid.getAttribute('aria-activedescendant')!)).toBe(cell(2, 2))
  })
})
