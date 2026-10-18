/**
 * SQLite worker: holds the one open database and answers runner.ts. Running
 * here is what lets the runner stop a runaway query — SQLite inside wasm
 * cannot be interrupted from outside, so the runner terminates this worker
 * and starts a fresh one from the original bytes.
 *
 * The wasm is served from the site (Vite emits it as a hashed asset) and is
 * fetched from inside this worker, so the page CSP needs no wasm-unsafe-eval
 * and the service worker runtime-caches it on first use.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { countRows, introspect, openDatabase, readInfo, readPage, runScript } from './engine'
import { analyze, ImportCancelled, importTables } from './importer'
import type { SqliteReply, SqliteRequest } from './types'

let sqlPromise: Promise<SqlJsStatic> | null = null
let db: Database | null = null
/** Imports asked to stop. An import checks this between slices of inserts. */
const cancelled = new Set<number>()

const load = () =>
  (sqlPromise ??= initSqlJs({ locateFile: () => new URL(wasmUrl, self.location.href).href }))

function current(): Database {
  if (!db) throw new Error('No database is open.')
  return db
}

type Call = Exclude<SqliteRequest, { type: 'cancel' }>

async function handle(request: Call): Promise<{ value: unknown; transfer?: Transferable[] }> {
  switch (request.type) {
    case 'open': {
      const SQL = await load()
      db?.close()
      db = null
      db = openDatabase(SQL, request.bytes)
      return { value: true }
    }
    case 'info':
      return { value: readInfo(current()) }
    case 'schema':
      return { value: introspect(current()) }
    case 'count':
      return { value: countRows(current(), request.table) }
    case 'page':
      return { value: readPage(current(), request) }
    case 'exec':
      return { value: runScript(current(), request.sql) }
    case 'export': {
      const bytes = current().export()
      return { value: bytes, transfer: [bytes.buffer] }
    }
    case 'analyze':
      return { value: analyze(request.source, request.options) }
    case 'import': {
      const { id } = request
      const tables = await importTables(current(), request.jobs, {
        onProgress: (progress) => self.postMessage({ id, progress } satisfies SqliteReply),
        // A macrotask, not a microtask: only a full turn lets the cancel message in.
        pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
        cancelled: () => cancelled.has(id),
      })
      return { value: tables }
    }
  }
}

self.onmessage = async (event: MessageEvent<SqliteRequest>) => {
  const request = event.data
  const { id } = request
  if (request.type === 'cancel') {
    cancelled.add(id)
    return
  }
  let reply: SqliteReply
  let transfer: Transferable[] = []
  try {
    const out = await handle(request)
    reply = { id, ok: true, value: out.value }
    transfer = out.transfer ?? []
  } catch (error) {
    reply = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      cancelled: error instanceof ImportCancelled,
    }
  } finally {
    cancelled.delete(id)
  }
  self.postMessage(reply, { transfer })
}
