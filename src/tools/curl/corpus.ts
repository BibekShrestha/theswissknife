/**
 * Realistic "Copy as cURL" output, written the way each browser escapes it
 * (Chrome/Firefox/Safari devtools source: escapeStringPosix / escapeStringWin).
 * All hosts and credentials are made up. Used by the tests only.
 */

export interface CorpusEntry {
  name: string
  dialect: 'bash' | 'cmd'
  input: string
}

export const corpus: CorpusEntry[] = [
  {
    name: 'Chrome bash: GET with cookies and a token in the query',
    dialect: 'bash',
    input: String.raw`curl 'https://app.example.com/api/v1/me?include=teams&access_token=at_demo_0a1b2c3d4e' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: en-US,en;q=0.9' \
  -b 'sid=demo-session-7f3e9a; prefs=compact' \
  -H 'priority: u=1, i' \
  -H 'referer: https://app.example.com/settings' \
  -H 'sec-ch-ua: "Chromium";v="129", "Not=A?Brand";v="8"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-fetch-mode: cors' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'`,
  },
  {
    name: 'Chrome bash: POST JSON with a bearer token',
    dialect: 'bash',
    input: String.raw`curl 'https://api.example.com/graphql' \
  -H 'accept: */*' \
  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.ZGVtby1zaWduYXR1cmU' \
  -H 'content-type: application/json' \
  -H 'origin: https://app.example.com' \
  --data-raw '{"operationName":"Orders","variables":{"first":20,"after":null},"query":"query Orders { orders { id } }"}'`,
  },
  {
    name: "Chrome bash: $'…' body with a quote, ! and newlines",
    dialect: 'bash',
    input: String.raw`curl 'https://api.example.com/notes' \
  -X 'PUT' \
  -H 'content-type: text/plain;charset=UTF-8' \
  --data-raw $'It\'s done!\nSecond line — ok'`,
  },
  {
    name: 'Chrome bash: multipart upload copied as raw data',
    dialect: 'bash',
    input: String.raw`curl 'https://upload.example.com/files' \
  -H 'accept: */*' \
  -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundaryX3bYq9' \
  --data-raw $'------WebKitFormBoundaryX3bYq9\r\nContent-Disposition: form-data; name="title"\r\n\r\nQuarterly report\r\n------WebKitFormBoundaryX3bYq9\r\nContent-Disposition: form-data; name="upload_token"\r\n\r\nut_demo_55aa66bb\r\n------WebKitFormBoundaryX3bYq9\r\nContent-Disposition: form-data; name="file"; filename="q3.csv"\r\nContent-Type: text/csv\r\n\r\n\r\n------WebKitFormBoundaryX3bYq9--\r\n'`,
  },
  {
    name: 'Chrome cmd: POST JSON with & and %',
    dialect: 'cmd',
    input: String.raw`curl ^"https://shop.example.com/api/cart?locale=en-US^&ref=nav^" ^
  -H ^"accept: application/json, text/plain, */*^" ^
  -H ^"content-type: application/json^" ^
  -b ^"cart_id=c-1029; consent=all^" ^
  -H ^"sec-ch-ua: ^\^"Chromium^\^";v=^\^"129^\^", ^\^"Not=A?Brand^\^";v=^\^"8^\^"^" ^
  -H ^"user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)^" ^
  --data-raw ^"^{^\^"sku^\^":^\^"A-100^\^",^\^"qty^\^":3,^\^"note^\^":^\^"50^% off ^& free^\^"^}^"`,
  },
  {
    name: 'Chrome cmd: GET with an encoded query and a multi-line body',
    dialect: 'cmd',
    input: `curl ^"https://example.com/search?q=100^%^25^&page=2^" ^
  -X ^"POST^" ^
  -H ^"x-api-key: demo_key_abcdef0123^" ^
  --data-raw ^"line one^

line two^"`,
  },
  {
    name: 'Firefox POSIX: one line, Latin-1 \\x escapes, Basic auth',
    dialect: 'bash',
    input: String.raw`curl 'https://example.com/api/profile' -X PUT -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' -H 'Accept: application/json' -H 'Accept-Language: en-US,en;q=0.5' -H 'Accept-Encoding: gzip, deflate, br, zstd' -H 'Content-Type: application/json' -H 'Authorization: Basic ZGVtbzpkZW1vLXBhc3M=' -H 'Origin: https://example.com' -H 'Connection: keep-alive' -H 'Cookie: csrftoken=demo_csrf_998877' --data-raw $'{"name":"Ren\xe9e","bio":"It\'s 5€"}'`,
  },
  {
    name: 'Firefox Windows: form login',
    dialect: 'cmd',
    input: String.raw`curl ^"https://example.com/login^" -X POST -H ^"User-Agent: Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0^" -H ^"Accept: text/html^" -H ^"Content-Type: application/x-www-form-urlencoded^" -H ^"Origin: https://example.com^" --data-raw ^"user=demo^&password=pa^%^24^%^24word^&remember=1^"`,
  },
  {
    name: 'Safari: escaped glob brackets and \\041',
    dialect: 'bash',
    input: String.raw`curl 'https://example.com/search?filter\[type\]=book&page=1' \
-X 'POST' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-H 'Accept: text/html,application/xhtml+xml' \
-H 'X-CSRF-Token: demo_csrf_8f7e6d5c4b' \
-H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' \
--data 'q=caf%C3%A9&lang=fr'`,
  },
  {
    name: 'Safari: binary JSON body with ANSI-C escapes',
    dialect: 'bash',
    input: String.raw`curl 'https://example.com/api/messages' \
-X 'POST' \
-H 'Content-Type: application/json' \
--data-binary $'{"msg":"Hi\041 über"}'`,
  },
  {
    name: 'Hand-written: -u, clustered flags, several -d and --data-urlencode',
    dialect: 'bash',
    input: `curl -sSL -XPOST -u demo_user:demo-pass-1 https://api.example.com/v1/charges \\
  -d amount=500 -d currency=usd \\
  --data-urlencode 'description=Two widgets & a gadget' \\
  -H 'Idempotency-Key: 7a1f' -k --compressed`,
  },
  {
    name: 'Hand-written: -F parts, -A, -e',
    dialect: 'bash',
    input: `curl https://upload.example.com/v1/import -F 'name=report' -F 'file=@./q3.csv;type=text/csv' -F 'meta=<meta.json' -A 'importer/2.1' -e https://example.com/`,
  },
  {
    name: 'Hand-written: -G, --json, -I and header removal',
    dialect: 'bash',
    input: `curl -G https://example.com/search -d q=hello --data-urlencode 'tag=a b' -H 'Accept:' -H 'X-Empty;'`,
  },
  {
    name: 'Hand-written: --json',
    dialect: 'bash',
    input: `curl --json '{"name":"demo","id":12345678901234567890}' https://api.example.com/items`,
  },
  {
    name: 'Hand-written: HEAD',
    dialect: 'bash',
    input: 'curl -I https://example.com/health',
  },
]
