/**
 * Runs PDF Buddy's pdf-lib pipelines off the main thread, one job at a time.
 * runner.ts owns the deadline: a file that sends pdf-lib into a long walk or
 * a memory blow-up costs an error message and a fresh worker, not a frozen
 * or crashed tab. Bytes are transferred both ways, never copied.
 */
import { describeError } from './lib/errors'
import { runJob } from './jobs'
import { transferList, type PdfReply, type PdfRequest } from './protocol'

/** Steps can come thousands a second; one progress message per interval is enough to keep the deadline fresh. */
const PROGRESS_INTERVAL_MS = 250

const post = (reply: PdfReply, transfer: Transferable[] = []) => self.postMessage(reply, { transfer })

self.onmessage = async (event: MessageEvent<PdfRequest>) => {
  const { id, job, args } = event.data
  let last = -Infinity
  const onProgress = (value?: number) => {
    const now = performance.now()
    if (value === undefined && now - last < PROGRESS_INTERVAL_MS) return
    last = now
    post({ id, type: 'progress', value })
  }
  try {
    const result = await runJob(job, args as never, { onProgress })
    post({ id, type: 'done', result }, transferList(result))
  } catch (error) {
    post({ id, type: 'error', message: describeError(error) })
  }
}
