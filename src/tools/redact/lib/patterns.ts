/**
 * One-click patterns for the things people redact most often.
 *
 * Deliberately broad rather than precise: over-matching costs a few extra
 * blocks, under-matching leaves a secret on the screen.
 */

export interface Preset {
  id: string
  label: string
  /** Regular expression source, matched without the unicode flag. */
  value: string
}

export const PRESETS: Preset[] = [
  { id: 'email', label: 'Emails', value: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+' },
  { id: 'ip', label: 'IP addresses', value: '\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b' },
  { id: 'url', label: 'URLs', value: '\\bhttps?://[^\\s<>"\')]+' },
  { id: 'token', label: 'Keys & tokens', value: '\\b[A-Za-z0-9_-]{20,}\\b' },
  { id: 'digits', label: 'Long numbers', value: '\\b\\d{4,}\\b' },
]
