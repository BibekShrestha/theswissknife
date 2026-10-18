import type { DbInfo, Page, SchemaObject, ScriptResult } from './engine'
import type { Analysis, DataSource, ImportedTable, ImportJob, ImportProgress, ReadOptions } from './importer'
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
  /** Reads a data file and plans its table. Needs no open database. */
  analyze: { args: { source: DataSource; options: ReadOptions }; result: Analysis }
  /** Creates and fills the tables in one savepoint; posts progress replies while it runs. */
  import: { args: { jobs: ImportJob[] }; result: ImportedTable[] }
}

export type SqliteCall = keyof SqliteCalls

export type SqliteRequest =
  | {
      [K in SqliteCall]: { id: number; type: K } & SqliteCalls[K]['args']
    }[SqliteCall]
  /** Asks the running import `id` to stop and roll back at its next slice. Never answered itself. */
  | { id: number; type: 'cancel' }

export type SqliteReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; cancelled?: boolean }
  /** Not a reply: the request `id` is still running. */
  | { id: number; progress: ImportProgress }
