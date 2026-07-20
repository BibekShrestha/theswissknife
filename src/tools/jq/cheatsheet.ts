export interface CheatItem {
  code: string
  desc: string
}

export interface CheatSection {
  title: string
  items: CheatItem[]
}

export const cheatsheet: CheatSection[] = [
  {
    title: 'Basics',
    items: [
      { code: '.', desc: 'identity — the whole input' },
      { code: '.foo.bar', desc: 'nested field access' },
      { code: '.foo?', desc: 'field, no error on non-object' },
      { code: '.["a key"]', desc: 'field by arbitrary string' },
      { code: '.[0], .[-1]', desc: 'array index (negative = from end)' },
      { code: '.[2:5]', desc: 'slice arrays / strings' },
      { code: '.[]', desc: 'iterate all values' },
      { code: '.a | .b', desc: 'pipe: feed output to next filter' },
      { code: '.a, .b', desc: 'comma: output multiple results' },
      { code: '..', desc: 'recursive descent (every value)' },
      { code: '"Hi \\(.name)!"', desc: 'string interpolation' },
    ],
  },
  {
    title: 'Construct',
    items: [
      { code: '[.a, .b]', desc: 'build array' },
      { code: '{name: .n, total: (.x + .y)}', desc: 'build object' },
      { code: '{name, stars}', desc: 'shorthand: pick same-named keys' },
      { code: '{(.key): .value}', desc: 'computed key' },
      { code: '[range(2; 10; 2)]', desc: 'numeric ranges' },
      { code: '{a: 1} + {b: 2}', desc: 'shallow merge (+)' },
      { code: '{a: {x: 1}} * {a: {y: 2}}', desc: 'deep merge (*)' },
    ],
  },
  {
    title: 'Operators',
    items: [
      { code: '.a + .b', desc: 'add / concat arrays & strings' },
      { code: '[1,2,3] - [2]', desc: 'array difference' },
      { code: '"ab" * 3', desc: 'repeat string' },
      { code: '.a == .b', desc: 'deep equality (also != < <= > >=)' },
      { code: '.a and .b | not', desc: 'boolean logic' },
      { code: '.a // "default"', desc: 'alternative if null/false/empty' },
      { code: '.a = 1', desc: 'assign at path' },
      { code: '.a |= . + 1', desc: 'update at path (also += -= *= /=)' },
      { code: '(.a.b)?', desc: 'suppress errors (like try)' },
    ],
  },
  {
    title: 'Filter & map',
    items: [
      { code: 'map(.price)', desc: 'transform each element' },
      { code: 'map_values(. * 2)', desc: 'transform each object value' },
      { code: 'select(.age > 30)', desc: 'keep only matching inputs' },
      { code: '.[] | select(.tags | index("jq"))', desc: 'filter array of objects' },
      { code: 'empty', desc: 'output nothing' },
      { code: 'any, all', desc: 'boolean over array' },
      { code: 'any(.[]; . > 2)', desc: 'predicate form' },
      { code: 'has("key")', desc: 'object/array has key/index' },
      { code: 'contains(["x"])', desc: 'containment test' },
      { code: 'inside("foobar")', desc: 'inverse of contains' },
      { code: 'limit(3; .[])', desc: 'first n outputs of a stream' },
      { code: 'first(.[] | select(. > 2))', desc: 'first match (also last, nth)' },
      { code: 'values', desc: 'drop nulls (also numbers, strings, …)' },
    ],
  },
  {
    title: 'Arrays',
    items: [
      { code: 'length', desc: 'array/string/object length' },
      { code: 'add', desc: 'sum / concat everything' },
      { code: 'sort, sort_by(.key)', desc: 'sorting' },
      { code: 'group_by(.dept)', desc: 'group into array of arrays' },
      { code: 'unique, unique_by(.id)', desc: 'dedupe' },
      { code: 'min, max, min_by(.p), max_by(.p)', desc: 'extremes' },
      { code: 'reverse', desc: 'reverse array/string' },
      { code: 'flatten, flatten(1)', desc: 'flatten nested arrays' },
      { code: 'transpose', desc: 'zip a matrix' },
      { code: 'INDEX(.id)', desc: 'array → object keyed by .id' },
    ],
  },
  {
    title: 'Objects',
    items: [
      { code: 'keys, keys_unsorted, values', desc: 'keys / values' },
      { code: 'to_entries', desc: '{a:1} → [{key,value}]' },
      { code: 'from_entries', desc: '[{key,value}] → object' },
      { code: 'with_entries(.value += 1)', desc: 'map over entries' },
      { code: 'del(.a, .b[0])', desc: 'delete paths' },
      { code: 'pick(.a, .b.c)', desc: 'keep only these paths (1.7+)' },
      { code: 'paths, paths(scalars)', desc: 'all paths as arrays' },
      { code: 'getpath(["a","b"])', desc: 'read by path array' },
      { code: 'setpath(["a","b"]; 42)', desc: 'write by path array' },
      { code: 'path(.a.b)', desc: 'path expression → array' },
    ],
  },
  {
    title: 'Strings & regex',
    items: [
      { code: 'split(","), join(", ")', desc: 'split / join' },
      { code: 'split("\\\\s+"; "g")', desc: 'regex split' },
      { code: 'ltrimstr("v"), rtrimstr(".js")', desc: 'strip prefix/suffix' },
      { code: 'trim, ltrim, rtrim', desc: 'strip whitespace (1.7.1+)' },
      { code: 'startswith("a"), endswith("z")', desc: 'prefix / suffix test' },
      { code: 'ascii_downcase, ascii_upcase', desc: 'case' },
      { code: 'test("^a.*z$"; "i")', desc: 'regex test (flags: g i x s m)' },
      { code: 'match("[0-9]+"; "g")', desc: 'regex match objects' },
      { code: 'capture("(?<y>\\\\d{4})-(?<m>\\\\d{2})")', desc: 'named groups → object' },
      { code: 'scan("[a-z]+")', desc: 'all matches as strings' },
      { code: 'sub("a"; "b"), gsub("\\\\s+"; "-")', desc: 'replace (regex)' },
      { code: 'tostring, tonumber', desc: 'convert' },
      { code: 'tojson, fromjson', desc: 'encode/parse JSON strings' },
      { code: '@csv, @tsv, @json, @html, @uri, @sh, @base64, @base64d', desc: 'format strings (use with -r)' },
    ],
  },
  {
    title: 'Conditionals & errors',
    items: [
      { code: 'if .n > 5 then "big" else "small" end', desc: 'if/elif/else (else optional)' },
      { code: 'try fromjson catch "bad json"', desc: 'catch errors' },
      { code: '.a.b? // "fallback"', desc: 'safe access with default' },
      { code: 'error("boom")', desc: 'raise an error' },
      { code: 'halt_error(2)', desc: 'abort with exit code' },
      { code: 'type', desc: '"object" "array" "string" …' },
      { code: 'isnan, isinfinite', desc: 'number checks' },
    ],
  },
  {
    title: 'Variables & functions',
    items: [
      { code: '.total as $t | .items[] | .share = (.price / $t)', desc: 'bind a variable' },
      { code: '. as [$first, $second] | $first', desc: 'destructure array' },
      { code: '. as {name: $n} | $n', desc: 'destructure object' },
      { code: 'def double: . * 2; map(double)', desc: 'define a function' },
      { code: 'def clamp(lo; hi): [lo, ., hi] | sort | .[1]; clamp(0; 10)', desc: 'function with params' },
      { code: '$ENV.HOME, env', desc: 'environment' },
      { code: '$ARGS.named, $ARGS.positional', desc: 'CLI arguments' },
      { code: '$__loc__', desc: 'current filter location' },
    ],
  },
  {
    title: 'Reduce & loops',
    items: [
      { code: 'reduce .[] as $x (0; . + $x)', desc: 'fold to a single value' },
      { code: 'foreach .[] as $x (0; . + $x)', desc: 'fold, emitting each step' },
      { code: 'until(. > 100; . * 2)', desc: 'loop until condition' },
      { code: 'while(. < 100; . * 2)', desc: 'emit while condition holds' },
      { code: '[limit(5; repeat(. * 2))]', desc: 'repeat forever (limit it!)' },
    ],
  },
  {
    title: 'Recursion',
    items: [
      { code: '.. | numbers', desc: 'all numbers, any depth' },
      { code: 'recurse(.children[]?)', desc: 'walk a tree' },
      { code: 'walk(if type == "object" then del(.id) else . end)', desc: 'transform every level' },
      { code: '[paths(scalars)]', desc: 'paths to all scalars' },
    ],
  },
  {
    title: 'Dates',
    items: [
      { code: 'now', desc: 'seconds since epoch' },
      { code: 'now | todate', desc: 'epoch → ISO 8601' },
      { code: '"2026-07-16T12:00:00Z" | fromdate', desc: 'ISO 8601 → epoch' },
      { code: 'now | strftime("%Y-%m-%d %H:%M")', desc: 'format time' },
      { code: '"16/07/2026" | strptime("%d/%m/%Y") | mktime', desc: 'parse custom format' },
    ],
  },
  {
    title: 'Multiple inputs & streaming',
    items: [
      { code: 'input', desc: 'consume next input document' },
      { code: '[inputs]', desc: 'consume all remaining inputs' },
      { code: 'reduce inputs as $d ({}; . * $d)', desc: 'merge many docs (with -n)' },
      { code: 'input_line_number', desc: 'current input line' },
      { code: 'tostream', desc: 'value → [path, leaf] events' },
      { code: 'fromstream(tostream)', desc: 'events → value' },
      { code: 'debug, debug("label")', desc: 'trace values to stderr' },
    ],
  },
  {
    title: 'Idioms',
    items: [
      { code: 'to_entries | map(select(.value != null)) | from_entries', desc: 'drop null object values' },
      { code: 'group_by(.k) | map({k: .[0].k, n: length})', desc: 'count by key' },
      { code: '[paths(scalars) | map(tostring) | join(".")]', desc: 'flatten to dotted paths' },
      { code: 'unique_by(.id)', desc: 'dedupe objects by field' },
      { code: 'walk(if type == "string" then sub("\\\\s+$"; "") else . end)', desc: 'trim all strings' },
      { code: '(.[0] | keys_unsorted), (.[] | [.[]]) | @csv', desc: 'objects → CSV with header' },
      { code: '[.[] | select(.active)] | length', desc: 'count matches' },
    ],
  },
]
