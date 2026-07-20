import { describe, expect, it } from 'vitest'
import { buildCliCommand, buildInvocation, tokenizeFlags } from './flags'
import { defaultOptions, type JqOptions } from './types'

const opts = (o: Partial<JqOptions> = {}): JqOptions => ({ ...defaultOptions, ...o })

describe('tokenizeFlags', () => {
  it('splits on whitespace', () => {
    expect(tokenizeFlags('-r --tab  --indent 4')).toEqual(['-r', '--tab', '--indent', '4'])
  })

  it('returns [] for empty/blank input', () => {
    expect(tokenizeFlags('')).toEqual([])
    expect(tokenizeFlags('   ')).toEqual([])
  })

  it('keeps double-quoted strings together and honors escapes inside', () => {
    expect(tokenizeFlags('--arg name "two words"')).toEqual(['--arg', 'name', 'two words'])
    expect(tokenizeFlags('--arg q "a \\"b\\" c"')).toEqual(['--arg', 'q', 'a "b" c'])
  })

  it('treats single quotes literally', () => {
    expect(tokenizeFlags("--arg v 'x \\n y'")).toEqual(['--arg', 'v', 'x \\n y'])
  })

  it('preserves empty quoted tokens', () => {
    expect(tokenizeFlags("--arg empty ''")).toEqual(['--arg', 'empty', ''])
  })

  it('handles backslash escapes outside quotes', () => {
    expect(tokenizeFlags('a\\ b c')).toEqual(['a b', 'c'])
  })

  it('reports unclosed quotes', () => {
    expect(tokenizeFlags('--arg x "oops')).toEqual({ error: 'Unclosed quote in extra flags' })
  })
})

describe('buildInvocation', () => {
  it('passes the filter through untouched by default', () => {
    const inv = buildInvocation('.a | .b', opts())
    expect(inv).toEqual({ query: '.a | .b', flags: [] })
  })

  it('maps every toggle to its flag', () => {
    const inv = buildInvocation('.', opts({
      nullInput: true,
      rawInput: true,
      slurp: true,
      seq: true,
      stream: true,
      outputMode: 'raw',
      compact: true,
      indent: 'tab',
      sortKeys: true,
      asciiOutput: true,
      exitStatus: true,
    }))
    expect(inv.flags).toEqual(['-n', '-R', '-s', '--seq', '--stream', '-r', '-c', '--tab', '-S', '-a', '-e'])
  })

  it('maps -j and --indent N', () => {
    expect(buildInvocation('.', opts({ outputMode: 'join' })).flags).toEqual(['-j'])
    expect(buildInvocation('.', opts({ indent: 4 })).flags).toEqual(['--indent', '4'])
    expect(buildInvocation('.', opts({ indent: 2 })).flags).toEqual([])
  })

  it('does not emit timeoutSec as a flag', () => {
    expect(buildInvocation('.', opts({ timeoutSec: 60 })).flags).toEqual([])
  })

  it('emits named args in order and skips blank names', () => {
    const inv = buildInvocation('.', opts({
      namedArgs: [
        { kind: 'arg', name: 'a', value: '1' },
        { kind: 'argjson', name: 'b', value: '[2]' },
        { kind: 'arg', name: '  ', value: 'ignored' },
      ],
    }))
    expect(inv.flags).toEqual(['--arg', 'a', '1', '--argjson', 'b', '[2]'])
  })

  it('emulates positional args by rebinding $ARGS without shifting line numbers', () => {
    const inv = buildInvocation('$ARGS.positional', opts({
      positionalArgs: [
        { kind: 'string', value: 'x' },
        { kind: 'json', value: '{"n": 1}' },
      ],
    }))
    expect(inv.error).toBeUndefined()
    expect(inv.flags).toEqual(['--argjson', '__jqplay_positional', '["x",{"n":1}]'])
    // wrapper stays on line 1 so filter line numbers in jq errors are stable
    expect(inv.query.split('\n')[0]).toContain('($ARGS.positional')
    expect(inv.query).toContain('as $ARGS | ($ARGS.positional')
  })

  it('rejects invalid JSON positional args', () => {
    const inv = buildInvocation('.', opts({ positionalArgs: [{ kind: 'json', value: '{oops' }] }))
    expect(inv.error).toMatch(/not valid JSON/)
  })

  it('rejects a named arg over 512 KB (wasm argv crash guard)', () => {
    const inv = buildInvocation('.', opts({
      namedArgs: [{ kind: 'arg', name: 'big', value: 'x'.repeat(600 * 1024) }],
    }))
    expect(inv.error).toMatch(/\$big is 600 KB/)
    expect(inv.error).toMatch(/input pane/)
  })

  it('rejects positional args totalling over 512 KB', () => {
    const inv = buildInvocation('.', opts({
      positionalArgs: [
        { kind: 'string', value: 'y'.repeat(300 * 1024) },
        { kind: 'string', value: 'y'.repeat(300 * 1024) },
      ],
    }))
    expect(inv.error).toMatch(/Positional arguments total/)
  })

  it('appends tokenized extra flags and surfaces tokenizer errors', () => {
    expect(buildInvocation('.', opts({ extraFlags: '--raw-output0' })).flags).toEqual(['--raw-output0'])
    expect(buildInvocation('.', opts({ extraFlags: '"unclosed' })).error).toMatch(/Unclosed quote/)
  })
})

describe('buildCliCommand', () => {
  it('renders a minimal command', () => {
    expect(buildCliCommand('.foo', opts())).toBe('jq .foo')
  })

  it('shell-quotes the filter and arg values', () => {
    expect(buildCliCommand('.a | "it\'s"', opts())).toBe(`jq '.a | "it'\\''s"'`)
    expect(buildCliCommand('.', opts({ namedArgs: [{ kind: 'arg', name: 'v', value: 'two words' }] })))
      .toBe(`jq --arg v 'two words' .`)
  })

  it('uses --args for all-string positionals', () => {
    expect(buildCliCommand('.', opts({
      positionalArgs: [
        { kind: 'string', value: 'a b' },
        { kind: 'string', value: 'c' },
      ],
    }))).toBe(`jq --args . 'a b' c`)
  })

  it('uses --jsonargs and JSON-encodes strings when kinds are mixed', () => {
    expect(buildCliCommand('.', opts({
      positionalArgs: [
        { kind: 'string', value: 'abc' },
        { kind: 'json', value: '42' },
      ],
    }))).toBe(`jq --jsonargs . '"abc"' 42`)
  })
})
