/**
 * Every zone the select offers. Intl.supportedValuesOf omits UTC, so it is
 * added first; the browser's own zone is added when the list lacks it.
 * (Copied, not imported, from the time tool — tools stay self-contained.)
 */
export function zoneOptions(supported: readonly string[] | undefined, localZone: string): string[] {
  const list = (supported ?? []).filter((zone) => zone !== 'UTC')
  const local = localZone === 'UTC' || list.includes(localZone) ? [] : [localZone]
  return ['UTC', ...local, ...list]
}
