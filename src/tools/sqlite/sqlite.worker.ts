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
import type { SqliteReply, SqliteRequest } from './types'

let sqlPromise: Promise<SqlJsStatic> | null = null
let db: Database | null = null

const load = () =>
  (sqlPromise ??= initSqlJs({ locateFile: () => new URL(wasmUrl, self.location.href).href }))

function current(): Database {
  if (!db) throw new Error('No database is open.')
  return db
}

async function handle(request: SqliteRequest): Promise<{ value: unknown; transfer?: Transferable[] }> {
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
  }
}

self.onmessage = async (event: MessageEvent<SqliteRequest>) => {
  const { id } = event.data
  let reply: SqliteReply
  let transfer: Transferable[] = []
  try {
    const out = await handle(event.data)
    reply = { id, ok: true, value: out.value }
    transfer = out.transfer ?? []
  } catch (error) {
    reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(reply, { transfer })
}
