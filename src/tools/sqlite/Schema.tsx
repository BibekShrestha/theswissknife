import { useState } from 'react'
import type { Column, SchemaObject } from './engine'

interface Props {
  schema: SchemaObject[]
  /** Row counts by table name; undefined while counting, null when the count failed. */
  counts: Record<string, number | null | undefined>
  selected: string | null
  onSelect: (name: string) => void
}

const GROUPS: { type: SchemaObject['type']; label: string }[] = [
  { type: 'table', label: 'Tables' },
  { type: 'view', label: 'Views' },
  { type: 'index', label: 'Indexes' },
  { type: 'trigger', label: 'Triggers' },
]

function ColumnRow({ column }: { column: Column }) {
  return (
    <li className="sqlite-col">
      <span className="sqlite-col-name">{column.name}</span>
      <span className="sqlite-col-type">{column.type || 'any'}</span>
      {column.pk > 0 && <span className="sqlite-badge sqlite-badge-pk" title="Primary key">PK{column.pk > 1 ? column.pk : ''}</span>}
      {column.notNull && <span className="sqlite-badge" title="NOT NULL">NN</span>}
      {column.generated && <span className="sqlite-badge" title="Generated column">GEN</span>}
    </li>
  )
}

export function Schema({ schema, counts, selected, onSelect }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (schema.length === 0) {
    return <p className="sqlite-schema-empty">No tables yet. Create one in the SQL tab.</p>
  }

  return (
    <>
      {GROUPS.map(({ type, label }) => {
        const items = schema.filter((object) => object.type === type)
        if (items.length === 0) return null
        return (
          <section key={type} className="sqlite-schema-group" aria-label={label}>
            <h3>
              {label} <span>{items.length}</span>
            </h3>
            <ul>
              {items.map((object) => {
                const key = `${type}:${object.name}`
                const expanded = open.has(key)
                const browsable = type === 'table' || type === 'view'
                const count = counts[object.name]
                return (
                  <li key={key} className={selected === object.name && browsable ? 'is-selected' : undefined}>
                    <div className="sqlite-schema-row">
                      <button
                        type="button"
                        className="sqlite-chevron"
                        onClick={() => toggle(key)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} details of ${object.name}`}
                      >
                        <span className="material-symbols-outlined" aria-hidden>
                          {expanded ? 'expand_more' : 'chevron_right'}
                        </span>
                      </button>
                      {browsable ? (
                        <button type="button" className="sqlite-schema-name" onClick={() => onSelect(object.name)} title={`Browse ${object.name}`}>
                          {object.name}
                        </button>
                      ) : (
                        <span className="sqlite-schema-name">{object.name}</span>
                      )}
                      {type === 'table' && (
                        <span className="sqlite-count" title="Rows">
                          {count === undefined ? '…' : count === null ? '?' : count.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {expanded && (
                      <div className="sqlite-schema-detail">
                        {(type === 'index' || type === 'trigger') && <p className="sqlite-schema-on">on {object.table}</p>}
                        {object.error && <p className="sqlite-schema-error">{object.error}</p>}
                        {object.columns.length > 0 && (
                          <ul className="sqlite-cols">
                            {object.columns.map((column, i) => (
                              <ColumnRow key={i} column={column} />
                            ))}
                          </ul>
                        )}
                        {object.sql && <pre className="sqlite-schema-sql">{object.sql}</pre>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}
