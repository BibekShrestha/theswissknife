import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import { buildHtml, fileBase } from './doc/buildHtml'
import { buildCss, MARGINS, PAPERS, THEMES, type DocSettings } from './doc/docTheme'
import { absolutizeUrls, FRAME_SANDBOX, frameScroller, frameSkeleton, scrollFraction, writeFrame } from './doc/frame'
import type { MarkdownEditorHandle } from './editor/MarkdownEditor'
import { inlineKatexFonts, loadKatex, loadKatexCss, renderMath } from './render/math'
import { applyDiagrams, pendingDiagrams, renderDiagrams } from './render/mermaid'
import { renderMarkdown, stats } from './render/render'
import { buildToc } from './render/toc'
import { SAMPLE } from './sample'
import { loadState, saveState } from './state/persist'
import './markdown.css'

const MarkdownEditor = lazy(() => import('./editor/MarkdownEditor'))

type Katex = Awaited<ReturnType<typeof loadKatex>>
type Tab = 'edit' | 'preview'

const MAX_FILE = 5 * 1024 * 1024

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export default function MarkdownTool() {
  const initial = useMemo(() => loadState(SAMPLE), [])
  const [doc, setDoc] = useState(initial.doc)
  const [settings, setSettings] = useState<DocSettings>(initial.settings)
  const [split, setSplit] = useState(initial.split)
  const [sync, setSync] = useState(initial.sync)
  const [tab, setTab] = useState<Tab>('edit')
  const [setupOpen, setSetupOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [frameReady, setFrameReady] = useState(false)
  const [katex, setKatex] = useState<Katex | null>(null)
  const [katexCss, setKatexCss] = useState('')
  const [diagramTick, setDiagramTick] = useState(0)
  const [diagramsBusy, setDiagramsBusy] = useState(false)
  const [busy, setBusy] = useState<'' | 'html' | 'print'>('')

  const frameRef = useRef<HTMLIFrameElement>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollLock = useRef<'editor' | 'frame' | null>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const set = (patch: Partial<DocSettings>) => setSettings((s) => ({ ...s, ...patch }))

  // ---- persistence (debounced) ------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => saveState({ doc, settings, split, sync }), 400)
    return () => clearTimeout(timer)
  }, [doc, settings, split, sync])

  // ---- render -------------------------------------------------------------
  const deferred = useDeferredValue(doc)
  const result = useMemo(() => renderMarkdown(deferred, { highlight: settings.highlight }), [deferred, settings.highlight])
  const counts = useMemo(() => stats(deferred), [deferred])

  useEffect(() => {
    if (!result.hasMath || katex) return
    let live = true
    Promise.all([loadKatex(), loadKatexCss()])
      .then(([k, css]) => { if (live) { setKatex(() => k); setKatexCss(css) } })
      .catch(() => showToast('Math support failed to load'))
    return () => { live = false }
  }, [result.hasMath, katex, showToast])

  // Diagrams on an idle debounce — mermaid layout is far too slow per keystroke.
  useEffect(() => {
    if (!result.hasMermaid) return
    const pending = pendingDiagrams(result.html)
    if (!pending.length) return
    const timer = setTimeout(() => {
      setDiagramsBusy(true)
      renderDiagrams(pending)
        .then(() => setDiagramTick((n) => n + 1))
        .catch(() => showToast('Diagram support failed to load'))
        .finally(() => setDiagramsBusy(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [result, showToast])

  const toc = settings.toc ? buildToc(result.headings, settings.tocDepth) : ''
  const body = useMemo(() => {
    let html = result.html
    if (katex) html = renderMath(html, katex)
    if (result.hasMermaid) html = applyDiagrams(html)
    return toc + html
    // diagramTick: the mermaid cache filled; re-apply it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, katex, toc, diagramTick])
  const css = useMemo(() => buildCss(settings), [settings])
  const extraCss = useMemo(() => result.hasMath ? absolutizeUrls(katexCss, location.origin) : '', [result.hasMath, katexCss])
  const title = result.title

  useEffect(() => {
    if (frameReady && frameRef.current) writeFrame(frameRef.current, { title, body, css, extraCss })
  }, [frameReady, title, body, css, extraCss])

  // ---- scroll sync ----------------------------------------------------------
  const syncFrom = useCallback((source: 'editor' | 'frame') => {
    if (!sync || scrollLock.current === (source === 'editor' ? 'frame' : 'editor')) return
    const editor = editorRef.current?.scroller()
    const frame = frameRef.current && frameScroller(frameRef.current)
    if (!editor || !frame) return
    const [from, to] = source === 'editor' ? [editor, frame] : [frame, editor]
    scrollLock.current = source
    to.scrollTop = scrollFraction(from) * (to.scrollHeight - to.clientHeight)
    requestAnimationFrame(() => { scrollLock.current = null })
  }, [sync])

  useEffect(() => {
    const win = frameRef.current?.contentWindow
    if (!frameReady || !win) return
    const onScroll = () => syncFrom('frame')
    win.addEventListener('scroll', onScroll, { passive: true })
    return () => win.removeEventListener('scroll', onScroll)
  }, [frameReady, syncFrom])

  // ---- splitter ---------------------------------------------------------------
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const rect = workRef.current?.getBoundingClientRect()
      if (rect) setSplit(Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100)))
    }
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging])

  // ---- files ------------------------------------------------------------------
  const openFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE) { showToast('That file is over 5 MB — too large to preview comfortably'); return }
    const text = await file.text()
    if (text.includes('\u0000')) { showToast(`${file.name} does not look like a text file`); return }
    setDoc(text)
    showToast(`Opened ${file.name}`)
  }

  /** Everything rendered — math and diagrams included — before it leaves the tool. */
  const finalBody = async (): Promise<string> => {
    let html = result.html
    if (result.hasMath) html = renderMath(html, katex ?? await loadKatex())
    if (result.hasMermaid) {
      await renderDiagrams(pendingDiagrams(html))
      html = applyDiagrams(html)
    }
    return toc + html
  }

  const exportHtml = async () => {
    setBusy('html')
    try {
      // The export is a document, not a sheet on a desk: no page guide.
      let docCss = buildCss({ ...settings, pageGuide: false })
      if (result.hasMath) docCss += '\n' + await inlineKatexFonts(katexCss || await loadKatexCss())
      const html = buildHtml({ title, body: await finalBody(), css: docCss })
      download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${fileBase(title)}.html`)
    } catch (e) {
      showToast((e as Error).message || 'Export failed')
    } finally {
      setBusy('')
    }
  }

  const print = async () => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    setBusy('print')
    try {
      if (tab !== 'preview') setTab('preview')
      if (result.hasMermaid && pendingDiagrams(result.html).length) {
        await renderDiagrams(pendingDiagrams(result.html))
        setDiagramTick((n) => n + 1)
      }
      await nextFrame()
      await nextFrame()
      frame.contentWindow.print()
    } finally {
      setBusy('')
    }
  }

  const saveMd = () => download(new Blob([doc], { type: 'text/markdown;charset=utf-8' }), `${fileBase(title)}.md`)
  const copyHtml = async () => copy(await finalBody(), 'HTML')

  const remoteImages = /<img src="https?:/i.test(result.html)
  const paper = PAPERS.find((p) => p.id === settings.paper)!

  return (
    <div className="md-app">
      <ToolHeader brand={<><span className="material-symbols-outlined">markdown</span> Markdown preview &amp; export</>} localLabel="local, no-upload">
        <button className={setupOpen ? 'on' : ''} aria-expanded={setupOpen} onClick={() => setSetupOpen((v) => !v)} title="Theme, paper, margins, contents"><span className="material-symbols-outlined" aria-hidden>tune</span><span className="md-btn-label">Page setup</span></button>
        <button onClick={() => void exportHtml()} disabled={busy !== ''} title="Download one self-contained .html file"><span className="material-symbols-outlined" aria-hidden>{busy === 'html' ? 'hourglass_top' : 'download'}</span><span className="md-btn-label">Export HTML</span></button>
        <button className="md-primary" onClick={() => void print()} disabled={busy !== ''} title="Print, or Save as PDF from the dialog"><span className="material-symbols-outlined" aria-hidden>picture_as_pdf</span><span className="md-btn-label">Print / PDF</span></button>
      </ToolHeader>
      <input ref={fileRef} type="file" accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = '' }} />

      {setupOpen && (
        <section className="md-setup" aria-label="Page setup">
          <Field label="Theme">
            <Seg value={settings.theme} onChange={(theme) => set({ theme })} options={THEMES.map((t) => [t.id, t.name, t.note])} />
          </Field>
          <Field label="Paper">
            <div className="md-row">
              <select value={settings.paper} onChange={(e) => set({ paper: e.target.value as DocSettings['paper'] })}>
                {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.width} × {p.height} mm</option>)}
              </select>
              <Seg value={settings.landscape ? 'l' : 'p'} onChange={(v) => set({ landscape: v === 'l' })} options={[['p', 'Portrait'], ['l', 'Landscape']]} />
            </div>
          </Field>
          <Field label="Margins">
            <Seg value={settings.margin} onChange={(margin) => set({ margin })} options={MARGINS.map((m) => [m.id, m.name, `${m.mm} mm`])} />
          </Field>
          <Field label={`Text · ${settings.fontSize}px / ${settings.lineHeight.toFixed(2)}`}>
            <div className="md-row">
              <input type="range" min={11} max={20} step={0.5} value={settings.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} aria-label="Font size" />
              <input type="range" min={1.3} max={2} step={0.05} value={settings.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} aria-label="Line height" />
            </div>
          </Field>
          <Field label="Contents">
            <div className="md-row">
              <Check checked={settings.toc} onChange={(toc) => set({ toc })}>Table of contents</Check>
              <select value={settings.tocDepth} disabled={!settings.toc} onChange={(e) => set({ tocDepth: Number(e.target.value) as 2 | 3 | 4 })} aria-label="Contents depth">
                <option value={2}>to h2</option>
                <option value={3}>to h3</option>
                <option value={4}>to h4</option>
              </select>
            </div>
          </Field>
          <Field label="Options">
            <div className="md-checks">
              <Check checked={settings.highlight} onChange={(highlight) => set({ highlight })}>Highlight code</Check>
              <Check checked={settings.linkUrls} onChange={(linkUrls) => set({ linkUrls })}>Print link URLs</Check>
              <Check checked={settings.pageGuide} onChange={(pageGuide) => set({ pageGuide })}>Page guide in preview</Check>
            </div>
          </Field>
          <ul className="md-notes">
            <li><strong>PDF comes from your browser's print dialog.</strong> Pick “Save as PDF” there. Its own header/footer and “background graphics” switches win over ours, and page numbers come from that dialog — browsers don't support CSS page-number boxes yet.</li>
            <li>The page guide marks every {paper.name} page height ({settings.landscape ? 'landscape' : 'portrait'}). It's approximate: a table that won't split pushes everything after it down.</li>
            {result.hasMath && <li>This document has math, so the exported HTML embeds about 300 KB of KaTeX fonts to stay self-contained.</li>}
          </ul>
        </section>
      )}

      <div className="md-tabs" role="tablist" aria-label="View">
        <button role="tab" aria-selected={tab === 'edit'} className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Edit</button>
        <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
      </div>

      <div
        ref={workRef}
        className={`md-work${dragging ? ' is-dragging' : ''}`}
        data-tab={tab}
        style={{ '--md-split': `${split}%` } as CSSProperties}
      >
        <section className="md-pane md-edit-pane" aria-label="Markdown source">
          <header className="md-pane-head">
            <span className="md-step">01</span><strong>Markdown</strong>
            <span className="md-hint">drop a .md file anywhere here</span>
            <span className="md-pane-actions">
              <button className="md-pane-btn" onClick={() => fileRef.current?.click()} title="Open a .md file" aria-label="Open a .md file"><span className="material-symbols-outlined" aria-hidden>folder_open</span></button>
              <button className="md-pane-btn" onClick={saveMd} title="Save the Markdown source (.md)" aria-label="Save the Markdown source"><span className="material-symbols-outlined" aria-hidden>save</span></button>
            </span>
          </header>
          <div className="md-editor">
            <Suspense fallback={<div className="md-loading">Loading editor…</div>}>
              <MarkdownEditor ref={editorRef} value={doc} onChange={setDoc} onScroll={() => syncFrom('editor')} onDropFile={(f) => void openFile(f)} />
            </Suspense>
          </div>
        </section>

        <div
          className="md-gutter"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(split)}
          aria-valuemin={20}
          aria-valuemax={80}
          aria-label="Resize panes"
          tabIndex={0}
          onPointerDown={(e) => { e.preventDefault(); setDragging(true) }}
          onDoubleClick={() => setSplit(50)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(20, s - 2))
            if (e.key === 'ArrowRight') setSplit((s) => Math.min(80, s + 2))
          }}
        />

        <section className="md-pane md-preview-pane" aria-label="Preview">
          <header className="md-pane-head">
            <span className="md-step">02</span><strong>Preview</strong>
            <span className="md-hint">{THEMES.find((t) => t.id === settings.theme)!.name} · {paper.name}{settings.landscape ? ' landscape' : ''}</span>
            {diagramsBusy && <span className="md-working">rendering diagrams…</span>}
            <label className="md-sync" title="Scroll the preview with the editor">
              <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sync scroll
            </label>
            <button className="md-pane-btn" onClick={() => void copyHtml()} title="Copy the rendered HTML" aria-label="Copy the rendered HTML"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
          </header>
          <iframe
            ref={frameRef}
            className="md-frame"
            title="Document preview"
            sandbox={FRAME_SANDBOX}
            srcDoc={frameSkeleton()}
            onLoad={() => setFrameReady(true)}
          />
        </section>
      </div>

      <footer className="md-status">
        <span>{counts.words.toLocaleString()} words</span>
        <span>{counts.chars.toLocaleString()} chars</span>
        <span>~{counts.minutes} min read</span>
        {result.hasMath && <span>{katex ? 'math ✓' : 'loading math…'}</span>}
        {result.hasMermaid && <span>{diagramsBusy ? 'diagrams…' : 'diagrams ✓'}</span>}
        {result.missingFootnotes.length > 0 && <span className="md-warn">footnote{result.missingFootnotes.length > 1 ? 's' : ''} without a definition: {result.missingFootnotes.join(', ')}</span>}
        {remoteImages && <span className="md-warn" title="This site's security policy blocks third-party requests, so remote images show only in the exported HTML">remote images: export only</span>}
        <span className="md-spacer" />
        <span className="md-muted">saved in this browser only</span>
        <button className="md-link" onClick={() => { setDoc(''); editorRef.current?.focus() }}>Clear</button>
        <button className="md-link" onClick={() => setDoc(SAMPLE)}>Sample</button>
      </footer>

      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="md-field"><span className="md-label">{label}</span>{children}</div>
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label className="md-check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: ([T, string] | [T, string, string])[] }) {
  return (
    <div className="md-seg" role="group">
      {options.map(([id, text, title]) => (
        <button key={id} className={value === id ? 'on' : ''} aria-pressed={value === id} title={title} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  )
}
