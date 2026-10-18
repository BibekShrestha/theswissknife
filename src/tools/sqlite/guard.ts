/**
 * The open database lives only in this tab's memory: closing it, opening
 * another file or leaving the page throws away edits that were not exported.
 */

/** What to ask before `action` replaces the database, or null when nothing would be lost. */
export function discardMessage(name: string | null, unsaved: boolean, action: string): string | null {
  if (!name || !unsaved) return null
  return `${name} has unsaved edits that live only in this tab. ${action} and lose them? Use Export to keep a copy first.`
}

/** A beforeunload listener that asks the browser to confirm leaving while there are unsaved edits. */
export function beforeUnloadHandler(unsaved: () => boolean) {
  return (event: BeforeUnloadEvent) => {
    if (!unsaved()) return
    event.preventDefault()
    // Older browsers only prompt when returnValue is set.
    event.returnValue = ''
  }
}
