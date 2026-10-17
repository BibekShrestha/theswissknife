import type { DbInfo, Page, SchemaObject, ScriptResult } from './engine'
import type { PageQuery } from './sql'

/** Every request the worker answers, with the type of its reply. */
export interface SqliteCalls {
  /** null = a new empty in-memory database. */
  open: { args: { bytes: Uint8Array | null }; result: true }
  info: { args: Record<string, never>; result: DbInfo }
  schema: { args: Record<string, never>; result: SchemaObject[] }
  count: { args: { table: string }; result: number }
  page: { args: PageQuery; result: Page }
  exec: { args: { sql: string }; result: ScriptResult }
  export: { args: Record<string, never>; result: Uint8Array }
}

export type SqliteCall = keyof SqliteCalls

export type SqliteRequest = {
  [K in SqliteCall]: { id: number; type: K } & SqliteCalls[K]['args']
}[SqliteCall]

export type SqliteReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
