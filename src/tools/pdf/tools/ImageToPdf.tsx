import { useState } from 'react'
import { FileDropzone } from '../components/FileDropzone'
import { SortableFileList } from '../components/SortableFileList'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, PdfInputError } from '../lib/errors'
import { readBytes } from '../lib/files'
import { imageKind } from '../ops/imagekind'
import { runPdfJob } from '../runner'
import { SubtoolHeader } from '../components/SubtoolHeader'

const IMAGE_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
}

/** pdf-lib embeds only PNG and JPEG; the browser decodes anything else (WebP) to a lossless PNG. */
async function toPng(bytes: Uint8Array): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('canvas could not encode the image')
  return new Uint8Array(await blob.arrayBuffer())
}

/** PNG and JPEG go to the worker as they are; anything else is decoded here first, where there is a canvas. */
async function embeddable(file: File): Promise<Uint8Array> {
  const bytes = await readBytes(file)
  if (imageKind(bytes) !== 'other') return bytes
  try {
    return await toPng(bytes)
  } catch {
    throw new PdfInputError(`${file.name} could not be read as an image.`)
  }
}

export function ImageToPdf() {
  const [files, setFiles] = useState<File[]>([])
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<Uint8Array | null>(null)
  const [error, setError] = useState('')

  async function handleConvert() {
    if (files.length === 0) return
    setProcessing(true)
    setResult(null)
    setError('')

    try {
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await embeddable(f) })))
      setResult(await runPdfJob('image-to-pdf', { inputs }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  // a new set or order of files makes the last result stale
  function changeFiles(next: File[]) {
    setFiles(next)
    setResult(null)
  }

  return (
    <div>
      <SubtoolHeader icon="photo_library" color="#059669" title="Image to PDF" description="One page per image, in the order listed — drag to rearrange" />

      <FileDropzone files={files} onFilesChange={changeFiles} accept={IMAGE_ACCEPT} label="Drop images here" description="PNG, JPG, or WebP" />
      <SortableFileList files={files} onFilesChange={changeFiles} />

      <button className="pdf-action-btn" disabled={files.length === 0 || processing} onClick={handleConvert}>
        <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
        {processing ? 'Converting...' : `Convert ${files.length} image${files.length !== 1 ? 's' : ''} to PDF`}
      </button>

      <ErrorText message={error} />

      {result && (
        <ProcessedPdfActions fileName="images.pdf" outputBytes={result} />
      )}
    </div>
  )
}
