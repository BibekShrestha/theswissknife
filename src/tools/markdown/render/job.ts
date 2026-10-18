import { renderMarkdown, stats, type RenderResult } from './render'

/**
 * One render, as the worker runs it. A crash — marked recurses once per
 * nesting level, so 3,000 nested quotes overflow the stack — becomes an
 * error reply rather than an exception: the tool shows it and stays usable,
 * even when the document that does it is the one saved in this browser.
 */

export interface RenderRequest {
  id: number
  source: string
  highlight: boolean
}

export type Counts = ReturnType<typeof stats>

export type RenderReply =
  | { id: number, ok: true, result: RenderResult, counts: Counts }
  | { id: number, ok: false, message: string }

export function renderJob(request: RenderRequest, render: typeof renderMarkdown = renderMarkdown): RenderReply {
  try {
    const result = render(request.source, { highlight: request.highlight })
    return { id: request.id, ok: true, result, counts: stats(request.source) }
  } catch (error) {
    // marked appends "Please report this to …" on a second line; the first says what happened.
    const message = (error instanceof Error ? error.message : String(error)).split('\n')[0].trim()
    return { id: request.id, ok: false, message: message || 'The Markdown parser failed.' }
  }
}
