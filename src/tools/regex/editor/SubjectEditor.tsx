/**
 * The subject editor: CodeMirror with match and group highlights. Loaded with
 * lazy() from index.tsx, so CodeMirror stays out of the regex chunk's first
 * paint and entirely out of the site's entry bundle.
 *
 * Highlights are drawn only for the visible part of the document (a ViewPlugin
 * filters the ranges by `view.visibleRanges`), so a 1 MB subject with the
 * maximum number of matches costs the same to draw as a short one. Between an
 * edit and the worker's next answer the old ranges are mapped through the
 * change instead of being dropped, so typing does not flicker.
 */

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorSelection, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
  keymap,
  placeholder as cmPlaceholder,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { rangesIn, type HighlightRange } from '../highlight'
import type { MatchSpan } from '../types'

export interface SubjectEditorHandle {
  select(from: number, to: number): void
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Ranges for the current text, or null while the worker is catching up. */
  ranges: HighlightRange[] | null
  matches: MatchSpan[]
  onCursor: (pos: number) => void
  ref?: Ref<SubjectEditorHandle>
}

interface Highlights {
  ranges: HighlightRange[]
  matches: MatchSpan[]
}

const setHighlights = StateEffect.define<Highlights>()

const highlightField = StateField.define<Highlights>({
  create: () => ({ ranges: [], matches: [] }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHighlights)) return effect.value
    if (!tr.docChanged || value.ranges.length === 0) return value
    return {
      matches: value.matches,
      ranges: value.ranges.map((range) => {
        const from = tr.changes.mapPos(range.from, 1)
        const to = range.to === range.from ? from : Math.max(from, tr.changes.mapPos(range.to, -1))
        return { ...range, from, to }
      }),
    }
  },
})

class EmptyMatchMarker extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const marker = document.createElement('span')
    marker.className = 'regex-hl-empty'
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }
  ignoreEvent() {
    return false
  }
}

const emptyMarker = Decoration.widget({ widget: new EmptyMatchMarker(), side: 1 })
const matchMarks = [0, 1].map((tint) => Decoration.mark({ class: `regex-hl-m regex-hl-m${tint}` }))
const groupMarks = Array.from({ length: 6 }, (_, tint) => Decoration.mark({ class: `regex-hl-g regex-hl-g${tint}` }))

function buildDecorations(view: EditorView): DecorationSet {
  const { ranges } = view.state.field(highlightField)
  if (ranges.length === 0) return Decoration.none
  const docLength = view.state.doc.length
  const out: Range<Decoration>[] = []
  const seen = new Set<HighlightRange>()
  for (const visible of view.visibleRanges) {
    for (const range of rangesIn(ranges, visible.from, visible.to)) {
      if (seen.has(range) || range.to > docLength) continue
      seen.add(range)
      if (range.kind === 'empty') out.push(emptyMarker.range(range.from))
      else if (range.to > range.from) out.push((range.kind === 'match' ? matchMarks[range.tint] : groupMarks[range.tint]).range(range.from, range.to))
    }
  }
  return Decoration.set(out, true)
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: ViewUpdate) {
      const changed = update.startState.field(highlightField) !== update.state.field(highlightField)
      if (changed || update.viewportChanged || update.docChanged) this.decorations = buildDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const preview = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** Hover: which match is here, its span, and every group's name, span and text. */
const matchTooltip = hoverTooltip((view, pos) => {
  const { ranges, matches } = view.state.field(highlightField)
  const outer = ranges.filter((range) => range.kind !== 'group')
  const hit = outer.find((range) => (range.from === range.to ? range.from === pos : range.from <= pos && pos < range.to))
    ?? outer.find((range) => range.from <= pos && pos <= range.to)
  if (!hit) return null
  const match = matches[hit.match]
  if (!match) return null
  return {
    pos: hit.from,
    end: hit.to,
    create: () => ({ dom: describeMatch(match, hit) }),
  }
})

function describeMatch(match: MatchSpan, hit: HighlightRange): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'regex-tip'
  const head = document.createElement('div')
  head.className = 'regex-tip-head'
  head.textContent = `Match ${hit.match + 1} · ${match.start}–${match.end}${match.start === match.end ? ' · empty' : ` · ${match.end - match.start} UTF-16 units`}`
  dom.append(head)
  if (match.text) {
    const text = document.createElement('code')
    text.textContent = preview(match.text)
    dom.append(text)
  }
  for (const capture of match.captures) {
    const row = document.createElement('div')
    row.className = `regex-tip-group regex-tip-g${(capture.index - 1) % 6}`
    const name = document.createElement('span')
    name.textContent = capture.name ? `$${capture.index} ${capture.name}` : `$${capture.index}`
    const where = document.createElement('span')
    const value = document.createElement('code')
    if (capture.start === null) {
      where.textContent = 'did not participate'
    } else {
      where.textContent = `${capture.start}–${capture.end}`
      value.textContent = capture.text === '' ? '(empty)' : preview(capture.text ?? '', 60)
    }
    row.append(name, where, value)
    dom.append(row)
  }
  if (hit.widened) {
    const note = document.createElement('p')
    note.textContent = 'Starts or ends inside a surrogate pair (no u or v flag), so it is drawn over the whole character.'
    dom.append(note)
  }
  return dom
}

const chrome = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--fs-md)', backgroundColor: 'var(--panel)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-tooltip': { border: '1px solid var(--border-strong)', backgroundColor: 'var(--raised)', color: 'var(--text)', borderRadius: 'var(--radius-sm)' },
})

export default function SubjectEditor({ value, onChange, ranges, matches, onCursor, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const handlers = useRef({ onChange, onCursor })
  handlers.current = { onChange, onCursor }

  useImperativeHandle(ref, () => ({
    select(from, to) {
      const view = viewRef.current
      if (!view) return
      const length = view.state.doc.length
      view.dispatch({
        selection: EditorSelection.single(Math.min(from, length), Math.min(to, length)),
        effects: EditorView.scrollIntoView(Math.min(from, length), { y: 'center' }),
      })
      view.focus()
    },
  }), [])

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          EditorView.lineWrapping,
          cmPlaceholder('Paste the text to test the pattern against'),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          highlightField,
          highlightPlugin,
          matchTooltip,
          chrome,
          EditorView.contentAttributes.of({ 'aria-label': 'Test subject', spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange(update.state.doc.toString())
            if (update.selectionSet || update.docChanged) handlers.current.onCursor(update.state.selection.main.head)
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

  // External replacements (sample, clear, shared link) — echo-guarded.
  useEffect(() => {
    const view = viewRef.current
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (view && ranges && ranges !== view.state.field(highlightField, false)?.ranges) {
      view.dispatch({ effects: setHighlights.of({ ranges, matches }) })
    }
  }, [ranges, matches])

  return <div ref={hostRef} className="regex-editor-host" />
}
