/**
 * Markdown worker: renders off the main thread so a document that makes
 * marked slow (it is quadratic on some inputs) or overflow its stack cannot
 * freeze or crash the tab. The runner (runner.ts) owns the deadline and
 * terminates this worker when it passes.
 */

import { renderJob, type RenderRequest } from './job'

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  self.postMessage(renderJob(event.data))
}
