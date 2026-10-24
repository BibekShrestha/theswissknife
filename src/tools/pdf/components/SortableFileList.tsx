import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatSize } from '../lib/utils'
import { Sortable } from './Sortable'

/** A stable id per File object: names repeat, and the same name can be dropped twice. */
const ids = new WeakMap<File, string>()
let nextId = 1
const idOf = (file: File) => {
  let id = ids.get(file)
  if (!id) ids.set(file, (id = `f${nextId++}`))
  return id
}

/** The image itself, small, for Image to PDF's list; a document icon otherwise. */
function FileThumb({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  const image = file.type.startsWith('image/')
  useEffect(() => {
    if (!image) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, image])
  return (
    <div className="pdf-file-icon">
      {image && url ? <img src={url} alt="" /> : <span className="material-symbols-outlined" aria-hidden="true">description</span>}
    </div>
  )
}

interface RowProps {
  file: File
  index: number
  count: number
  onMove: (to: number) => void
  onRemove: () => void
}

function Row({ file, index, count, onMove, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: idOf(file) })
  return (
    <li
      ref={setNodeRef}
      className={`pdf-file-row pdf-file-row-sortable${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
    >
      <button type="button" className="pdf-file-handle" ref={setActivatorNodeRef} {...attributes} aria-label={`Move ${file.name}, file ${index + 1} of ${count}`}>
        <span className="material-symbols-outlined" aria-hidden="true">drag_indicator</span>
      </button>
      <span className="pdf-file-order" aria-hidden="true">{index + 1}</span>
      <FileThumb file={file} />
      <span className="pdf-file-name">{file.name}</span>
      <span className="pdf-file-size">{formatSize(file.size)}</span>
      <button type="button" className="pdf-file-remove" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${file.name} up`}>
        <span className="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
      </button>
      <button type="button" className="pdf-file-remove" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${file.name} down`}>
        <span className="material-symbols-outlined" aria-hidden="true">arrow_downward</span>
      </button>
      <button type="button" className="pdf-file-remove" onClick={onRemove} aria-label={`Remove ${file.name}`}>
        <span className="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </li>
  )
}

/** The chosen files in the order they will be used; drag a row (or its handle, or the arrows) to change it. */
export function SortableFileList({ files, onFilesChange }: { files: File[]; onFilesChange: (files: File[]) => void }) {
  if (files.length === 0) return null
  const move = (from: number, to: number) => {
    const next = [...files]
    next.splice(to, 0, ...next.splice(from, 1))
    onFilesChange(next)
  }
  return (
    <div className="pdf-file-list">
      <p className="pdf-file-list-title">
        {files.length} file{files.length !== 1 ? 's' : ''}{files.length > 1 && ', in this order — drag to change it'}
      </p>
      <Sortable items={files} idOf={idOf} nameOf={(f) => f.name} onReorder={onFilesChange}>
        <ol className="pdf-file-list-inner">
          {files.map((file, i) => (
            <Row
              key={idOf(file)}
              file={file}
              index={i}
              count={files.length}
              onMove={(to) => move(i, to)}
              onRemove={() => onFilesChange(files.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      </Sortable>
    </div>
  )
}
