/** Kept free of pdf-lib: Image to PDF's screen checks kinds before the worker sees the files. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | 'other' {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  return 'other'
}
