import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { formatSize } from '../lib/utils'

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
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (multiple) {
        onFilesChange([...files, ...acceptedFiles].slice(0, maxFiles))
      } else {
        onFilesChange(acceptedFiles.slice(0, 1))
      }
    },
    [files, onFilesChange, multiple, maxFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: multiple ? maxFiles - files.length : 1,
    maxSize,
    multiple,
  })

  return (
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
