/** A sub-tool's failure, announced to screen readers when it appears. */
export function ErrorText({ message }: { message: string }) {
  if (!message) return null
  return (
    <p className="pdf-error" role="alert">
      {message}
    </p>
  )
}
