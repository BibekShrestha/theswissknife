import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { formatSize } from '../lib/utils'
import { ErrorText } from './ErrorText'

interface FileDropzoneProps {
  files: File[]
  onFilesChange: (files: File[]) => void
  accept?: Record<string, string[]>
  maxFiles?: number
  maxSize?: number
  multiple?: boolean
  label?: string
  description?: string
}

export function FileDropzone({
  files,
  onFilesChange,
  accept = { 'application/pdf': ['.pdf'] },
  maxFiles = 10,
  maxSize = 50 * 1024 * 1024,
  multiple = true,
  label = 'Drop PDF files here',
  description = 'or click to browse',
}: FileDropzoneProps) {
  const [notice, setNotice] = useState('')
  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: FileRejection[]) => {
      // react-dropzone drops refused files without a word; say why instead
      const notes = rejections.map(({ file, errors }) => `${file.name}: ${errors[0]?.code === 'file-too-large' ? `larger than ${formatSize(maxSize)}` : errors[0]?.code === 'file-invalid-type' ? 'not a supported file type' : 'only one file at a time'}`)
      let next = multiple ? [...files, ...acceptedFiles] : acceptedFiles.slice(0, 1)
      if (next.length > maxFiles) {
        notes.push(`only ${maxFiles} files at a time — ${next.length - maxFiles} not added`)
        next = next.slice(0, maxFiles)
      }
      setNotice(notes.join(' · '))
      if (acceptedFiles.length > 0) onFilesChange(next)
    },
    [files, onFilesChange, multiple, maxFiles, maxSize],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple,
  })

  return (
    <>
    <div className="pdf-dropzone" {...getRootProps()} data-active={isDragActive ? '' : undefined}>
      <input {...getInputProps()} />
      <div className="pdf-dropzone-icon">
        <span className="material-symbols-outlined">upload_file</span>
      </div>
      <p className="pdf-dropzone-label">
        {files.length > 0 ? 'Add more files' : label}
      </p>
      {files.length === 0 && <p className="pdf-dropzone-desc">{description}</p>}
      <p className="pdf-dropzone-hint">
        Max {formatSize(maxSize)} per file{multiple ? `, up to ${maxFiles} files` : ''}
      </p>
    </div>
    <ErrorText message={notice} />
    </>
  )
}

export function FileList({ files, onFilesChange }: { files: File[]; onFilesChange: (files: File[]) => void }) {
  if (files.length === 0) return null

  return (
    <div className="pdf-file-list">
      <p className="pdf-file-list-title">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
      <div className="pdf-file-list-inner">
        {files.map((file, index) => (
          <div className="pdf-file-row" key={`${file.name}-${index}`}>
            <div className="pdf-file-icon">
              <span className="material-symbols-outlined">description</span>
            </div>
            <span className="pdf-file-name">{file.name}</span>
            <span className="pdf-file-size">{formatSize(file.size)}</span>
            <button className="pdf-file-remove" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index))
  }
}
