/**
 * The slice of sql.js this tool uses. Declared here rather than pulling in
 * @types/sql.js, which depends on @types/node — that would put Node's globals
 * into the whole app's type program.
 */
declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | bigint | null
  export type BindParams = SqlValue[] | Record<string, SqlValue> | null

  export interface Statement {
    step(): boolean
    get(params?: BindParams, config?: { useBigInt?: boolean }): SqlValue[]
    getColumnNames(): string[]
    getSQL(): string
    free(): boolean
  }

  export interface StatementIterator extends IterableIterator<Statement> {
    getRemainingSQL(): string
  }

  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }

  export interface Database {
    exec(sql: string, params?: BindParams): QueryExecResult[]
    run(sql: string, params?: BindParams): Database
    prepare(sql: string, params?: BindParams): Statement
    iterateStatements(sql: string): StatementIterator
    export(): Uint8Array
    close(): void
    getRowsModified(): number
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => Database
  }

  export interface InitOptions {
    locateFile?: (file: string, prefix: string) => string
  }

  export default function initSqlJs(options?: InitOptions): Promise<SqlJsStatic>
}
