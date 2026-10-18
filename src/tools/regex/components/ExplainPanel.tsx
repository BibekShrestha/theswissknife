import type { ParseResult } from '../syntax/ast'
import type { ExplainNode } from '../syntax/explain'
import type { BacktrackWarning } from '../syntax/redos'

interface Props {
  pattern: string
  parsed: ParseResult
  tree: ExplainNode[] | null
  risks: BacktrackWarning[]
  /** The backtracking check gave up: the pattern is too large to check quickly. */
  riskCheckSkipped?: boolean
  /** The engine's own error for this pattern, if it rejected it. */
  engineError: string | null
}

function Tree({ nodes }: { nodes: ExplainNode[] }) {
  return (
    <ul>
      {nodes.map((node, index) => (
        <li key={`${node.start}-${index}`}>
          <div className="regex-x-row">
            <code className="regex-x-src">{node.source || '∅'}</code>
            <span>{node.label}</span>
          </div>
          {node.note && <p className="regex-x-note">{node.note}</p>}
          {node.children.length > 0 && <Tree nodes={node.children} />}
        </li>
      ))}
    </ul>
  )
}

export function ExplainPanel({ pattern, parsed, tree, risks, riskCheckSkipped = false, engineError }: Props) {
  if (engineError) {
    return (
      <div className="regex-explain">
        <p className="regex-x-error">The engine rejects this pattern: {engineError}</p>
        {!parsed.ok && <ErrorPointer pattern={pattern} index={parsed.error.index} message={parsed.error.message} />}
      </div>
    )
  }
  if (!parsed.ok) {
    return (
      <div className="regex-explain">
        <p className="regex-x-error">Can't explain this pattern: {parsed.error.message}.</p>
      </div>
    )
  }
  return (
    <div className="regex-explain">
      {riskCheckSkipped && (
        <p className="regex-muted">Backtracking check skipped: this pattern is too large to check without slowing the page.</p>
      )}
      {risks.map((risk) => (
        <p key={`${risk.start}-${risk.message}`} className="regex-x-risk">
          <span className="material-symbols-outlined" aria-hidden>warning</span>
          <span>{risk.message}</span>
        </p>
      ))}
      {tree && tree.length > 0 ? <Tree nodes={tree} /> : <p className="regex-muted">The empty pattern matches the empty string at every position.</p>}
    </div>
  )
}

/** The pattern with the parser's error position marked. */
export function ErrorPointer({ pattern, index, message }: { pattern: string; index: number; message: string }) {
  return (
    <p className="regex-x-pointer">
      <span>Position {index}: {message}</span>
      <code>
        {pattern.slice(Math.max(0, index - 30), index)}
        <mark>{pattern[index] ?? ' '}</mark>
        {pattern.slice(index + 1, index + 30)}
      </code>
    </p>
  )
}
