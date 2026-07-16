import type { JqOptions } from './types'

export interface Example {
  name: string
  filter: string
  input: string
  options?: Partial<JqOptions>
}

const repos = JSON.stringify(
  {
    repos: [
      { name: 'jq', language: 'C', stars: 31200, archived: false, topics: ['json', 'cli'] },
      { name: 'gojq', language: 'Go', stars: 3400, archived: false, topics: ['json', 'jq'] },
      { name: 'jaq', language: 'Rust', stars: 2900, archived: false, topics: ['json', 'jq'] },
      { name: 'jqjq', language: 'jq', stars: 700, archived: false, topics: ['meta'] },
    ],
  },
  null,
  2,
)

const people = JSON.stringify(
  [
    { name: 'Ada', dept: 'eng', salary: 120, remote: true },
    { name: 'Grace', dept: 'eng', salary: 140, remote: false },
    { name: 'Alan', dept: 'research', salary: 130, remote: true },
    { name: 'Katherine', dept: 'research', salary: 150, remote: true },
    { name: 'Edsger', dept: 'eng', salary: 110, remote: false },
  ],
  null,
  2,
)

export const examples: Example[] = [
  {
    name: 'Pick fields',
    filter: '.repos[] | {name, stars}',
    input: repos,
  },
  {
    name: 'Select & sort',
    filter: '.repos | map(select(.stars > 1000)) | sort_by(-.stars) | .[].name',
    input: repos,
  },
  {
    name: 'Group & aggregate',
    filter:
      'group_by(.dept)\n| map({dept: .[0].dept, headcount: length, avg_salary: (map(.salary) | add / length)})',
    input: people,
  },
  {
    name: 'Object → CSV',
    filter: '(.[0] | keys_unsorted), (.[] | [.[]]) | @csv',
    input: people,
    options: { outputMode: 'raw' },
  },
  {
    name: 'Parse raw logs (-R)',
    filter:
      'select(length > 0)\n| capture("(?<ts>\\\\S+) (?<level>\\\\w+) (?<msg>.*)")\n| select(.level == "ERROR")',
    input:
      '2026-07-16T09:14:02Z INFO service started\n2026-07-16T09:14:07Z ERROR connection refused to db:5432\n2026-07-16T09:14:09Z WARN retrying in 2s\n2026-07-16T09:14:11Z ERROR connection refused to db:5432',
    options: { rawInput: true },
  },
  {
    name: 'Slurp multiple docs (-s)',
    filter: 'sort_by(.ts) | map(.event)',
    input:
      '{"ts": 3, "event": "disconnect"}\n{"ts": 1, "event": "connect"}\n{"ts": 2, "event": "auth"}',
    options: { slurp: true },
  },
  {
    name: 'All leaf paths',
    filter: '[paths(scalars) | map(tostring) | join(".")]',
    input: repos,
  },
  {
    name: 'Streaming (--stream)',
    filter: 'select(length == 2) | {path: (.[0] | map(tostring) | join(".")), value: .[1]}',
    input: '{"a": {"b": [1, 2]}, "c": true}',
    options: { stream: true, compact: true },
  },
  {
    name: 'Named arguments ($min)',
    filter: 'map(select(.salary >= ($min | tonumber))) | map(.name)',
    input: people,
    options: { namedArgs: [{ kind: 'arg', name: 'min', value: '130' }] },
  },
  {
    name: 'Positional args ($ARGS)',
    filter: '{first: $ARGS.positional[0], rest: $ARGS.positional[1:], named: $ARGS.named}',
    input: 'null',
    options: {
      positionalArgs: [
        { kind: 'string', value: 'alpha' },
        { kind: 'json', value: '42' },
        { kind: 'json', value: '{"nested": true}' },
      ],
    },
  },
  {
    name: 'Deep transform (walk)',
    filter: 'walk(if type == "string" then ascii_upcase else . end)',
    input: repos,
  },
  {
    name: 'Reduce (running total)',
    filter: '[foreach .[] as $n (0; . + $n)]',
    input: '[5, 10, 20, 40]',
  },
]

export const DEFAULT_EXAMPLE = examples[0]
