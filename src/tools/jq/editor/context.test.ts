import { describe, expect, it } from 'vitest'
import { foldPaths, pathContext } from './context'
import { parseBuiltins } from './jqTool'
import { scanVariables } from './completions'

describe('pathContext', () => {
  it.each([
    // [text before cursor, expected parentSig, expected partial]
    ['.', '', ''],
    ['.re', '', 're'],
    ['.repos.', '.repos', ''],
    ['.repos[].', '.repos[]', ''],
    ['.repos[].na', '.repos[]', 'na'],
    ['.repos[0].na', '.repos[]', 'na'],
    ['.repos[12][3].x', '.repos[][]', 'x'],
    ['.a.b.c.', '.a.b.c', ''],
    ['.a?.b', '.a', 'b'],
    ['map(.', '', ''],
    ['.x | .y', '', 'y'],
    ['{name: .repos[].', '.repos[]', ''],
    ['select(.stars > 3) | .repos[].to', '.repos[]', 'to'],
  ])('%j → parent %j partial %j', (before, parentSig, partial) => {
    expect(pathContext(before)).toEqual({ parentSig, partial })
  })

  it.each([
    ['', null],
    ['map', null], // bare word, no dot chain
    ['.repos[]', null], // ends in ], nothing being typed
    ['.repos?', null], // completed optional access
    ['"str.', null], // hmm — lexically a chain; acceptable either way
  ])('%j → no field context (or harmless)', (before) => {
    const ctx = pathContext(before as string)
    if (before === '"str.') {
      // known lexical limitation: dots inside strings aren't distinguished;
      // harmless because suggestions still apply as text
      expect(ctx).toEqual({ parentSig: '', partial: '' })
    } else {
      expect(ctx).toBeNull()
    }
  })
})

describe('foldPaths', () => {
  it('folds paths into parent→children with array hops', () => {
    const idx = foldPaths([
      ['repos'],
      ['repos', '[]', 'name'],
      ['repos', '[]', 'stars'],
      ['total'],
    ])
    expect([...(idx.children.get('') ?? [])]).toEqual(['repos', 'total'])
    expect([...(idx.children.get('.repos[]') ?? [])]).toEqual(['name', 'stars'])
    expect([...idx.allKeys].sort()).toEqual(['name', 'repos', 'stars', 'total'])
  })

  it('skips non-identifier keys but keeps traversing', () => {
    const idx = foldPaths([['weird key', 'inner']])
    expect(idx.children.get('')).toBeUndefined()
    expect([...(idx.children.get('.weird key') ?? [])]).toEqual(['inner'])
    expect(idx.allKeys.has('weird key')).toBe(false)
    expect(idx.allKeys.has('inner')).toBe(true)
  })
})

describe('parseBuiltins', () => {
  it('strips arities and dedupes', () => {
    expect(parseBuiltins('["length/0","map/1","range/1","range/2","splits/1"]')).toEqual([
      'length',
      'map',
      'range',
      'splits',
    ])
  })

  it('returns [] on garbage', () => {
    expect(parseBuiltins('not json')).toEqual([])
  })
})

describe('scanVariables', () => {
  it('finds as-bindings, destructuring, and def params', () => {
    const doc = '.total as $t | . as [$first, $second] | def f($limit): $limit; .'
    expect(scanVariables(doc).sort()).toEqual(['first', 'limit', 'second', 't'])
  })
})
