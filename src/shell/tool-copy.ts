/**
 * One-line description per tool, keyed by registry slug. Kept out of
 * registry.ts so the entry chunk stays small: only the palette (lazy) and the
 * landing/sidebar search (loaded on the first keystroke) need these, plus the
 * build's SEO metadata (scripts/tool-meta.ts), which reads this file as text.
 *
 * Say only what the tool does — this is the copy users and search engines see.
 */
export const taglines: Record<string, string> = {
  jq: 'Run real jq 1.8.2 on your JSON — every flag, autocomplete, all in your browser',
  jwt: 'Decode, verify, generate and sign JSON Web Tokens — keys never leave your machine',
  ssl: 'Inspect certificates, CSRs and keys: expiry, hostnames, chain and CSR signatures, fingerprints and key matching',
  hash: 'SHA-1, SHA-256, SHA-384 and SHA-512 digests and HMACs of text or files, with checksum compare',
  regex: 'Test JavaScript regex with highlighted groups, test cases, plain-language explanations and share links — in a worker that stops runaway patterns',
  redact: 'Black out text with block characters — the shape stays, the words are gone for good',
  codec: 'Encode and decode Base64, URLs, HTML entities and UTF-8 hex without uploads',
  unicode: 'See every character in your text — code points, names, bytes and escapes — and catch zero-width, bidi, tag and look-alike characters, with normalise, strip and reveal',
  diff: 'Compare text or JSON line by line with word highlights, and export text diffs as a unified patch',
  markdown: 'Live Markdown preview with math and diagrams — export one self-contained HTML file or a PDF',
  time: 'Convert seconds through nanoseconds into precise local, UTC and zoned time',
  cron: 'Read a cron expression in plain English and see its next run times in any time zone',
  dates: 'Convert a date and time between time zones, DST-aware, and do date differences and ISO 8601 duration math',
  pdf: 'Merge, split, convert, compress, watermark, fill and sign, protect, unlock, and strip metadata from PDFs — all client-side',
  image: 'Convert, resize and compress JPEG, PNG, WebP and GIF — batch, with a size target',
  qr: 'Make QR codes for links, Wi-Fi, contacts and events, or read one from an image or paste — all offline',
  exif: 'See the EXIF, GPS, XMP and IPTC hidden in your photos, then strip them without re-encoding — checked by re-reading the output',
  csv: 'Paste or drop a CSV and read it as a real table — sort, search, filter, group, edit and export offline',
  'html-table': 'Pull any HTML table into CSV, JSON or Markdown — colspan and rowspan handled',
  uuid: 'Generate v4, v7 and ULID batches, or inspect any UUID or ULID — version, variant, embedded time, and conversions to ULID, hex and base64url',
  convert: 'Convert between YAML, JSON and TOML with exact big integers, line-and-column errors and a warning for anything lost',
  otp: 'Generate and check TOTP and HOTP codes from a Base32 secret, an otpauth URI, a Google Authenticator export or its QR images — nothing is stored',
  sqlite: 'Open a SQLite file in your browser — browse tables, run SQL, export CSV, JSON or the edited database',
  cidr: 'IPv4 and IPv6 subnet calculator — network, hosts, masks, reverse DNS and IANA special-purpose blocks, plus split, summarise, overlap and range to CIDR',
  binary: 'Decode Protobuf, CBOR and MessagePack from hex, Base64 or a file without a schema — a tree with byte offsets and a linked hex view',
  curl: 'Turn a browser’s Copy as cURL into fetch, Python, Go or raw HTTP — secrets flagged and swapped for placeholders, nothing sent',
  kml: 'Convert Google Earth KML or KMZ to AutoCAD DXF and back — through UTM or a Transverse Mercator, Lambert or Mercator grid, with folders as layers',
  land: 'Convert land area between Ropani-Aana-Paisa-Dam, Bigha-Kattha-Dhur, square feet, square metres, hectares and acres — sketch a plot from its measured sides, diagonals and angles, or drop a polygon drawn in Google Earth',
  'json-types': 'Paste JSON samples or JSON Lines and get TypeScript, Zod, JSON Schema, Go or Python types — optional keys, nullables and unions merged from every sample',
}
