import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, pruneState, toEntries } from './entries'
import { parseField, parseScanned } from './sources'

const A = 'otpauth://hotp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&counter=7'
const B = 'otpauth://hotp/Example:bob?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Example'
const ids = (field: string) => toEntries(parseField(field), DEFAULT_SETTINGS).entries.map((entry) => [entry.name, entry.id] as const)

describe('entry ids', () => {
  it('stay with their account when an earlier one is removed', () => {
    const before = new Map(ids(`${A} ${B}`))
    const after = new Map(ids(B))
    expect(after.get('bob')).toBeDefined()
    expect(after.get('bob')).toBe(before.get('bob'))
    expect(after.get('bob')).not.toBe(before.get('alice'))
  })

  it('do not carry the secret in the clear', () => {
    for (const [, id] of ids(`${A} ${B} GEZDGNBVGY3TQOJQ`)) {
      expect(id).not.toMatch(/GEZD|JBSW|alice|bob/i)
    }
  })

  it('are unique for repeats, and per source', () => {
    const field = toEntries(parseField(`${A} ${A}`), DEFAULT_SETTINGS).entries.map((entry) => entry.id)
    expect(new Set(field).size).toBe(2)
    const scanned = toEntries([
      { ...parseField(A)[0], group: 'field' },
      { ...parseScanned(A, 'a.png'), group: 'scan:1:0' },
    ], DEFAULT_SETTINGS).entries.map((entry) => entry.id)
    expect(new Set(scanned).size).toBe(2)
    // Removing the pasted copy leaves the scanned one's id as it was.
    expect(toEntries([{ ...parseScanned(A, 'a.png'), group: 'scan:1:0' }], DEFAULT_SETTINGS).entries[0].id).toBe(scanned[1])
  })

  it('keep a pasted secret across settings changes', () => {
    const one = toEntries(parseField('GEZDGNBVGY3TQOJQ'), DEFAULT_SETTINGS).entries[0].id
    const two = toEntries(parseField('GEZDGNBVGY3TQOJQ'), { ...DEFAULT_SETTINGS, type: 'hotp', digits: 8 }).entries[0].id
    expect(two).toBe(one)
  })
})

describe('pruneState', () => {
  it('drops counter edits for entries that are gone, and keeps the rest as is', () => {
    const { entries } = toEntries(parseField(B), DEFAULT_SETTINGS)
    const counters = { [entries[0].id]: 3n, gone: 9n }
    expect(pruneState(counters, entries)).toEqual({ [entries[0].id]: 3n })
    const kept = { [entries[0].id]: 3n }
    expect(pruneState(kept, entries)).toBe(kept)
  })
})
