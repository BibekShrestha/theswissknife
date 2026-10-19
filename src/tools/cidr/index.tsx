import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import {
  type CidrInput, type Net, type Range, compareRanges, formatCount, formatNet, hostMask, hostsOf, netMask, parseAny, parseCidr,
  parseCount, planSplitByCount, planSplitByPrefix, rangeOfAny, rangeToCidrs, sizeOf, subnetAt, subnetPage, summarise, toNet,
} from './cidr'
import { type Addr, type Family, binaryGroups, bitsOf, expandIPv6, formatAddr, formatIPv4, labelBits, reverseName, reverseZone } from './ip'
import { type State, type Tab, readFragment, writeFragment } from './share'
import { blocksWithin, classify, embedded, summaryTag } from './special'
import './cidr.css'

type Copy = (text: string, what: string) => Promise<void>

const TAB_LABELS: Record<Tab, string> = {
  calc: 'Calculator',
  split: 'Split',
  summarise: 'Summarise',
  contains: 'Contains',
  range: 'Range ⇄ CIDR',
}

const CALC_EXAMPLES = ['192.168.1.10/24', '10.0.0.1 255.255.255.252', '203.0.113.6/31', '100.64.12.7/10', '2001:db8::1/64', 'fe80::1%eth0/64', '::ffff:192.0.2.1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']

/** Split rows per page. Pages are computed by index, so a /8 into /32s costs one page. */
export const SPLIT_PAGE = 256
/** Longest list of special blocks shown inside one wide network. */
const WITHIN_MAX = 12
/** Longest list of per-line notes shown in Summarise. */
const NOTES_MAX = 50

const addrText = (family: Family, value: bigint) => formatAddr({ family, value })
const rangeText = (range: Range) => `${addrText(range.family, range.start)} – ${addrText(range.family, range.end)}`
const plural = (n: bigint | number, one: string, many = `${one}s`) => (n === 1n || n === 1 ? one : many)

export default function CidrTool() {
  const [state, setState] = useState<State>(() => readFragment(window.location.hash))
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)
  const set = <K extends keyof State>(key: K, value: State[K]) => setState((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#t=')) setState(readFragment(window.location.hash)) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const fragment = useMemo(() => writeFragment(state), [state])
  useEffect(() => {
    if (window.location.hash !== fragment.hash) window.history.replaceState(window.history.state, '', fragment.hash)
  }, [fragment])

  const copyLink = () => {
    void copy(window.location.href, 'Link')
    if (fragment.omitted) showToast('Link copied — the list is too long to include, so it opens with the default list')
  }

  return (
    <div className="cidr-app">
      <ToolHeader brand={<><span className="tool-mark-accent">/24</span> CIDR calculator</>} localLabel="computed locally">
        <button type="button" onClick={copyLink}>Copy link</button>
      </ToolHeader>
      <main id="main-content" className="cidr-main">
        <div className="cidr-tabs" role="tablist" aria-label="Mode">
          {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
            <button key={tab} type="button" role="tab" id={`cidr-tab-${tab}`} aria-selected={state.tab === tab} aria-controls="cidr-panel" className={state.tab === tab ? 'on' : ''} onClick={() => set('tab', tab)}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div id="cidr-panel" role="tabpanel" aria-labelledby={`cidr-tab-${state.tab}`} className="cidr-panel">
          {state.tab === 'calc' && <Calculator value={state.calc} onChange={(v) => set('calc', v)} copy={copy} />}
          {state.tab === 'split' && <Split state={state} set={set} copy={copy} />}
          {state.tab === 'summarise' && <Summarise value={state.entries} onChange={(v) => set('entries', v)} copy={copy} />}
          {state.tab === 'contains' && <Contains a={state.a} b={state.b} set={set} />}
          {state.tab === 'range' && <RangeTab value={state.range} onChange={(v) => set('range', v)} copy={copy} />}
        </div>
      </main>
      <Toast message={toast} />
    </div>
  )
}

function Field({ label, value, onChange, placeholder, invalid, examples }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  examples?: string[]
}) {
  const id = useId()
  return (
    <div className="cidr-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        className={`cidr-input${invalid ? ' cidr-input-bad' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={invalid}
      />
      {examples && (
        <div className="cidr-examples" role="group" aria-label={`${label} examples`}>
          {examples.map((example) => (
            <button key={example} type="button" className={example === value.trim() ? 'on' : ''} onClick={() => onChange(example)}>
              <code>{example}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CopyButton({ text, what, copy }: { text: string; what: string; copy: Copy }) {
  return (
    <button type="button" className="cidr-copy" onClick={() => void copy(text, what)} aria-label={`Copy ${what}`} title={`Copy ${what}`}>
      <span className="material-symbols-outlined" aria-hidden>content_copy</span>
    </button>
  )
}

interface RowSpec { label: string; value: string; note?: ReactNode; copy?: boolean }

function Rows({ rows, copy }: { rows: RowSpec[]; copy: Copy }) {
  return (
    <dl className="cidr-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>
            <code>{row.value}</code>
            {row.copy !== false && <CopyButton text={row.value} what={row.label} copy={copy} />}
            {row.note && <small>{row.note}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Bits({ family, value, prefix }: { family: Family; value: bigint; prefix: number }) {
  const size = family === 4 ? 8 : 16
  return (
    <code className="cidr-bits">
      {binaryGroups({ family, value }).map((group, index) => {
        const net = Math.min(size, Math.max(0, prefix - index * size))
        return (
          <span key={index} className="cidr-bit-group">
            <span className="cidr-bit-net">{group.slice(0, net)}</span>
            <span className="cidr-bit-host">{group.slice(net)}</span>
          </span>
        )
      })}
    </code>
  )
}

export function Calculator({ value, onChange, copy }: { value: string; onChange: (value: string) => void; copy: Copy }) {
  const parsed = useMemo(() => parseCidr(value), [value])
  return (
    <div className="cidr-stack">
      <section className="cidr-box">
        <Field label="Address or CIDR" value={value} onChange={onChange} invalid={!parsed.ok && value.trim() !== ''} placeholder="192.168.1.10/24 · 10.0.0.1 255.255.255.0 · 2001:db8::/32" examples={CALC_EXAMPLES} />
        <div aria-live="polite" className="cidr-status">
          {!parsed.ok
            ? <p className="cidr-error">{parsed.error}</p>
            : <CalcSummary input={parsed.value} />}
        </div>
      </section>
      {parsed.ok && <CalcDetails input={parsed.value} copy={copy} />}
      <p className="cidr-help">
        Accepted: IPv4 dotted quads, IPv6 with one <code>::</code>, a dotted IPv4 tail (<code>::ffff:192.0.2.1</code>), a <code>%zone</code>,
        and a prefix length, netmask or wildcard mask (<code>/24</code>, <code>/255.255.255.0</code>, <code> 0.0.0.255</code>). Leading zeros in
        IPv4 octets, shorthand like <code>10.1</code> and hex octets are refused: C’s inet_aton() reads <code>010.0.0.1</code> as 8.0.0.1, other
        parsers as 10.0.0.1.
      </p>
    </div>
  )
}

function CalcSummary({ input }: { input: CidrInput }) {
  const { net, hostBits } = toNet(input)
  const hosts = hostsOf(net)
  return (
    <p className="cidr-summary">
      <strong>{formatNet(net)}</strong>
      <span>{formatCount(sizeOf(net.family, net.prefix))} {plural(sizeOf(net.family, net.prefix), 'address', 'addresses')} · {formatCount(hosts.usable)} usable</span>
      {hostBits && <span className="cidr-tag">host bits set</span>}
      {input.form === 'netmask' && <span className="cidr-tag">from netmask</span>}
      {input.form === 'wildcard' && <span className="cidr-tag">from wildcard mask</span>}
    </p>
  )
}

function CalcDetails({ input, copy }: { input: CidrInput; copy: Copy }) {
  const { net, hostBits } = toNet(input)
  const { family } = net
  const addr: Addr = { family, value: input.addr }
  const hosts = hostsOf(net)
  const bits = bitsOf(family)
  const show = (v: bigint) => addrText(family, v)
  const size = sizeOf(family, net.prefix)
  const blocks = classify(addr)
  const verdict = summaryTag(addr, blocks)
  const within = blocksWithin(net)
  const extras = embedded(addr)
  const zoneAligned = net.prefix % labelBits(family) === 0

  const network: RowSpec[] = [
    { label: 'Address', value: show(input.addr) + (input.zone !== undefined ? `%${input.zone}` : ''), note: hostBits ? 'Host bits are set — this is an address inside the network below.' : undefined },
    ...(family === 6 ? [{ label: 'Expanded', value: expandIPv6(input.addr) }] : []),
    { label: 'Network', value: formatNet(net) },
    { label: family === 4 ? 'Netmask' : 'Mask', value: show(netMask(family, net.prefix)) },
    { label: family === 4 ? 'Wildcard' : 'Host mask', value: show(hostMask(family, net.prefix)) },
    ...(family === 4
      ? [{ label: 'Broadcast', value: hosts.broadcast !== undefined ? show(hosts.broadcast) : 'none', copy: hosts.broadcast !== undefined }]
      : net.prefix < bits - 1 ? [{ label: 'Subnet-Router anycast', value: show(net.base) }] : []),
    { label: 'First usable', value: show(hosts.first) },
    { label: 'Last usable', value: show(hosts.last) },
    { label: 'Usable hosts', value: formatCount(hosts.usable), note: hosts.rule, copy: false },
    { label: 'Addresses', value: formatCount(size), copy: false },
    { label: 'Range', value: `${show(net.base)} – ${show(net.base + size - 1n)}` },
    ...(family === 6 && net.prefix < 64 ? [{ label: '/64 subnets', value: formatCount(1n << BigInt(64 - net.prefix)), copy: false }] : []),
  ]

  const forms: RowSpec[] = family === 4
    ? [
      { label: 'Integer', value: input.addr.toString() },
      { label: 'Hex', value: `0x${input.addr.toString(16).toUpperCase().padStart(8, '0')}` },
      { label: 'IPv4-mapped IPv6', value: `::ffff:${formatIPv4(input.addr)}` },
    ]
    : [{ label: 'RFC 5952', value: show(input.addr), note: 'Canonical text: lowercase, no leading zeros, the longest zero run as ::.' }]

  const dns: RowSpec[] = [
    { label: 'PTR name', value: reverseName(addr) },
    {
      label: 'Reverse zone',
      value: reverseZone({ family, value: net.base }, net.prefix),
      note: zoneAligned ? undefined : `/${net.prefix} does not end on a ${family === 4 ? 'octet' : 'nibble'} boundary; this is the enclosing zone${family === 4 ? ' (delegating part of it takes RFC 2317 CNAMEs)' : ''}.`,
    },
  ]

  return (
    <div className="cidr-grid">
      <section className="cidr-box" aria-labelledby="cidr-h-network">
        <h2 id="cidr-h-network">Network</h2>
        <Rows rows={network} copy={copy} />
        {input.notes.map((note) => <p key={note} className="cidr-note">{note}</p>)}
      </section>

      <div className="cidr-stack">
        <section className="cidr-box" aria-labelledby="cidr-h-class">
          <h2 id="cidr-h-class">Classification</h2>
          <p className="cidr-verdict"><span className={`cidr-badge cidr-badge-${verdict.tag}`}>{verdict.tag.replace('-', ' ')}</span> {verdict.text}</p>
          {blocks.length > 0 && (
            <ul className="cidr-blocks">
              {blocks.map((block) => (
                <li key={block.cidr}>
                  <code>{block.cidr}</code>
                  <span>{block.name}</span>
                  <small>{block.rfc}{block.net.prefix > net.prefix ? ` · covers only part of ${formatNet(net)}` : ''}</small>
                </li>
              ))}
            </ul>
          )}
          {extras.length > 0 && <Rows rows={extras.map((e) => ({ label: e.label, value: e.value }))} copy={copy} />}
          {within.length > 0 && (
            <>
              <h3>Special blocks inside {formatNet(net)}</h3>
              <ul className="cidr-blocks">
                {within.slice(0, WITHIN_MAX).map((block) => (
                  <li key={block.cidr}><code>{block.cidr}</code><span>{block.name}</span><small>{block.rfc}</small></li>
                ))}
              </ul>
              {within.length > WITHIN_MAX && <p className="cidr-more">and {within.length - WITHIN_MAX} more</p>}
            </>
          )}
          {input.zone !== undefined && verdict.tag !== 'link-local' && verdict.tag !== 'multicast' && (
            <p className="cidr-note">Zone ids qualify non-global addresses such as link-local ones (RFC 4007 §11); on this address it only names the interface.</p>
          )}
          <p className="cidr-source">From the IANA IPv4 and IPv6 special-purpose address registries and the multicast and IPv6 address-space registries.</p>
        </section>

        <section className="cidr-box" aria-labelledby="cidr-h-forms">
          <h2 id="cidr-h-forms">Forms &amp; DNS</h2>
          <Rows rows={[...forms, ...dns]} copy={copy} />
        </section>
      </div>

      <section className="cidr-box cidr-wide" aria-labelledby="cidr-h-bits">
        <h2 id="cidr-h-bits">Binary</h2>
        <p className="cidr-legend"><span className="cidr-bit-net">network bits</span> <span className="cidr-bit-host">host bits</span> · /{net.prefix} of {bits} bits</p>
        <dl className="cidr-binary">
          <div><dt>Address</dt><dd><Bits family={family} value={input.addr} prefix={net.prefix} /></dd></div>
          <div><dt>Mask</dt><dd><Bits family={family} value={netMask(family, net.prefix)} prefix={net.prefix} /></dd></div>
          <div><dt>Network</dt><dd><Bits family={family} value={net.base} prefix={net.prefix} /></dd></div>
        </dl>
      </section>
    </div>
  )
}

export function Split({ state, set, copy }: { state: State; set: <K extends keyof State>(key: K, value: State[K]) => void; copy: Copy }) {
  const parsed = useMemo(() => parseCidr(state.splitNet), [state.splitNet])
  const plan = useMemo(() => {
    if (!parsed.ok) return parsed
    const { net } = toNet(parsed.value)
    if (state.splitBy === 'prefix') {
      const text = state.splitValue.trim().replace(/^\//, '')
      if (!/^\d+$/.test(text)) return { ok: false as const, error: 'Enter a prefix length, e.g. 24.' }
      return planSplitByPrefix(net, Number(text))
    }
    const count = parseCount(state.splitValue)
    return count.ok ? planSplitByCount(net, count.value) : count
  }, [parsed, state.splitBy, state.splitValue])

  const [pageText, setPageText] = useState('1')
  const pages = plan.ok ? (plan.value.count + BigInt(SPLIT_PAGE) - 1n) / BigInt(SPLIT_PAGE) : 1n
  const pageNumber = (() => {
    const n = parseCount(pageText)
    if (!n.ok || n.value < 1n) return 1n
    return n.value > pages ? pages : n.value
  })()
  const planKey = plan.ok ? `${formatNet(plan.value.net)}>${plan.value.prefix}` : ''
  useEffect(() => { setPageText('1') }, [planKey])

  const offset = (pageNumber - 1n) * BigInt(SPLIT_PAGE)
  const rows = useMemo(() => (plan.ok ? subnetPage(plan.value, offset, SPLIT_PAGE) : []), [plan, offset])
  const hostHint = parsed.ok && toNet(parsed.value).hostBits
  const eachUsable = plan.ok ? hostsOf(subnetAt(plan.value, 0n)).usable : 0n

  return (
    <div className="cidr-stack">
      <section className="cidr-box cidr-controls">
        <Field label="Network" value={state.splitNet} onChange={(v) => set('splitNet', v)} invalid={!parsed.ok} examples={['10.0.0.0/16', '192.168.0.0/24', '10.0.0.0/8', '2001:db8::/48']} />
        <div className="cidr-split-by">
          <div className="cidr-seg" role="group" aria-label="Split by">
            <button type="button" className={state.splitBy === 'prefix' ? 'on' : ''} aria-pressed={state.splitBy === 'prefix'} onClick={() => set('splitBy', 'prefix')}>Subnets of /x</button>
            <button type="button" className={state.splitBy === 'count' ? 'on' : ''} aria-pressed={state.splitBy === 'count'} onClick={() => set('splitBy', 'count')}>Into N subnets</button>
          </div>
          <label className="cidr-inline">
            <span>{state.splitBy === 'prefix' ? 'Prefix /' : 'Subnets'}</span>
            <input type="text" inputMode="numeric" className="cidr-small-input" value={state.splitValue} onChange={(event) => set('splitValue', event.target.value)} spellCheck={false} autoComplete="off" />
          </label>
        </div>
      </section>

      <div aria-live="polite" className="cidr-status">
        {!plan.ok ? <p className="cidr-error">{plan.error}</p> : (
          <p className="cidr-summary">
            <strong>{formatNet(plan.value.net)} → {formatCount(plan.value.count)} × /{plan.value.prefix}</strong>
            <span>{formatCount(eachUsable)} usable {eachUsable === 1n ? 'address' : 'addresses'} each</span>
          </p>
        )}
      </div>
      {plan.ok && plan.value.requested !== undefined && (
        <p className="cidr-note">{formatCount(plan.value.requested)} asked for. Equal subnets come in powers of two, so this is the smallest split with at least that many: {formatCount(plan.value.count)} × /{plan.value.prefix}.</p>
      )}
      {hostHint && parsed.ok && <p className="cidr-note">{state.splitNet.trim()} has host bits set; splitting its network {formatNet(toNet(parsed.value).net)}.</p>}

      {plan.ok && (
        <section className="cidr-box cidr-table-box" aria-label="Subnets">
          <header className="cidr-table-head">
            <span>
              {plan.value.count > BigInt(SPLIT_PAGE)
                ? `Showing ${formatCount(offset + 1n)}–${formatCount(offset + BigInt(rows.length))} of ${formatCount(plan.value.count)} — capped at ${SPLIT_PAGE} per page; pages are computed on demand.`
                : `${formatCount(plan.value.count)} ${plural(plan.value.count, 'subnet')}`}
            </span>
            {pages > 1n && (
              <span className="cidr-pager">
                <button type="button" disabled={pageNumber <= 1n} onClick={() => setPageText(String(pageNumber - 1n))} aria-label="Previous page"><span className="material-symbols-outlined" aria-hidden>chevron_left</span></button>
                <label className="cidr-inline"><span>Page</span><input type="text" inputMode="numeric" className="cidr-small-input" value={pageText} onChange={(event) => setPageText(event.target.value)} aria-label={`Page, 1 to ${pages}`} /></label>
                <span className="cidr-of">of {formatCount(pages)}</span>
                <button type="button" disabled={pageNumber >= pages} onClick={() => setPageText(String(pageNumber + 1n))} aria-label="Next page"><span className="material-symbols-outlined" aria-hidden>chevron_right</span></button>
              </span>
            )}
            <button type="button" onClick={() => void copy(rows.map(formatNet).join('\n'), pages > 1n ? `${rows.length} subnets on this page` : `${rows.length} ${plural(rows.length, 'subnet')}`)}>
              <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy {pages > 1n ? 'page' : 'all'}
            </button>
          </header>
          <div className="cidr-table-scroll">
            <table className="cidr-table">
              <thead>
                <tr><th scope="col">#</th><th scope="col">Subnet</th><th scope="col">First usable</th><th scope="col">Last usable</th>{plan.value.net.family === 4 && <th scope="col">Broadcast</th>}</tr>
              </thead>
              <tbody>
                {rows.map((subnet, index) => {
                  const h = hostsOf(subnet)
                  return (
                    <tr key={formatNet(subnet)}>
                      <td>{formatCount(offset + BigInt(index) + 1n)}</td>
                      <td><code>{formatNet(subnet)}</code></td>
                      <td><code>{addrText(subnet.family, h.first)}</code></td>
                      <td><code>{addrText(subnet.family, h.last)}</code></td>
                      {subnet.family === 4 && <td><code>{h.broadcast !== undefined ? addrText(4, h.broadcast) : '—'}</code></td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export function Summarise({ value, onChange, copy }: { value: string; onChange: (value: string) => void; copy: Copy }) {
  const result = useMemo(() => summarise(value), [value])
  const output = result.output.map(formatNet).join('\n')
  const id = useId()
  const valid = result.inputs - result.errors.length
  return (
    <div className="cidr-stack">
      <div className="cidr-two">
        <section className="cidr-box cidr-pane">
          <label htmlFor={id}>CIDRs, addresses or ranges</label>
          <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} wrap="off" placeholder={'10.0.0.0/25\n10.0.0.128/25\n192.0.2.10 - 192.0.2.20'} />
          <small className="cidr-hint">One per line, or separated by commas. <code>#</code> starts a comment.</small>
        </section>
        <section className="cidr-box cidr-pane" aria-labelledby={`${id}-out`}>
          <header className="cidr-table-head">
            <h2 id={`${id}-out`}>Minimal set</h2>
            <button type="button" disabled={!output} onClick={() => void copy(output, `${result.output.length} ${plural(result.output.length, 'CIDR')}`)}>
              <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
            </button>
          </header>
          <textarea value={output} readOnly spellCheck={false} wrap="off" aria-label="Minimal CIDR set" />
        </section>
      </div>
      <p className="cidr-summary" aria-live="polite">
        <strong>{valid} {plural(valid, 'input')} → {result.output.length} {plural(result.output.length, 'block')}</strong>
        {result.addresses[4] > 0n && <span>{formatCount(result.addresses[4])} IPv4 {plural(result.addresses[4], 'address', 'addresses')}</span>}
        {result.addresses[6] > 0n && <span>{formatCount(result.addresses[6])} IPv6 {plural(result.addresses[6], 'address', 'addresses')}</span>}
        {result.errors.length > 0 && <span className="cidr-tag cidr-tag-bad">{result.errors.length} invalid</span>}
      </p>
      <p className="cidr-help">The output covers exactly the same addresses as the input — adjacent and overlapping blocks are merged, nothing extra is added.</p>
      <NoteList title="Invalid" items={result.errors.map((e) => ({ key: `${e.line}:${e.text}`, line: e.line, text: e.text, note: e.error }))} bad />
      <NoteList title="Host bits set — read as their network" items={result.normalised.map((e) => ({ key: `${e.line}:${e.text}`, line: e.line, text: e.text, note: `→ ${formatNet(e.net)}` }))} />
      <NoteList title="Already covered by another entry" items={result.redundant.map((e) => ({ key: `${e.line}:${e.text}`, line: e.line, text: e.text, note: `inside ${formatNet(e.within)}` }))} />
    </div>
  )
}

function NoteList({ title, items, bad }: { title: string; items: { key: string; line: number; text: string; note: string }[]; bad?: boolean }) {
  if (!items.length) return null
  return (
    <section className={`cidr-box cidr-notes${bad ? ' cidr-notes-bad' : ''}`}>
      <h2>{title} ({items.length})</h2>
      <ul>
        {items.slice(0, NOTES_MAX).map((item) => (
          <li key={item.key}><span className="cidr-line">L{item.line}</span> <code>{item.text}</code> <span>{item.note}</span></li>
        ))}
      </ul>
      {items.length > NOTES_MAX && <p className="cidr-more">and {items.length - NOTES_MAX} more</p>}
    </section>
  )
}

function describeAny(text: string) {
  const parsed = parseAny(text)
  if (!parsed.ok) return parsed
  return { ok: true as const, range: rangeOfAny(parsed.value), input: parsed.value }
}

export function Contains({ a, b, set }: { a: string; b: string; set: <K extends keyof State>(key: K, value: State[K]) => void }) {
  const left = useMemo(() => describeAny(a), [a])
  const right = useMemo(() => describeAny(b), [b])
  const result = left.ok && right.ok ? compareRanges(left.range, right.range) : null
  const span = (r: Range) => `${rangeText(r)} · ${formatCount(r.end - r.start + 1n)} ${plural(r.end - r.start + 1n, 'address', 'addresses')}`

  let verdict: ReactNode = null
  if (result && left.ok && right.ok) {
    switch (result.relation) {
      case 'equal': verdict = <><strong>Same range.</strong> A and B cover exactly the same addresses.</>; break
      case 'a-in-b': verdict = <><strong>A is inside B.</strong> All of A’s addresses are in B.</>; break
      case 'b-in-a': verdict = <><strong>A is not inside B</strong> — it is the other way round: B is inside A.</>; break
      case 'overlap': verdict = <><strong>They overlap</strong>, but neither contains the other.</>; break
      case 'disjoint': verdict = <><strong>No overlap.</strong> A and B share no addresses.</>; break
      case 'family': verdict = <><strong>Different address families.</strong> An IPv4 range never overlaps an IPv6 one.</>; break
    }
  }
  const mappedHint = result?.relation === 'family' && left.ok && right.ok
    ? [left, right].map((side, index) => side.range.family === 6 && side.range.start >> 32n === 0xffffn && side.range.end >> 32n === 0xffffn
      ? `${index ? 'B' : 'A'} is IPv4-mapped; its IPv4 form is ${rangeText({ family: 4, start: side.range.start & 0xffffffffn, end: side.range.end & 0xffffffffn })}.`
      : null).filter(Boolean)
    : []

  return (
    <div className="cidr-stack">
      <section className="cidr-box cidr-two">
        <div>
          <Field label="A" value={a} onChange={(v) => set('a', v)} invalid={!left.ok} placeholder="10.1.2.3 · 10.0.0.0/24 · 10.0.0.5 - 10.0.0.9" examples={['10.1.2.3', '192.168.1.0/25', '2001:db8:1::/48']} />
          {left.ok ? <p className="cidr-range-line">{span(left.range)}</p> : <p className="cidr-error">{left.error}</p>}
        </div>
        <div>
          <Field label="B" value={b} onChange={(v) => set('b', v)} invalid={!right.ok} placeholder="10.0.0.0/8" examples={['10.0.0.0/8', '192.168.1.64 - 192.168.1.200', '2001:db8::/32']} />
          {right.ok ? <p className="cidr-range-line">{span(right.range)}</p> : <p className="cidr-error">{right.error}</p>}
        </div>
      </section>
      <section className="cidr-box" aria-live="polite">
        {verdict ? <p className={`cidr-verdict-big${result?.relation === 'disjoint' || result?.relation === 'family' ? '' : ' cidr-yes'}`}>{verdict}</p> : <p className="cidr-help">Enter an address, CIDR or start - end range on each side.</p>}
        {result?.overlap && result.relation !== 'equal' && (
          <>
            <p className="cidr-range-line">Shared: {span(result.overlap)}</p>
            <p className="cidr-range-line">As CIDRs: {rangeToCidrs(result.overlap).map((n) => <code key={formatNet(n)}>{formatNet(n)}</code>)}</p>
          </>
        )}
        {mappedHint.map((hint) => <p key={hint} className="cidr-note">{hint}</p>)}
      </section>
    </div>
  )
}

export function RangeTab({ value, onChange, copy }: { value: string; onChange: (value: string) => void; copy: Copy }) {
  const parsed = useMemo(() => parseAny(value), [value])
  let body: ReactNode = null
  if (parsed.ok && parsed.value.kind === 'range') {
    const range = parsed.value.range
    const nets: Net[] = rangeToCidrs(range)
    const text = nets.map(formatNet).join('\n')
    body = (
      <>
        <p className="cidr-summary">
          <strong>{rangeText(range)} → {nets.length} {plural(nets.length, 'CIDR')}</strong>
          <span>{formatCount(range.end - range.start + 1n)} {plural(range.end - range.start + 1n, 'address', 'addresses')}</span>
          {nets.length === 1 && <span className="cidr-tag">exactly one block</span>}
        </p>
        <section className="cidr-box cidr-pane">
          <header className="cidr-table-head">
            <h2>Minimal CIDR list</h2>
            <button type="button" onClick={() => void copy(text, `${nets.length} ${plural(nets.length, 'CIDR')}`)}>
              <span className="material-symbols-outlined" aria-hidden>content_copy</span> Copy
            </button>
          </header>
          <ol className="cidr-cidr-list">{nets.map((n) => <li key={formatNet(n)}><code>{formatNet(n)}</code><small>{formatCount(sizeOf(n.family, n.prefix))}</small></li>)}</ol>
        </section>
        {parsed.value.notes.map((note) => <p key={note} className="cidr-note">{note}</p>)}
      </>
    )
  } else if (parsed.ok && parsed.value.kind === 'cidr') {
    const { net, hostBits } = toNet(parsed.value.input)
    const range: Range = { family: net.family, start: net.base, end: net.base + sizeOf(net.family, net.prefix) - 1n }
    const text = `${addrText(range.family, range.start)}-${addrText(range.family, range.end)}`
    body = (
      <>
        <p className="cidr-summary">
          <strong>{formatNet(net)} → {rangeText(range)}</strong>
          <span>{formatCount(sizeOf(net.family, net.prefix))} {plural(sizeOf(net.family, net.prefix), 'address', 'addresses')}</span>
          <CopyButton text={text} what="Range" copy={copy} />
        </p>
        {hostBits && <p className="cidr-note">Host bits are set; this is the range of its network {formatNet(net)}.</p>}
      </>
    )
  }
  return (
    <div className="cidr-stack">
      <section className="cidr-box">
        <Field label="Range or CIDR" value={value} onChange={onChange} invalid={!parsed.ok && value.trim() !== ''} placeholder="192.0.2.10 - 192.0.2.99 · 10.0.0.0/22" examples={['192.0.2.10 - 192.0.2.99', '10.0.0.0 - 10.0.3.255', '0.0.0.1 - 255.255.255.254', '2001:db8::1 - 2001:db8::ffff', '10.0.0.0/22']} />
        <small className="cidr-hint">A <code>start - end</code> range (hyphen, dash or “to”) becomes its fewest CIDR blocks; a CIDR becomes its range.</small>
      </section>
      <div aria-live="polite" className="cidr-status">{!parsed.ok && <p className="cidr-error">{parsed.error}</p>}</div>
      {body}
    </div>
  )
}
