import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { Toast } from '../../shell/Toast'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { formatBytes } from './lib/bytes'
import type { Block, Processed, Row, StripOptions } from './lib/types'
import { createExifRunner, type ExifRunner } from './runner'
import './exif.css'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.avif'
const MAX_BYTES = 256 * 1024 * 1024
const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }

interface Item {
  id: number
  file: File
  name: string
  url: string
  status: 'working' | 'done' | 'error'
  result?: Processed
  error?: string
  noPreview?: boolean
  /** Bumped per run so a stale result (options changed meanwhile) is dropped. */
  run: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function cleanName(item: Item): string {
  const dot = item.name.lastIndexOf('.')
  const stem = dot > 0 ? item.name.slice(0, dot) : item.name || 'image'
  const ext = dot > 0 ? item.name.slice(dot + 1) : item.result ? EXT[item.result.before.format] ?? (item.result.before.mime === 'image/avif' ? 'avif' : 'heic') : 'img'
  return `${stem}-clean.${ext}`
}

function save(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const isClean = (r: Processed) => r.remaining.length === 0 && r.identical

export default function ExifTool() {
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const runnerRef = useRef<ExifRunner | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const nextId = useRef(0)
  const [items, setItems] = useState<Item[]>([])
  const itemsRef = useRef<Item[]>([])
  itemsRef.current = items
  const [options, setOptions] = useState<StripOptions>({ keepOrientation: true, keepIcc: true })
  const optionsRef = useRef(options)
  const [dragging, setDragging] = useState(false)
  const [zipping, setZipping] = useState(false)

  useEffect(() => {
    const runner = createExifRunner(() => new Worker(new URL('./exif.worker.ts', import.meta.url), { type: 'module' }))
    runnerRef.current = runner
    return () => {
      runnerRef.current = null
      runner.dispose()
    }
  }, [])

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.url)
    },
    [],
  )

  const update = (id: number, run: number, patch: Partial<Item>) =>
    setItems((list) => list.map((item) => (item.id === id && item.run === run ? { ...item, ...patch } : item)))

  const runItem = useCallback(async (id: number, file: File, run: number, opts: StripOptions) => {
    const runner = runnerRef.current
    if (!runner) return
    try {
      // Read here, parsed in a worker in this tab — the bytes never leave the machine.
      const bytes = new Uint8Array(await file.arrayBuffer())
      const result = await runner.process(bytes, opts)
      update(id, run, { status: 'done', result, error: undefined })
    } catch (error) {
      update(id, run, { status: 'error', error: error instanceof Error ? error.message : String(error), result: undefined })
    }
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      const fresh: Item[] = []
      for (const file of files) {
        const id = ++nextId.current
        const base = { id, file, name: file.name || 'Pasted image', url: URL.createObjectURL(file), run: 1 }
        if (file.size > MAX_BYTES) fresh.push({ ...base, status: 'error', error: `${formatBytes(file.size)} is over the ${formatBytes(MAX_BYTES)} limit for one file.` })
        else fresh.push({ ...base, status: 'working' })
      }
      if (!fresh.length) return
      setItems((list) => [...list, ...fresh])
      for (const item of fresh) if (item.status === 'working') void runItem(item.id, item.file, item.run, optionsRef.current)
    },
    [runItem],
  )

  const changeOptions = (patch: Partial<StripOptions>) => {
    const next = { ...optionsRef.current, ...patch }
    optionsRef.current = next
    setOptions(next)
    const rerun = itemsRef.current.filter((item) => item.file.size <= MAX_BYTES).map((item) => ({ ...item, run: item.run + 1, status: 'working' as const }))
    const byId = new Map(rerun.map((item) => [item.id, item]))
    setItems((list) => list.map((item) => byId.get(item.id) ?? item))
    for (const item of rerun) void runItem(item.id, item.file, item.run, next)
  }

  const remove = (id: number) =>
    setItems((list) => {
      const gone = list.find((item) => item.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return list.filter((item) => item.id !== id)
    })

  const clear = () => {
    for (const item of items) URL.revokeObjectURL(item.url)
    setItems([])
  }

  // ⌘V / Ctrl+V anywhere outside a field.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!event.clipboardData || target?.closest('input, textarea, [contenteditable]')) return
      const files = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      addFiles(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addFiles])

  const pasteButton = async () => {
    try {
      const files: File[] = []
      for (const entry of await navigator.clipboard.read()) {
        const type = entry.types.find((t) => t.startsWith('image/'))
        if (type) files.push(new File([await entry.getType(type)], 'Pasted image', { type }))
      }
      if (files.length) addFiles(files)
      else showToast('No image on the clipboard')
    } catch {
      showToast('Clipboard not readable here — press ⌘V / Ctrl+V instead')
    }
  }

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles([...(event.target.files ?? [])])
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles([...event.dataTransfer.files])
  }

  const download = (item: Item) => {
    const r = item.result
    if (!r) return
    const name = cleanName(item)
    save(r.bytes, name, r.after.mime)
    showToast(`Saved ${name} · ${formatBytes(r.bytes.length)}`)
  }

  const ready = items.filter((item) => item.result && isClean(item.result))

  const downloadZip = async () => {
    if (!ready.length || zipping) return
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const used = new Set<string>()
      for (const item of ready) {
        let name = cleanName(item)
        for (let n = 2; used.has(name); n++) name = cleanName(item).replace(/(\.[^.]+)$/, `-${n}$1`)
        used.add(name)
        // Images are already compressed; STORE keeps the zip fast and the files identical.
        zip.file(name, item.result!.bytes, { compression: 'STORE' })
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      save(blob, 'clean-photos.zip', 'application/zip')
      const skipped = items.length - ready.length
      showToast(`Saved clean-photos.zip · ${plural(ready.length, 'file')}${skipped ? ` (${skipped} not ready or not clean, left out)` : ''}`)
    } catch (error) {
      showToast(`Zip failed — ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setZipping(false)
    }
  }

  const many = items.length > 1

  return (
    <div
      className={`exif-app${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={onDrop}
    >
      <ToolHeader brand={<><span className="tool-mark-accent">EXIF</span> Photo metadata</>} localLabel="local files">
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />
        <button type="button" onClick={() => fileInput.current?.click()} title="Open photos">
          <span className="material-symbols-outlined" aria-hidden>folder_open</span>
          <span className="exif-btn-label">Open</span>
        </button>
        <button type="button" onClick={() => void pasteButton()} title="Paste an image from the clipboard">
          <span className="material-symbols-outlined" aria-hidden>content_paste</span>
          <span className="exif-btn-label">Paste</span>
        </button>
        {many && (
          <button type="button" className="exif-primary" onClick={() => void downloadZip()} disabled={!ready.length || zipping} title="Download every clean copy as one .zip">
            <span className="material-symbols-outlined" aria-hidden>folder_zip</span>
            <span className="exif-btn-label">{zipping ? 'Zipping…' : `Download ${ready.length} (.zip)`}</span>
          </button>
        )}
        {items.length > 0 && (
          <button type="button" onClick={clear} aria-label="Remove all photos" title="Remove all photos">
            <span className="material-symbols-outlined" aria-hidden>delete</span>
          </button>
        )}
      </ToolHeader>

      <div className="exif-options" role="group" aria-label="Strip options">
        <label>
          <input type="checkbox" checked={options.keepOrientation} onChange={(e) => changeOptions({ keepOrientation: e.target.checked })} />
          Keep orientation
          <span className="exif-hint">rotated photos get a new EXIF holding only the Orientation tag, so they stay upright</span>
        </label>
        <label>
          <input type="checkbox" checked={options.keepIcc} onChange={(e) => changeOptions({ keepIcc: e.target.checked })} />
          Keep colour profile
          <span className="exif-hint">a profile describes colour, but its text can name the device, maker or software that made it — check it under All metadata; dropping one can shift colours</span>
        </label>
      </div>

      <main id="main-content" className="exif-main">
        {items.length === 0 ? (
          <div className="exif-drop">
            <span className="material-symbols-outlined exif-drop-icon" aria-hidden>add_photo_alternate</span>
            <h2>See and strip photo metadata</h2>
            <p>
              Drop, open or paste JPEG, PNG, WebP, GIF, HEIC or AVIF files — as many as you like. Every metadata block is listed: EXIF (with GPS and the
              thumbnail), XMP, IPTC, ICC, MPF and comments.
            </p>
            <p>
              Stripping rewrites the file’s container keeping only what is needed to display the image — so C2PA credentials, unknown chunks and segments
              and stray bytes go too — and copies the image data byte for byte; nothing is re-encoded. Each output is parsed again to prove
              what is left. Files are read in this tab and never uploaded.
            </p>
            <button type="button" className="exif-primary" onClick={() => fileInput.current?.click()}>
              Choose photos
            </button>
          </div>
        ) : (
          items.map((item) => <Card key={item.id} item={item} primary={!many} options={options} onRemove={() => remove(item.id)} onDownload={() => download(item)} onNoPreview={() => setItems((list) => list.map((x) => (x.id === item.id ? { ...x, noPreview: true } : x)))} copy={copy} />)
        )}
      </main>

      {dragging && <div className="exif-dropveil">Drop photos to read their metadata</div>}
      <Toast message={toast} />
    </div>
  )
}

interface CardProps {
  item: Item
  primary: boolean
  options: StripOptions
  onRemove: () => void
  onDownload: () => void
  onNoPreview: () => void
  copy: (text: string, what: string) => Promise<void>
}

function Card({ item, primary, options, onRemove, onDownload, onNoPreview, copy }: CardProps) {
  const r = item.result
  const before = r?.before
  const keptCount = r ? r.after.blocks.filter((b) => !b.empty).length - r.remaining.length : 0
  const rotated = before?.orientation !== undefined && before.orientation !== 1 && before.format !== 'heif'
  return (
    <article className="exif-card" aria-busy={item.status === 'working'}>
      <header className="exif-card-head">
        <h2 title={item.name}>{item.name}</h2>
        <span className="exif-meta">
          {before ? `${before.formatLabel}${before.width ? ` · ${before.width}×${before.height}` : ''} · ` : ''}
          {formatBytes(item.file.size)}
        </span>
        <button type="button" className="exif-icon-btn" onClick={onRemove} aria-label={`Remove ${item.name}`} title="Remove">
          <span className="material-symbols-outlined" aria-hidden>close</span>
        </button>
      </header>

      {item.status === 'error' && (
        <p className="exif-error" role="alert">
          <span className="material-symbols-outlined" aria-hidden>error</span>
          {item.error}
        </p>
      )}

      <div className="exif-card-body">
        <figure className="exif-preview">
          {item.noPreview || item.status === 'error' ? (
            <figcaption>
              {before?.format === 'heif'
                ? `This browser can’t display ${before.formatLabel} — metadata is read and stripped all the same.`
                : 'No preview'}
            </figcaption>
          ) : (
            <img src={item.url} alt={`Preview of ${item.name}`} onError={onNoPreview} />
          )}
        </figure>

        <div className="exif-facts">
          {item.status === 'working' && !r && <p className="exif-muted">Reading…</p>}
          {before && (
            <>
              {before.gps && (
                <div className="exif-gps">
                  <span className="material-symbols-outlined" aria-hidden>location_on</span>
                  <span>
                    This photo says where it was taken: <strong>{before.gps.lat.toFixed(6)}, {before.gps.lon.toFixed(6)}</strong>
                  </span>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${before.gps.lat.toFixed(6)}&mlon=${before.gps.lon.toFixed(6)}#map=16/${before.gps.lat.toFixed(6)}/${before.gps.lon.toFixed(6)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Opens openstreetmap.org in a new tab — that sends these coordinates to OpenStreetMap"
                  >
                    Open in maps
                    <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                  </a>
                  <button type="button" onClick={() => void copy(`${before.gps!.lat.toFixed(6)}, ${before.gps!.lon.toFixed(6)}`, 'Coordinates')}>
                    <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                    Copy
                  </button>
                </div>
              )}
              {before.summary.length ? (
                <dl className="exif-summary">
                  {before.summary.map((row) => (
                    <div key={row.key} className={row.sensitive ? 'is-sensitive' : undefined}>
                      <dt>{row.key}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="exif-muted">No camera, date, place or author details in this file.</p>
              )}
            </>
          )}
        </div>
      </div>

      {r && (
        <section className="exif-result" aria-label="Stripped copy">
          <div className="exif-proof">
            <span className={`exif-badge ${isClean(r) ? 'is-ok' : 'is-bad'}`}>
              <span className="material-symbols-outlined" aria-hidden>{isClean(r) ? 'check_circle' : 'warning'}</span>
              {plural(r.before.blocks.length, 'block')} found → {r.remaining.length} remain
            </span>
            {keptCount > 0 && <span className="exif-meta">{keptCount} kept on purpose</span>}
            <span className="exif-meta">
              {formatBytes(r.before.size)} → {formatBytes(r.bytes.length)}
            </span>
            <button type="button" className={primary ? 'exif-primary' : undefined} onClick={onDownload} disabled={!isClean(r)} title={isClean(r) ? 'Download the stripped copy' : 'Not offered: the re-parse did not come back clean'}>
              <span className="material-symbols-outlined" aria-hidden>download</span>
              Download clean copy
            </button>
          </div>
          <p className={r.identical ? 'exif-check' : 'exif-error'}>
            {r.identical
              ? `Image data byte-identical — SHA-256 ${r.after.imageDigest.slice(0, 16)}… over ${formatBytes(r.after.imageBytes)}, before and after.`
              : 'Image data changed during the strip — the copy is not offered. Please report this file’s format.'}
          </p>
          {r.remaining.length > 0 && (
            <p className="exif-error" role="alert">
              Still in the output: {r.remaining.map((b) => `${b.label} (${b.where})${b.unremovable ? ` — could not be removed: ${b.unremovable}` : ''}`).join('; ')}
            </p>
          )}
          {r.removed.length > 0 && (
            <p className="exif-list">
              <span className="exif-label">Removed</span>
              {r.removed.join(' · ')}
            </p>
          )}
          {r.kept.length > 0 && (
            <p className="exif-list">
              <span className="exif-label">Kept</span>
              {r.kept.join(' · ')}
            </p>
          )}
          {rotated && !options.keepOrientation && (
            <p className="exif-warn">
              This photo is stored rotated (Orientation {before!.orientation}). Without that tag it will display turned — tick Keep orientation to keep it upright.
            </p>
          )}
          {before?.format === 'heif' && (
            <p className="exif-list">
              <span className="exif-label">HEIF/AVIF</span>
              Exif and XMP items are overwritten with zeros in place, so the file keeps its size and every offset stays valid. The emptied item entries remain. An item whose data cannot be located is reported as still there, and the copy is not offered.
            </p>
          )}
        </section>
      )}

      {before && before.blocks.length > 0 && (
        <details className="exif-details">
          <summary>All metadata ({plural(before.blocks.length, 'block')})</summary>
          {before.blocks.map((block, i) => (
            <BlockView key={i} block={block} level={3} />
          ))}
        </details>
      )}
      {before && before.warnings.length > 0 && (
        <details className="exif-details">
          <summary>Structure warnings ({before.warnings.length})</summary>
          <ul className="exif-warnings">
            {before.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <tbody>
      {rows.map((row, i) => (
        <tr key={i} className={row.sensitive ? 'is-sensitive' : undefined}>
          <th scope="row">{row.key}</th>
          <td>
            {row.value}
            {row.sensitive && <span className="exif-flag">identifying</span>}
          </td>
        </tr>
      ))}
    </tbody>
  )
}

function BlockView({ block, level }: { block: Block; level: 3 | 4 }) {
  const Heading = level === 3 ? 'h3' : 'h4'
  return (
    <section className={`exif-block${level === 4 ? ' is-nested' : ''}`}>
      <Heading>
        {block.label}
        <span className="exif-meta">
          {block.where} · {formatBytes(block.size)}
        </span>
      </Heading>
      {block.note && <p className="exif-muted">{block.note}</p>}
      {block.sections.map((section, i) =>
        section.rows.length ? (
          <table key={i} className="exif-table">
            <caption>{section.title}</caption>
            <Rows rows={section.rows} />
          </table>
        ) : null,
      )}
      {block.nested?.map((inner, i) => (
        <BlockView key={i} block={inner} level={4} />
      ))}
    </section>
  )
}
