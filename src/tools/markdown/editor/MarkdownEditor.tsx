import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

export interface MarkdownEditorHandle {
  scroller(): HTMLElement | null
  focus(): void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onScroll: () => void
  onDropFile: (file: File) => void
  ref?: Ref<MarkdownEditorHandle>
}

/** Colours come from theme.css variables, so both site themes work unchanged. */
const mdHighlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--tok-str)' },
  { tag: t.monospace, color: 'var(--tok-key)' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--muted)' },
  { tag: t.list, color: 'var(--tok-num)' },
  { tag: [t.meta, t.comment], color: 'var(--muted)' },
])

const chrome = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
  '.cm-content': { padding: '14px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-dim) !important' },
  '.cm-placeholder': { color: 'var(--muted)' },
})

export default function MarkdownEditor({ value, onChange, onScroll, onDropFile, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onScroll, onDropFile })
  handlers.current = { onChange, onScroll, onDropFile }

  useImperativeHandle(ref, () => ({
    scroller: () => viewRef.current?.scrollDOM ?? null,
    focus: () => viewRef.current?.focus(),
  }), [])

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(mdHighlight),
          history(),
          EditorView.lineWrapping,
          cmPlaceholder('# Write or paste Markdown here, or drop a .md file'),
          keymap.of([...historyKeymap, ...defaultKeymap, indentWithTab]),
          chrome,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            scroll: () => handlers.current.onScroll(),
            drop: (event) => {
              const file = event.dataTransfer?.files?.[0]
              if (!file) return false
              event.preventDefault()
              handlers.current.onDropFile(file)
              return true
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External replacements (open file, clear, sample) — echo-guarded.
  useEffect(() => {
    const view = viewRef.current
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={hostRef} className="md-editor-host" />
}
