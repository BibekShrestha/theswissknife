import { useState } from 'react'
import type { Indent, JqOptions, NamedArg, OutputMode, PositionalArg } from '../types'

interface Props {
  options: JqOptions
  onChange: (o: JqOptions) => void
}

function Chip({
  checked,
  flag,
  label,
  title,
  onToggle,
}: {
  checked: boolean
  flag: string
  label: string
  title: string
  onToggle: () => void
}) {
  return (
    <label className={`chip${checked ? ' on' : ''}`} title={title}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <code>{flag}</code> {label}
    </label>
  )
}

export function OptionsPanel({ options, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)
  const set = <K extends keyof JqOptions>(k: K, v: JqOptions[K]) => onChange({ ...options, [k]: v })

  const setNamedArg = (i: number, patch: Partial<NamedArg>) => {
    const next = options.namedArgs.slice()
    next[i] = { ...next[i], ...patch }
    set('namedArgs', next)
  }
  const setPositional = (i: number, patch: Partial<PositionalArg>) => {
    const next = options.positionalArgs.slice()
    next[i] = { ...next[i], ...patch }
    set('positionalArgs', next)
  }

  const extrasActive =
    options.namedArgs.length > 0 ||
    options.positionalArgs.length > 0 ||
    options.extraFlags.trim() !== '' ||
    options.seq ||
    options.stream ||
    options.asciiOutput ||
    options.exitStatus ||
    options.indent !== 2 ||
    options.timeoutSec !== 15

  return (
    <div className="options">
      <div className="options-row">
        <span className="options-group-label">in</span>
        <Chip checked={options.nullInput} flag="-n" label="null input" title="Don't read input; filter runs once with null (input/inputs still work)" onToggle={() => set('nullInput', !options.nullInput)} />
        <Chip checked={options.rawInput} flag="-R" label="raw" title="Read input as raw text lines, not JSON" onToggle={() => set('rawInput', !options.rawInput)} />
        <Chip checked={options.slurp} flag="-s" label="slurp" title="Read all inputs into a single array" onToggle={() => set('slurp', !options.slurp)} />
        <span className="sep" />
        <span className="options-group-label">out</span>
        <div className="segmented" role="radiogroup" aria-label="Output mode">
          {(
            [
              ['json', 'JSON', 'Default JSON output'],
              ['raw', '-r raw', 'Raw strings, no quotes'],
              ['join', '-j joined', 'Raw, no newlines'],
            ] as [OutputMode, string, string][]
          ).map(([mode, label, title]) => (
            <button
              key={mode}
              className={options.outputMode === mode ? 'on' : ''}
              title={title}
              onClick={() => set('outputMode', mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <Chip checked={options.compact} flag="-c" label="compact" title="One line per result" onToggle={() => set('compact', !options.compact)} />
        <Chip checked={options.sortKeys} flag="-S" label="sort keys" title="Sort object keys in output" onToggle={() => set('sortKeys', !options.sortKeys)} />
        <span className="sep" />
        <button className={`more-btn${extrasActive ? ' dot' : ''}`} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Less ▴' : 'More ▾'}
        </button>
      </div>

      {expanded && (
        <div className="options-advanced">
          <div className="adv-row">
            <Chip checked={options.stream} flag="--stream" label="stream events" title="Parse input as a stream of [path, value] events" onToggle={() => set('stream', !options.stream)} />
            <Chip checked={options.seq} flag="--seq" label="JSON-seq" title="RS-separated JSON texts for input and output (RFC 7464)" onToggle={() => set('seq', !options.seq)} />
            <Chip checked={options.asciiOutput} flag="-a" label="ascii" title="Escape non-ASCII characters in output" onToggle={() => set('asciiOutput', !options.asciiOutput)} />
            <Chip checked={options.exitStatus} flag="-e" label="exit status" title="Exit 1 if the last output was null/false, 4 if none" onToggle={() => set('exitStatus', !options.exitStatus)} />
            <label className="indent-select" title="Output indentation (--indent / --tab)">
              indent
              <select
                value={String(options.indent)}
                onChange={(e) => set('indent', (e.target.value === 'tab' ? 'tab' : Number(e.target.value)) as Indent)}
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="8">8 spaces</option>
                <option value="tab">tabs</option>
              </select>
            </label>
            <label className="indent-select" title="Kill runs that exceed this time (protects against infinite loops)">
              timeout
              <select value={String(options.timeoutSec)} onChange={(e) => set('timeoutSec', Number(e.target.value))}>
                <option value="5">5 s</option>
                <option value="15">15 s</option>
                <option value="60">60 s</option>
              </select>
            </label>
          </div>

          <div className="adv-section">
            <div className="adv-title">
              Named arguments <span className="hint">--arg treats the value as a string, --argjson parses it as JSON; both appear as $name and in $ARGS.named</span>
            </div>
            {options.namedArgs.map((a, i) => (
              <div className="arg-row" key={i}>
                <select value={a.kind} onChange={(e) => setNamedArg(i, { kind: e.target.value as NamedArg['kind'] })}>
                  <option value="arg">--arg</option>
                  <option value="argjson">--argjson</option>
                </select>
                <span className="dollar">$</span>
                <input placeholder="name" value={a.name} onChange={(e) => setNamedArg(i, { name: e.target.value })} />
                <input
                  className="grow mono"
                  placeholder={a.kind === 'arg' ? 'string value' : 'JSON value, e.g. {"a": 1}'}
                  value={a.value}
                  onChange={(e) => setNamedArg(i, { value: e.target.value })}
                />
                <button className="icon-btn" title="Remove" onClick={() => set('namedArgs', options.namedArgs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="add-btn" onClick={() => set('namedArgs', [...options.namedArgs, { kind: 'arg', name: '', value: '' }])}>
              + Add variable
            </button>
          </div>

          <div className="adv-section">
            <div className="adv-title">
              Positional arguments <span className="hint">available as $ARGS.positional (like --args / --jsonargs)</span>
            </div>
            {options.positionalArgs.map((p, i) => (
              <div className="arg-row" key={i}>
                <select value={p.kind} onChange={(e) => setPositional(i, { kind: e.target.value as PositionalArg['kind'] })}>
                  <option value="string">string</option>
                  <option value="json">JSON</option>
                </select>
                <input
                  className="grow mono"
                  placeholder={p.kind === 'string' ? 'value' : 'JSON value, e.g. [1, 2]'}
                  value={p.value}
                  onChange={(e) => setPositional(i, { value: e.target.value })}
                />
                <button className="icon-btn" title="Remove" onClick={() => set('positionalArgs', options.positionalArgs.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="add-btn" onClick={() => set('positionalArgs', [...options.positionalArgs, { kind: 'string', value: '' }])}>
              + Add positional
            </button>
          </div>

          <div className="adv-section">
            <div className="adv-title">
              Extra flags <span className="hint">passed straight to jq, e.g. --raw-output0 (file flags like --slurpfile aren't available in the browser — use --argjson instead)</span>
            </div>
            <input
              className="grow mono extra-flags"
              placeholder="--raw-output0 --unbuffered …"
              value={options.extraFlags}
              onChange={(e) => set('extraFlags', e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
