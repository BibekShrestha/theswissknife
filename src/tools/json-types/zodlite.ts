/**
 * Test helper: a stand-in for the slice of the Zod 4 API the Zod emitter
 * writes, so the generated schemas can be run against their samples without
 * adding zod as a dependency. It checks structure (types, required and
 * optional keys, nullability, unions, enums, strict empty objects, safe
 * integers); the format checks are close approximations of Zod 4's own.
 * Not imported by the tool.
 */

class Schema {
  constructor(
    readonly test: (value: unknown) => boolean,
    /** Whether a missing key is fine (optional, unknown). */
    readonly missingOk = false,
  ) {}

  optional() {
    return new Schema((value) => value === undefined || this.test(value), true)
  }

  nullable() {
    return new Schema((value) => value === null || this.test(value), this.missingOk)
  }

  int() {
    return new Schema((value) => this.test(value) && Number.isSafeInteger(value))
  }

  readonly() {
    return this
  }

  parse(value: unknown) {
    if (!this.test(value)) throw new Error(`invalid: ${JSON.stringify(value)?.slice(0, 200)}`)
    return value
  }

  safeParse(value: unknown) {
    return { success: this.test(value) }
  }
}

class ObjectSchema extends Schema {
  constructor(shape: Record<string, Schema>, strict = false) {
    super((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
      const record = value as Record<string, unknown>
      for (const key of Object.keys(shape)) {
        const field = shape[key]
        if (!Object.hasOwn(record, key)) {
          if (!field.missingOk) return false
        } else if (!field.test(record[key])) return false
      }
      return !strict || Object.keys(record).every((key) => Object.hasOwn(shape, key))
    })
    this.shape = shape
  }

  readonly shape: Record<string, Schema>

  strict() {
    return new ObjectSchema(this.shape, true)
  }
}

const string = (pattern?: RegExp) => new Schema((value) => typeof value === 'string' && (!pattern || pattern.test(value)))

export const z = {
  string: () => string(),
  number: () => new Schema((value) => typeof value === 'number' && Number.isFinite(value)),
  boolean: () => new Schema((value) => typeof value === 'boolean'),
  null: () => new Schema((value) => value === null),
  unknown: () => new Schema(() => true, true),
  literal: (literal: unknown) => new Schema((value) => value === literal),
  enum: (values: string[]) => new Schema((value) => typeof value === 'string' && values.includes(value)),
  union: (options: Schema[]) => new Schema((value) => options.some((option) => option.test(value))),
  array: (item: Schema) => new Schema((value) => Array.isArray(value) && value.every((entry) => item.test(entry))),
  object: (shape: Record<string, Schema>) => new ObjectSchema(shape),
  uuid: () => string(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/),
  email: () => string(/^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/),
  url: () => new Schema((value) => {
    if (typeof value !== 'string') return false
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  }),
  iso: {
    datetime: (options?: { offset?: boolean }) => string(options?.offset
      ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/),
    date: () => string(/^\d{4}-\d{2}-\d{2}$/),
  },
}

/**
 * Runs emitted Zod code (minus its import and type lines) against zodlite
 * and returns the root schema.
 */
export function loadZod(code: string, rootName: string): Schema {
  const body = code
    .split('\n')
    .filter((line) => !line.startsWith('import ') && !line.startsWith('export type '))
    .join('\n')
    .replace(/^export const /gm, 'const ')
  return new Function('z', `${body}\nreturn ${rootName};`)(z) as Schema
}
