import { useState } from 'react'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { describeError, readBytes } from '../lib/load'
import { imagesToPdf } from '../ops/images'
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
      const inputs = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await readBytes(f) })))
      setResult(await imagesToPdf(inputs, toPng))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div>
      <SubtoolHeader icon="photo_library" color="#059669" title="Image to PDF" description="Convert images to a PDF document, one page per image" />

      <FileDropzone files={files} onFilesChange={setFiles} accept={IMAGE_ACCEPT} label="Drop images here" description="PNG, JPG, or WebP" />
      <FileList files={files} onFilesChange={setFiles} />

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
