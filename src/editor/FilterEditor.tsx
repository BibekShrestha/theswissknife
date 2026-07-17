import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { setDiagnostics } from '@codemirror/lint'
import { jqLanguage, jqSyntaxHighlighting } from './jqLanguage'
import { createJqCompletionSource, emptyCompletionData, type CompletionData } from './completions'
import { fetchBuiltins, fetchPathsIndex } from './jqTool'
import { foldPaths } from './context'

export interface FilterEditorHandle {
  insert(code: string): void
}

export interface ErrorPos {
  line: number
  column: number
}

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** Input document + the flags that shape how jq reads it. */
  indexInput: { input: string; rawInput: boolean; slurp: boolean; nullInput: boolean }
  /** $names defined in the options panel. */
  argNames: string[]
  /** Position of the current compile error, filter-relative (1-based). */
  errorPos: ErrorPos | null
  ref?: Ref<FilterEditorHandle>
}

export default function FilterEditor({ value, onChange, placeholder, indexInput, argNames, errorPos, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const dataRef = useRef<CompletionData>(emptyCompletionData())
  dataRef.current.argNames = argNames

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          jqLanguage,
          jqSyntaxHighlighting,
          history(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ override: [createJqCompletionSource(() => dataRef.current)] }),
          cmPlaceholder(placeholder),
          EditorView.lineWrapping,
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
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

  // external value changes (examples, share links) — echo-guarded
  useEffect(() => {
    const view = viewRef.current
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
    }
  }, [value])

  // engine-sourced builtin list, once
  useEffect(() => {
    let alive = true
    void fetchBuiltins().then((builtins) => {
      if (alive && builtins.length) dataRef.current.builtins = builtins
    })
    return () => {
      alive = false
    }
  }, [])

  // paths index for input-aware field completion, debounced; stale index
  // stays live while rebuilding
  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      void fetchPathsIndex(indexInput.input, indexInput).then((paths) => {
        if (alive && paths) dataRef.current.pathsIndex = foldPaths(paths)
      })
    }, 500)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [indexInput.input, indexInput.rawInput, indexInput.slurp, indexInput.nullInput])

  // compile-error underline
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!errorPos) {
      view.dispatch(setDiagnostics(view.state, []))
      return
    }
    const doc = view.state.doc
    const lineNo = Math.min(Math.max(1, errorPos.line), doc.lines)
    const line = doc.line(lineNo)
    let from = Math.min(line.from + Math.max(0, errorPos.column - 1), line.to)
    let to = Math.min(from + 1, line.to)
    if (from === to) {
      from = Math.max(line.from, from - 1)
      to = Math.max(to, Math.min(from + 1, line.to))
    }
    view.dispatch(
      setDiagnostics(view.state, [{ from, to, severity: 'error', message: 'jq compile error (see output pane)' }]),
    )
  }, [errorPos, value])

  useImperativeHandle(ref, () => ({
    insert(code: string) {
      const view = viewRef.current
      if (!view) return
      view.dispatch(view.state.replaceSelection(code))
      view.focus()
    },
  }))

  return <div className="filter-editor" ref={hostRef} />
}
