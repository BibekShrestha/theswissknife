/**
 * Node built-ins for the tests, via getBuiltinModule (Node 22.3+) so Node's
 * types stay out of the app — the same approach as tools/qr/scan/testing.ts.
 */
interface NodeBuiltins {
  'node:fs': { readFileSync(path: URL): Uint8Array }
  'node:crypto': { createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } } }
  'node:zlib': { deflateSync(data: Uint8Array): Uint8Array }
}

const builtin = <K extends keyof NodeBuiltins>(id: K): NodeBuiltins[K] =>
  (globalThis as unknown as { process: { getBuiltinModule(id: K): NodeBuiltins[K] } }).process.getBuiltinModule(id)

export const readFile = (url: URL) => new Uint8Array(builtin('node:fs').readFileSync(url))
export const nodeMd5Hex = (data: Uint8Array) => builtin('node:crypto').createHash('md5').update(data).digest('hex')
export const deflate = (data: Uint8Array) => new Uint8Array(builtin('node:zlib').deflateSync(data))

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
export const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))
export const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)
export const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
