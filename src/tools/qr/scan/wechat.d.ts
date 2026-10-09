// qr-scanner-wechat only exports a wrapper that returns the first code and an
// axis-aligned box; we need every code and its true corners, so vite.config.ts
// aliases this name to the package's own dist/wasm.mjs.
declare module 'qr-scanner-wechat/wasm' {
  export const cv: unknown
  export const detect_prototxt: Uint8Array
  export const detect_caffemodel: Uint8Array
  export const sr_prototxt: Uint8Array
  export const sr_caffemodel: Uint8Array
}
