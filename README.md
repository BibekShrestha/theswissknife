# The Swiss Knife

**Live: <https://theswissknife.com>** *(GitHub Pages: <https://bibekshrestha.github.io/theswissknife/>)*

Sharp little developer tools, each at its own path, all running **entirely in your
browser** — nothing you paste ever leaves your machine.

Installable, and it works with the network off: the shell is cached on first
visit, and each tool is kept once you've opened it — jq's WebAssembly and PDF
Buddy's pdf.js engine included.

| Tool | Path | What it does |
|---|---|---|
| jq playground | [/jq](https://theswissknife.com/jq) | Real jq 1.8.2 (WebAssembly) with every CLI flag, input-aware autocomplete, examples, shareable links |
| JWT decode & generate | [/jwt](https://theswissknife.com/jwt) | Decode, verify and sign JWTs (HS/RS/PS/ES/EdDSA) via WebCrypto |
| SSL certificate verifier | [/ssl](https://theswissknife.com/ssl) | Inspect X.509 certificates, check expiry and hostname coverage, and verify supplied chain signatures locally; read PKCS#10 CSRs (requested SANs, signature check) and PKCS#8/PKCS#1/SEC1/SPKI/OpenSSH keys (type, size, SPKI pin, OpenSSH SHA256/MD5 fingerprints, encryption scheme without decrypting), and check whether a key or CSR matches a certificate |
| Hash & HMAC | [/hash](https://theswissknife.com/hash) | SHA-1/256/384/512 digests and HMACs (text, hex or Base64 key) of UTF-8 text or a local file via WebCrypto, in hex or Base64; paste an expected checksum (or a `sha256sum` line) to see which one matches |
| Regex lab | [/regex](https://theswissknife.com/regex) | JavaScript regular expressions with matches and capture groups highlighted in the text, should-match / should-not-match test cases, a plain-language explanation that warns about nested quantifiers, share links and copy as JS — every run in a worker that is stopped if a pattern backtracks catastrophically |
| Text redactor | [/redact](https://theswissknife.com/redact) | Mask text with block characters, pick what to hide, share the scheme as a link |
| Codec studio | [/codec](https://theswissknife.com/codec) | Encode and decode Base64, URLs, HTML entities and UTF-8 hex |
| Unicode inspector | [/unicode](https://theswissknife.com/unicode) | Every grapheme and its code points — U+ value, name (Unicode 16.0 table), general category and script (from the browser's own Unicode data), UTF-8/16/32 bytes and HTML/JS/CSS escapes. Flags zero-width and other invisible characters, bidi controls and lines left inside an override (Trojan Source), tag characters (with the text they hide), stray variation selectors, odd spaces, BOMs, lone surrogates, orphaned or stacked combining marks, and words that mix scripts or use look-alikes of Latin letters. NFC/NFD/NFKC/NFKD views listing what changed, plus strip-invisibles and reveal outputs to copy; can decode pasted `\u`, `U+` and `&#x;` escapes first |
| Diff | [/diff](https://theswissknife.com/diff) | Compare text or JSON (keys sorted, so order and formatting don't count) with word-level highlights; copy or download a unified diff of text that `patch` and `git apply` accept, line endings kept |
| Markdown preview & export | [/markdown](https://theswissknife.com/markdown) | Live GitHub-flavoured Markdown preview with footnotes, KaTeX math and mermaid diagrams; export one self-contained HTML file, or a PDF through the print dialog, with themes, paper sizes and a table of contents |
| Unix time | [/time](https://theswissknife.com/time) | Convert seconds through nanoseconds into local, UTC and zoned time |
| Cron explainer | [/cron](https://theswissknife.com/cron) | Explain five-field cron expressions (lists, ranges, steps, names, @macros) in plain English, flag the day-of-month / day-of-week OR rule, and list the next run times in any IANA time zone with DST gaps and repeats handled |
| Dates & time zones | [/dates](https://theswissknife.com/dates) | Time zone converter: one date and time shown in up to 12 IANA zones (search by city or abbreviation, ambiguous ones flagged); edit the date or time in any row to convert from that zone, follow the clock live, or scrub the day with a slider. Each row shows the offset, abbreviation, day shift and hour difference from the reference zone and the next clock change within 30 days; skipped and repeated DST times are explained; copy one zone or all of them. Durations: difference between two zoned date-times (exact totals, calendar breakdown, Mon–Fri business days, ISO 8601), and add or subtract an ISO 8601 duration with calendar vs exact results and month-end clamping shown |
| PDF Buddy | [/pdf](https://theswissknife.com/pdf) | Merge, split, reorder, rotate, compress, watermark, number, protect and unlock PDFs, strip their metadata, and fill in forms or place a visual signature |
| Image converter | [/image](https://theswissknife.com/image) | Batch convert, resize and compress PNG/JPEG/WebP/GIF (SVG in), aim for a target file size |
| QR code generator & scanner | [/qr](https://theswissknife.com/qr) | QR codes for text, URLs, Wi-Fi, email, SMS, contacts, locations and events; custom colours, shapes and logos, a scan check, PNG/SVG/JPEG/WebP export and batch ZIP. Scan reads every code in a chosen, dropped or pasted image (ZXing-C++, then the browser's own BarcodeDetector where it has one, then OpenCV's WeChat decoder) and lays out Wi-Fi, contact and event fields |
| Photo metadata viewer & stripper | [/exif](https://theswissknife.com/exif) | Read every metadata block in JPEG, PNG, WebP, GIF, HEIC and AVIF files — EXIF (camera, lens, dates, GPS in decimal and DMS, the IFD1 thumbnail and its own EXIF), XMP including JPEG extended XMP, IPTC, ICC, MPF, comments and data after the image. Strip in batch by rewriting the container (HEIC/AVIF: Exif and XMP items zeroed in place) so image data stays byte-identical; optionally keep orientation and the colour profile; every output is parsed again to show what remains; download one file or a ZIP |
| CSV viewer | [/csv](https://theswissknife.com/csv) | Paste, drop or open a CSV/TSV and read it as a sortable, searchable, editable table — filter by column, group by value with counts and sums; export CSV, TSV, JSON or Markdown |
| HTML table extractor | [/html-table](https://theswissknife.com/html-table) | Pull any HTML table into CSV, TSV, JSON or Markdown — colspan and rowspan handled |
| UUID & ULID | [/uuid](https://theswissknife.com/uuid) | Generate UUID v4, v7 and ULID batches; inspect version, variant, embedded timestamp, clock sequence and node, and convert between UUID, ULID, hex, base64url and bytes |
| YAML / JSON / TOML converter | [/convert](https://theswissknife.com/convert) | Convert between YAML 1.2, JSON and TOML 1.0 with auto-detect, 2/4 indent and key sorting; integers past 2^53 stay exact; errors give line and column, and dropped nulls, expanded anchors, lost comments and tags, TOML dates turned into strings and big integers in JSON output are listed as warnings |
| TOTP & HOTP | [/otp](https://theswissknife.com/otp) | HOTP (RFC 4226) and TOTP (RFC 6238) codes with SHA-1/256/512 and 6–8 digits via WebCrypto, from a Base32 secret, an otpauth:// URI, a Google Authenticator `otpauth-migration://` export (every account, multi-QR batches) or dropped QR images (ZXing-C++); countdown, neighbouring windows for clock-skew debugging, check a code against ±N windows, editable HOTP counter, and an otpauth:// URI and QR code per account to re-import elsewhere. Secrets are hidden until revealed and never stored |
| SQLite viewer | [/sqlite](https://theswissknife.com/sqlite) | Open a .db/.sqlite file or start empty: schema with row counts, paged sortable tables, multi-statement SQL in a worker that stops runaway queries; export results as CSV/JSON and the edited database as .sqlite — the original file is never changed |
| Binary decoder | [/binary](https://theswissknife.com/binary) | Schemaless Protobuf wire format, CBOR (RFC 8949) and MessagePack from hex (spaces, `0x`, `\x`), Base64/Base64URL or a dropped file, with the format auto-detected and a confidence note. Protobuf varints as unsigned, signed and zigzag, I32/I64 as int, uint and float, length-delimited fields as nested message, text, packed repeated numbers or bytes, and field names from an optional .proto (common subset); CBOR tags (dates, bignums, decimal fractions, embedded CBOR), indefinite lengths, float16, simple values and deterministic-encoding warnings; every MessagePack format including ext types and timestamps. A tree with byte offsets linked to a hex view; errors give their offset; decoding runs in a worker with a deadline |
| cURL converter | [/curl](https://theswissknife.com/curl) | Read Chrome, Firefox and Safari “Copy as cURL” (bash quoting, `$'…'` strings, or Windows cmd `^` escapes, auto-detected) and show the request — method, query, headers, decoded JSON, form and multipart bodies — as JavaScript fetch, Python requests, Go net/http, raw HTTP/1.1 or clean curl; unknown flags and shell constructs are listed as warnings; a Secrets panel flags Authorization, cookies, -u, API-key headers and token/key/password fields and replaces them with placeholders everywhere. The request is never sent |
| CIDR & subnet calculator | [/cidr](https://theswissknife.com/cidr) | IPv4 and IPv6 address or CIDR (prefix, netmask or wildcard mask, `::` compression, embedded IPv4, `%zone`) to network, broadcast, first and last usable host (RFC 3021 /31, IPv6 /127 and /128), exact host counts, mask, wildcard, binary, RFC 5952 canonical text and reverse-DNS names, classified against the IANA special-purpose registries with 6to4, Teredo, NAT64 and IPv4-mapped addresses decoded. Leading-zero octets, shorthand and a second `::` are refused with the reason. Split a network into N subnets or into /x (paged, never listed in full), summarise a list into the fewest CIDRs, check whether one range contains or overlaps another, and turn a start–end range into its minimal CIDR list |
| JSON to types | [/json-types](https://theswissknife.com/json-types) | Infer types from one JSON document, JSON Lines or several documents and write them as TypeScript interfaces or type aliases (optional `?` or `\| undefined`, readonly), a Zod 4 schema, JSON Schema 2020-12, Go structs or Python TypedDict / pydantic v2. Samples and array items are merged — missing keys become optional, null nullable, mixed types unions — and nested objects are named from their keys (singular for array items, collisions de-duplicated). Opt-in refinements for date-time, date, UUID, email and http(s) URL strings and for low-cardinality string enums, always listed; integers past 2^53 and anything nested deeper than 64 levels are reported. Runs in a worker with a deadline |
| KML ⇄ DXF converter | [/kml](https://theswissknife.com/kml) | Google Earth KML or KMZ to AutoCAD DXF and back. KML → DXF projects longitude/latitude into a grid — UTM with the zone picked from the data, a local Transverse Mercator grid centred on the data whose distances and areas match the ground, a chosen UTM zone, Web Mercator, or a PROJ string for Transverse Mercator, Lambert Conformal Conic and Mercator grids on any PROJ ellipsoid with a `+towgs84` datum shift (checked against PROJ to under 1 mm) — reports the grid's scale against the ground (UTM areas run a few hundredths of a percent small), and writes DXF R12 in metres, feet, US survey feet or millimetres — with decimal units and `$INSUNITS` in the header, so AutoCAD measures in that unit rather than assuming inches — with folders as layers, nearest AutoCAD colours, closed polylines for polygons (holes included), points with optional name labels, and optional 3D altitude. DXF → KML reads ASCII DXF R12–2018: lines, polylines with arcs, circles, arcs, ellipses, splines, text, hatch boundaries, faces and nested or arrayed blocks (layer 0 and BYBLOCK inherited), with drawing units from the file (`$INSUNITS`, or inches for architectural/engineering `$LUNITS`) or chosen, and writes KML or KMZ with a folder and style per layer; hidden layers, paper space and dimensions are left out and listed. DWG and binary DXF are not read. Runs in a worker with a deadline |
| Land area converter (Nepal) | [/land](https://theswissknife.com/land) | Nepal's land units both ways: Ropani-Aana-Paisa-Dam (hills, 1 ropani = 74 ft × 74 ft) and Bigha-Kattha-Dhur (Terai, 1 dhur = 13.5 ft × 13.5 ft), square feet, square metres, hectares and acres. Enter a land-record figure such as `0-4-2-1` (pasting fills every box; Nepali digits accepted) or one unit, or sketch the plot: click its corners, type each side's measured length (feet, feet-and-inches or metres), and add diagonals or corner angles (90° in one click) until the shape is fixed — the tool says which measurement is missing, builds the true shape to scale, flags measurements that contradict each other and a crossing outline, and handles concave plots. Or drop a KML/KMZ with the plot drawn as a polygon in Google Earth: its area is measured on the WGS84 ellipsoid (an equal-area projection centred on the plot, checked against pyproj's geodesic area), holes subtracted, with side lengths, the outline to scale, open paths named as skipped, and "Edit as sketch" to replace lengths with tape measurements; the file is read locally and never put in the share link. See both compound forms and every unit, each copyable. Arithmetic is exact fractions of a square metre, so 16 aana is exactly one ropani and rounding carries upward; the definitions are listed and the input travels in a share link |
| Nepal coordinates (MUTM ⇄ WGS84) | [/nepal-coords](https://theswissknife.com/nepal-coords) | Points between Nepal's Modified UTM grid (Transverse Mercator on Everest 1830, k0 = 0.9999, false easting 500,000 m; central meridians 81°, 84° and 87° E) and latitude/longitude. The datum shift is EPSG:6208 "Nepal 1981 to WGS 84" (geocentric translations 293.17, 726.18, 245.36 m; EPSG accuracy 0.3 m), stated with its source and accuracy, or none — clearly labelled as Nepal 1981 latitude/longitude, with how far GPS would put the point. Latitude/longitude in decimal degrees or DMS (Nepali digits too), output in both with copy buttons; the zone is picked or defaults to the nearest central meridian, and points outside Nepal or far from their zone's meridian are flagged. Paste a list (CSV, tab or space separated, optional point id, header line, extra columns such as height carried through) to convert many points: a table, bad lines listed by line number with a reason, and CSV export. Checked against pyproj to 1 mm and 1e-9° in all three zones; the single point travels in a share link, a pasted list never does |

## Develop

```sh
npm install
npm run dev      # dev server (deep links like /jq work)
npm test         # unit + integration tests (runs the real wasm jq)
npm run build    # production build → dist/ (+ 404.html SPA fallback)
npm run icons    # regenerate the PWA icons from the site mark (one-shot)
npm run og-image # redraw the link-preview image public/og.png (one-shot; needs fontTools)
```

The service worker is only registered in a production build, so `npm run dev`
never serves you a stale cache. To exercise offline behaviour, build and serve
`dist/` over http://localhost (a secure context) rather than opening the files
directly.

Architecture and the **rules for adding a tool** live in [AGENTS.md](AGENTS.md)
(`CLAUDE.md` imports it) — short version: one folder under `src/tools/<slug>/`,
one entry in `src/shell/registry.ts` and one row in the table above, and the
tool becomes a lazy chunk loaded only when its route opens.

## Deployment

Every push to `main` runs the test suite and deploys to GitHub Pages
(`.github/workflows/deploy.yml`). PRs run the same checks via `ci.yml`.

### Custom domain runbook (theswissknife.com)

One-time DNS setup at the domain registrar:

1. Apex `theswissknife.com` → **A records**: `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153` (optionally AAAA `2606:50c0:8000::153`
   … `:8003::153`).
2. Optional `www` → **CNAME** `bibekshrestha.github.io`.
3. Then: set the custom domain on the repo (Settings → Pages, or
   `gh api repos/BibekShrestha/theswissknife/pages -X PUT -f cname=theswissknife.com`),
   switch `BASE_PATH` to `/` in `deploy.yml`, redeploy, and enable
   **Enforce HTTPS** once the certificate is issued.

## jq engine notes

- The wasm jq is the real binary — feature parity is exact. `--args`/`--jsonargs`
  can't be used in-engine (the wrapper's argv appends the query and `/dev/stdin`),
  so positional args are emulated by rebinding `$ARGS`; "Copy command" emits the
  real flags for terminal use.
- A single argv token near 1 MB crashes the wasm and poisons the instance; the app
  guards values at 512 KB and auto-reloads the engine after any crash. Big data
  belongs in the input pane (stdin).
- `leaf_paths` was removed in jq 1.8 — use `paths(scalars)`.
- The integration tests run every example and cheatsheet snippet through the real
  engine so a jq upgrade can't silently break them.

## License

MIT — see [LICENSE](LICENSE).
