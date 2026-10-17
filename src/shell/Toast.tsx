/**
 * The toast's live region. It stays mounted and only its text changes:
 * screen readers announce changes inside an existing live region, but often
 * miss one that is created at the same moment as its text. The CSS hides it
 * while empty.
 */
export function Toast({ message }: { message: string | null }) {
  return (
    <div className="shell-toast" role="status" aria-live="polite">
      {message ?? ''}
    </div>
  )
}
