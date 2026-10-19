/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dropzone } from './Dropzone'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null

afterEach(() => {
  host?.remove()
  host = null
})

async function pick(files: File[]) {
  const onFiles = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(createElement(Dropzone, { count: 0, disabled: false, onFiles })))
  const input = host.querySelector('input[type="file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  await act(async () => root.unmount())
  return onFiles.mock.calls.flat(2) as File[]
}

describe('Dropzone (IMG-2)', () => {
  it('hands every file to the sniffer — HEIC, TIFF and unnamed files included', async () => {
    const files = [
      new File([new Uint8Array([1])], 'photo.heic', { type: 'image/heic' }),
      new File([new Uint8Array([2])], 'scan.tiff', { type: 'image/tiff' }),
      new File([new Uint8Array([3])], 'download', { type: '' }),
      new File([new Uint8Array([4])], 'really-a-png.jpg', { type: 'image/jpeg' }),
    ]
    expect((await pick(files)).map((f) => f.name)).toEqual(['photo.heic', 'scan.tiff', 'download', 'really-a-png.jpg'])
  })
})
