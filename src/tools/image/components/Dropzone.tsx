import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { formatBytes } from '../lib/naming'
import { MAX_FILES, MAX_FILE_BYTES } from '../useImagePipeline'

interface DropzoneProps {
  count: number
  disabled: boolean
  onFiles: (files: File[]) => void
}

/**
 * No `accept` filter: react-dropzone would silently discard anything whose
 * name or MIME type it does not like (HEIC, TIFF, a file with no extension).
 * Every file goes to the queue, where sniffing its bytes decides — a
 * mislabelled .jpg still works, and an unreadable file gets a row saying why.
 */
export function Dropzone({ count, disabled, onFiles }: DropzoneProps) {
  const onDrop = useCallback((accepted: File[]) => onFiles(accepted), [onFiles])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    multiple: true,
  })

  const room = MAX_FILES - count

  return (
    <div
      className="image-dropzone"
      data-active={isDragActive ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      {...getRootProps()}
    >
      <input {...getInputProps()} />
      <span className="material-symbols-outlined image-dropzone-icon" aria-hidden>
        add_photo_alternate
      </span>
      <p className="image-dropzone-label">
        {count > 0 ? 'Add more images' : 'Drop images here'}
      </p>
      <p className="image-dropzone-desc">
        or click to browse — PNG, JPEG, WebP, GIF, SVG, BMP, AVIF
      </p>
      <p className="image-dropzone-hint">
        Up to {formatBytes(MAX_FILE_BYTES)} each, {room > 0 ? `${room} more` : 'queue full'}. Nothing
        is uploaded: every pixel stays in this tab.
      </p>
    </div>
  )
}
