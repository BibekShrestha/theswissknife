/** Reading a picked file, kept free of pdf-lib so the sub-tool screens stay small. */
export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
