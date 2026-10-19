import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { FileDropzone, FileList } from '../components/FileDropzone'
import { ProcessedPdfActions } from '../components/ProcessedPdfActions'
import { ErrorText } from '../components/ErrorText'
import { SubtoolHeader } from '../components/SubtoolHeader'
import { describeError, XFA_ONLY_MESSAGE } from '../lib/errors'
import { readBytes } from '../lib/files'
import { getPdfJs } from '../lib/pdfjs'
import { encodingProblem } from '../lib/winansi'
import { openPdf } from '../ops/read'
import { runPdfJob } from '../runner'
import type { FieldValue, FillSignResult, FormReport, WidgetInfo } from '../ops/form'
import { FieldList, controlId } from '../fillsign/FieldList'
import { blockingProblems, changedValues, dateStamp, emptyRequired, fillable, initialValues, itemName, textBoxSize, toStamps, type ItemKind, type Placed } from '../fillsign/model'
import { carryTo, clampBox, fitSize, resizeBox, type Box, type Size } from '../fillsign/pad'
import { PageView } from '../fillsign/PageView'
import { SignatureDialog } from '../fillsign/SignatureDialog'
import type { SignatureImage } from '../fillsign/raster'
import '../fillsign/fillsign.css'

interface Loaded {
  bytes: Uint8Array
  name: string
  report: FormReport
  doc: PDFDocumentProxy
  close: () => Promise<void>
}

const SIGNATURE_WIDTH = 160
const SIGNATURE_MAX_HEIGHT = 64
const CHECK_SIZE = 18
const TEXT_SIZE = 12

export function FillSign() {
  const [files, setFiles] = useState<File[]>([])
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [page, setPage] = useState(0)
  const [activeField, setActiveField] = useState<number | null>(null)
  const views = useRef(new Map<number, Size>())
  const [signatures, setSignatures] = useState<SignatureImage[]>([])
  const [items, setItems] = useState<Placed[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [placing, setPlacing] = useState<number | null>(null)
  const [dialog, setDialog] = useState(false)
  const nextId = useRef(1)
  const [flatten, setFlatten] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<FillSignResult | null>(null)
  const [error, setError] = useState('')
  const addSignatureButton = useRef<HTMLButtonElement>(null)

  const fields = loaded?.report.fields ?? []
  const initial = useMemo(() => initialValues(fields), [fields])

  // signatures live in this component's memory only; their preview URLs go with it
  const sigRef = useRef(signatures)
  sigRef.current = signatures
  useEffect(() => () => sigRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  function chooseFiles(next: File[]) {
    // the load effect's cleanup closes the pdf.js document of the file being replaced
    setFiles(next)
    setLoaded(null)
    setLoadError('')
    setValues({})
    setPage(0)
    setActiveField(null)
    setItems([])
    setSelected(null)
    setPlacing(null)
    setResult(null)
    setError('')
    views.current.clear()
  }

  useEffect(() => {
    const file = files[0]
    if (!file) return
    let cancelled = false
    let opened: { doc: PDFDocumentProxy; close: () => Promise<void> } | null = null
    setLoading(true)
    ;(async () => {
      try {
        const bytes = await readBytes(file)
        // pdf-lib reads the form (and refuses encrypted files) before pdf.js draws anything
        const report = await runPdfJob('read-form', { bytes: bytes.slice() })
        if (cancelled) return
        if (report.xfa === 'only') {
          setLoadError(XFA_ONLY_MESSAGE)
          return
        }
        opened = await openPdf(await getPdfJs(), bytes)
        if (cancelled) return
        setValues(initialValues(report.fields))
        setLoaded({ bytes, name: file.name, report, ...opened })
      } catch (e) {
        if (!cancelled) setLoadError(describeError(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (opened) void opened.close()
    }
  }, [files])

  // any edit makes the last output stale
  useEffect(() => setResult(null), [values, items, flatten])

  const viewOf = async (p: number): Promise<Size> => {
    const known = views.current.get(p)
    if (known) return known
    const vp = (await loaded!.doc.getPage(p + 1)).getViewport({ scale: 1 })
    const size = { width: vp.width, height: vp.height }
    views.current.set(p, size)
    return size
  }

  const focusItem = (id: number) => requestAnimationFrame(() => document.getElementById(`pdf-fs-item-${id}`)?.focus())

  async function addItem(kind: ItemKind, sig?: number, list = signatures) {
    if (!loaded) return
    const view = await viewOf(page)
    let size: Size
    let extra: Partial<Placed> = {}
    if (kind === 'signature') {
      const image = list[sig!]
      size = fitSize(image.width, image.height, Math.min(SIGNATURE_WIDTH, view.width * 0.5), SIGNATURE_MAX_HEIGHT)
      // never upscale past the target width either: small images are enlarged to it
      if (size.width < SIGNATURE_WIDTH && size.height < SIGNATURE_MAX_HEIGHT) {
        const k = Math.min(SIGNATURE_WIDTH / image.width, SIGNATURE_MAX_HEIGHT / image.height)
        size = { width: image.width * k, height: image.height * k }
      }
      extra = { sig }
    } else if (kind === 'check') {
      size = { width: CHECK_SIZE, height: CHECK_SIZE }
    } else {
      const text = kind === 'date' ? dateStamp(new Date()) : 'Text'
      size = textBoxSize(text, TEXT_SIZE)
      extra = { text, fontSize: TEXT_SIZE }
    }
    const id = nextId.current++
    const box = clampBox({ x: (view.width - size.width) / 2, y: (view.height - size.height) / 2, ...size }, view)
    setItems((all) => [...all, { id, kind, page, view, ...box, ...extra }])
    setSelected(id)
    setPlacing(id)
    focusItem(id)
  }

  function changeItem(id: number, box: Box) {
    setItems((all) =>
      all.map((i) => {
        if (i.id !== id) return i
        // a text box grows by its font size
        const fontSize = i.fontSize !== undefined && box.height !== i.height ? (i.fontSize * box.height) / i.height : i.fontSize
        return { ...i, ...box, fontSize }
      }),
    )
  }

  function removeItem(id: number) {
    const gone = items.find((i) => i.id === id)
    const rest = items.filter((i) => i.id !== id)
    setItems(rest)
    if (selected === id) setSelected(null)
    if (placing === id) setPlacing(null)
    // focus goes to the next item on the page, or back to the toolbar
    const next = rest.find((i) => i.page === gone?.page)
    if (next) focusItem(next.id)
    else requestAnimationFrame(() => addSignatureButton.current?.focus())
  }

  function setText(id: number, text: string, fontSize?: number) {
    setItems((all) =>
      all.map((i) => {
        if (i.id !== id) return i
        const size = fontSize ?? i.fontSize ?? TEXT_SIZE
        return { ...i, text, fontSize: size, ...clampBox({ x: i.x, y: i.y, ...textBoxSize(text, size) }, i.view) }
      }),
    )
  }

  async function moveToPage(id: number, target: number) {
    const item = items.find((i) => i.id === id)
    if (!item || target === item.page) return
    const to = await viewOf(target)
    setItems((all) => all.map((i) => (i.id === id ? { ...i, page: target, view: to, ...carryTo(i, i.view, to) } : i)))
    setPage(target)
    focusItem(id)
  }

  function forgetSignature(index: number) {
    URL.revokeObjectURL(signatures[index].url)
    // keep indices stable for placed items: the slot is emptied, and items using it go
    setItems((all) => all.filter((i) => i.sig !== index))
    setSignatures((all) => all.map((s, i) => (i === index ? { ...s, png: new Uint8Array(0), url: '' } : s)))
  }

  function activateField(index: number) {
    setActiveField(index)
    const first = fields[index]?.widgets[0]
    if (first && first.page !== page) setPage(first.page)
  }

  function fieldPointer(index: number, widget: WidgetInfo) {
    const field = fields[index]
    let target = controlId(index)
    if (fillable(field) && field.kind === 'checkbox') setValues((v) => ({ ...v, [field.name]: v[field.name] !== true }))
    if (field.kind === 'radio' && widget.option !== undefined) {
      if (fillable(field)) setValues((v) => ({ ...v, [field.name]: widget.option! }))
      target = controlId(index, Math.max(0, (field.options ?? []).indexOf(widget.option)))
    }
    setActiveField(index)
    const el = document.getElementById(target)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  async function create() {
    if (!loaded) return
    setError('')
    const problem = blockingProblems(fields, values, items)
    if (problem) return setError(problem)
    const changed = changedValues(fields, values, initial)
    const { stamps, images } = toStamps(items, signatures.map((s) => s.png))
    if (!flatten && stamps.length === 0 && Object.keys(changed).length === 0) {
      return setError('Nothing to write yet: fill in a field, place something on a page, or tick Flatten.')
    }
    setProcessing(true)
    try {
      setResult(await runPdfJob('fill-sign', { bytes: loaded.bytes.slice(), options: { values: changed, flatten, stamps, images } }))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setProcessing(false)
    }
  }

  const report = loaded?.report
  const current = items.find((i) => i.id === selected) ?? null
  const missing = emptyRequired(fields, values)
  const liveSignatures = signatures.map((s, i) => ({ s, i })).filter(({ s }) => s.url)
  const outName = loaded ? `${loaded.name.replace(/\.pdf$/i, '')}-${flatten ? 'flattened' : 'filled'}.pdf` : 'filled.pdf'

  return (
    <div className="pdf-fs">
      <SubtoolHeader icon="signature" color="#7c3aed" title="Fill & Sign" description="Fill in PDF forms, and place a signature, text, a date or a checkmark on any page" />

      <FileDropzone files={files} onFilesChange={chooseFiles} maxFiles={1} multiple={false} />
      <FileList files={files} onFilesChange={chooseFiles} />
      <p className="pdf-form-hint pdf-fs-intro">
        Password-protected PDFs — including ones that only restrict editing — are refused; remove the protection with Unlock PDF first. XFA-only forms can’t be filled.
      </p>

      {loading && <p className="tool-loading" role="status">Reading the form…</p>}
      <ErrorText message={loadError} />

      {loaded && report && (
        <>
          {(report.fields.length === 0 || report.xfa === 'hybrid' || report.signed > 0) && (
            <ul className="pdf-notes pdf-fs-notes">
              {report.fields.length === 0 && <li>This PDF has no form fields. You can still place a signature, text, a date or a checkmark.</li>}
              {report.xfa === 'hybrid' && <li>This form also carries an XFA copy (used by Adobe Acrobat). Its standard form fields are filled here, and the XFA copy is removed from the output so Acrobat can’t show stale values.</li>}
              {report.signed > 0 && <li>This PDF holds {report.signed} digital signature{report.signed === 1 ? '' : 's'}. Any change, including this one, invalidates {report.signed === 1 ? 'it' : 'them'}.</li>}
            </ul>
          )}

          <div className="pdf-fs-workspace">
            <PageView
              doc={loaded.doc}
              page={page}
              pageCount={loaded.doc.numPages}
              onPage={(p) => {
                setPage(p)
                setPlacing(null)
              }}
              fields={fields}
              values={values}
              activeField={activeField}
              items={items}
              signatures={signatures}
              selected={selected}
              placing={placing}
              onView={(p, size) => views.current.set(p, size)}
              onFieldPointer={fieldPointer}
              onSelect={setSelected}
              onChange={changeItem}
              onPlaced={(id, box) => {
                changeItem(id, box)
                setPlacing(null)
              }}
              onRemove={removeItem}
            />

            <div className="pdf-fs-side">
              <section className="pdf-fs-card" aria-labelledby="pdf-fs-sign-title">
                <h3 className="pdf-fs-card-title" id="pdf-fs-sign-title">Sign &amp; annotate</h3>
                <p className="pdf-fs-disclaimer">
                  <strong>Visual signature only.</strong> This stamps a picture of your signature into the page. It is not a cryptographic digital signature — no certificate, no PAdES — so it does not prove who signed or that the file was not changed afterwards.
                </p>
                <div className="pdf-fs-tools">
                  <button type="button" className="pdf-fs-btn" ref={addSignatureButton} onClick={() => setDialog(true)}>
                    <span className="material-symbols-outlined" aria-hidden="true">signature</span> Signature
                  </button>
                  <button type="button" className="pdf-fs-btn" onClick={() => addItem('text')}>
                    <span className="material-symbols-outlined" aria-hidden="true">title</span> Text
                  </button>
                  <button type="button" className="pdf-fs-btn" onClick={() => addItem('date')}>
                    <span className="material-symbols-outlined" aria-hidden="true">calendar_today</span> Date
                  </button>
                  <button type="button" className="pdf-fs-btn" onClick={() => addItem('check')}>
                    <span className="material-symbols-outlined" aria-hidden="true">check</span> Checkmark
                  </button>
                </div>
                <p className="pdf-form-hint">New items appear on the page shown. Drag them, or select one and use the arrow keys (Shift for 10 pt), + and − to resize, Delete to remove.</p>
                {liveSignatures.length > 0 && (
                  <ul className="pdf-fs-sigs" aria-label="Signatures made in this session">
                    {liveSignatures.map(({ s, i }) => (
                      <li key={i} className="pdf-fs-sig">
                        <img src={s.url} alt={s.label} />
                        <button type="button" className="pdf-fs-btn" onClick={() => addItem('signature', i)}>Place again</button>
                        <button type="button" className="pdf-fs-btn" onClick={() => forgetSignature(i)} aria-label={`Forget ${s.label.toLowerCase()} ${i + 1}`}>Forget</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {current && (
                <section className="pdf-fs-card" aria-labelledby="pdf-fs-selected-title">
                  <h3 className="pdf-fs-card-title" id="pdf-fs-selected-title">Selected: {itemName(current, current.sig !== undefined ? signatures[current.sig]?.label : undefined)}</h3>
                  {(current.kind === 'text' || current.kind === 'date') && (
                    <>
                      <label className="pdf-form-label" htmlFor="pdf-fs-item-text">{current.kind === 'date' ? 'Date text' : 'Text'}</label>
                      <textarea
                        id="pdf-fs-item-text"
                        className="pdf-text-input pdf-fs-plain"
                        rows={current.kind === 'date' ? 1 : 3}
                        value={current.text ?? ''}
                        onChange={(e) => setText(current.id, e.target.value)}
                        aria-invalid={encodingProblem(current.text ?? '', true) ? true : undefined}
                        aria-describedby={encodingProblem(current.text ?? '', true) ? 'pdf-fs-item-text-err' : undefined}
                      />
                      {encodingProblem(current.text ?? '', true) && (
                        <p className="pdf-form-hint pdf-form-invalid" id="pdf-fs-item-text-err">{encodingProblem(current.text ?? '', true)}</p>
                      )}
                    </>
                  )}
                  <div className="pdf-fs-row">
                    <label className="pdf-fs-row-label" htmlFor="pdf-fs-item-page">Page</label>
                    <select id="pdf-fs-item-page" className="pdf-fs-select narrow" value={current.page} onChange={(e) => moveToPage(current.id, Number(e.target.value))}>
                      {Array.from({ length: loaded.doc.numPages }, (_, p) => (
                        <option key={p} value={p}>{p + 1}</option>
                      ))}
                    </select>
                    <span className="pdf-fs-spacer" />
                    <button type="button" className="pdf-fs-btn icon" aria-label="Smaller" onClick={() => changeItem(current.id, resizeBox(current, 1 / 1.15, current.view))}>
                      <span className="material-symbols-outlined" aria-hidden="true">remove</span>
                    </button>
                    <button type="button" className="pdf-fs-btn icon" aria-label="Larger" onClick={() => changeItem(current.id, resizeBox(current, 1.15, current.view))}>
                      <span className="material-symbols-outlined" aria-hidden="true">add</span>
                    </button>
                    <button type="button" className="pdf-fs-btn danger" onClick={() => removeItem(current.id)}>
                      <span className="material-symbols-outlined" aria-hidden="true">delete</span> Delete
                    </button>
                  </div>
                </section>
              )}

              <section className="pdf-fs-card" aria-labelledby="pdf-fs-fields-title">
                <h3 className="pdf-fs-card-title" id="pdf-fs-fields-title">Form fields ({fields.length})</h3>
                {fields.length > 0 ? (
                  <FieldList fields={fields} values={values} onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))} onActivate={activateField} activeIndex={activeField} />
                ) : (
                  <p className="pdf-form-hint">None in this PDF.</p>
                )}
              </section>
            </div>
          </div>

          <div className="pdf-fs-finish">
            {fields.length > 0 && (
              <label className="pdf-checkbox">
                <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
                Flatten: bake the values into the pages and remove the form fields, so they can no longer be edited
              </label>
            )}
            {missing.length > 0 && (
              <p className="pdf-form-hint">
                Required but empty: {missing.slice(0, 6).join(', ')}{missing.length > 6 ? ` and ${missing.length - 6} more` : ''}. The PDF can still be created.
              </p>
            )}
            <button className="pdf-action-btn" disabled={processing} onClick={create}>
              <span className="material-symbols-outlined pdf-spinner" aria-hidden="true" style={{ display: processing ? 'inline-flex' : 'none' }}>progress_activity</span>
              {processing ? 'Writing the PDF…' : 'Create PDF'}
            </button>
            <ErrorText message={error} />
            {result && (
              <>
                {result.notes.length > 0 && (
                  <ul className="pdf-notes pdf-fs-notes">
                    {result.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                <ProcessedPdfActions fileName={outName} outputBytes={result.bytes} />
              </>
            )}
          </div>
        </>
      )}

      {dialog && (
        <SignatureDialog
          onClose={() => setDialog(false)}
          onDone={(sig) => {
            const list = [...signatures, sig]
            setSignatures(list)
            setDialog(false)
            void addItem('signature', list.length - 1, list)
          }}
        />
      )}
    </div>
  )
}
