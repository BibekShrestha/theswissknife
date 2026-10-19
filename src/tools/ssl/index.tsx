import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import { parseCsr, verifyCsr, type CsrInfo } from './csr'
import { fileToText, removeRanges, scanText } from './inputs'
import { finishKey, type KeyReport } from './keys'
import { fingerprints, sameKey, type Fingerprints, type PublicKey } from './spki'
import {
  addFingerprints,
  checkChain,
  hostnameCoverage,
  matchesHostname,
  normalizeHost,
  orderChain,
  parseCertificate,
  type CertificateInfo,
  type CertificateReport,
  type ChainReport,
  type SignatureCheck,
} from './x509'
import './ssl.css'

interface KeyItem { number: number; label: string; report: KeyReport; prints: Fingerprints }
interface CsrItem { number: number; label: string; csr: CsrInfo; check: SignatureCheck; prints: Fingerprints }

interface Analysis {
  chain: { certificates: CertificateInfo[]; report: ChainReport; leafPrints: Fingerprints } | null
  chainError: string
  csrs: CsrItem[]
  keys: KeyItem[]
  problems: { number: number; label: string; error: string }[]
  ignored: { number: number; label: string; reason: string }[]
  privateRanges: [number, number][]
}

const EMPTY_INPUT = 'Paste a PEM certificate, CSR or key (with its BEGIN and END lines), or an OpenSSH public key line'

function commonName(certificate: CertificateInfo): string | undefined {
  return certificate.subject.attributes.find((attribute) => attribute.name === 'CN')?.value
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function daysFromNow(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000)
}

function statusIcon(ok: boolean | null): string {
  return ok === true ? 'check_circle' : ok === false ? 'cancel' : 'help'
}

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

function StatusRow({ ok, title, detail }: { ok: boolean | null; title: string; detail: string }) {
  const tone = ok === true ? 'ok' : ok === false ? 'bad' : 'neutral'
  return (
    <li className={`ssl-check ${tone}`}>
      <span className="material-symbols-outlined" aria-hidden>{statusIcon(ok)}</span>
      <div><strong>{title}</strong><span>{detail}</span></div>
    </li>
  )
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return <div className="ssl-field"><dt>{label}</dt><dd className={mono ? 'mono' : ''}>{children}</dd></div>
}

function roleLabel(certificate: CertificateInfo, link: CertificateReport): string {
  if (link.role === 'leaf') return 'Leaf certificate'
  if (link.role === 'root') return 'Self-signed root'
  if (link.role === 'top') return 'Top of the supplied chain'
  return certificate.isCA ? 'Certificate authority' : 'Certificate'
}

function LinkStatus({ link, isLast }: { link: CertificateReport; isLast: boolean }) {
  const signature = link.signature
  if (!isLast && signature) {
    const tone = signature.ok === true ? 'ok' : signature.ok === false ? 'bad' : 'neutral'
    const label = signature.ok === true ? 'Signature valid' : signature.ok === false ? 'Not signed by next' : 'Not checked'
    return <span className={`ssl-chain-status ${tone}`} title={signature.reason}><span className="material-symbols-outlined" aria-hidden>{statusIcon(signature.ok)}</span>{label}</span>
  }
  return <span className="ssl-chain-status neutral"><span className="material-symbols-outlined" aria-hidden>account_tree</span>Trust not checked</span>
}

function CopyValue({ value, label, copy }: { value?: string; label: string; copy: (text: string, label: string) => unknown }) {
  if (!value) return <>Not available</>
  return <button className="ssl-copy-value" onClick={() => void copy(value, label)} aria-label={`Copy ${label}`}>{value}<span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
}

function PrintFields({ prints, copy }: { prints: Fingerprints; copy: (text: string, label: string) => unknown }) {
  return <>
    <Field label="SPKI pin (SHA-256, Base64)" mono><CopyValue value={prints.spkiPin} label="SPKI pin" copy={copy} /></Field>
    {prints.sshSha256 && <Field label="OpenSSH fingerprint" mono><CopyValue value={prints.sshSha256} label="OpenSSH SHA256 fingerprint" copy={copy} /></Field>}
    {prints.sshMd5 && <Field label="OpenSSH MD5 (legacy)" mono><CopyValue value={prints.sshMd5} label="OpenSSH MD5 fingerprint" copy={copy} /></Field>}
  </>
}

/** What else in the paste carries the same public key. */
function matchesFor(key: PublicKey | null, analysis: Analysis, self: string): { ok: boolean | null; text: string } {
  const certificates = analysis.chain?.certificates ?? []
  if (!key?.identity) return { ok: null, text: 'This key cannot be compared' }
  const certs = certificates.flatMap((certificate, index) => sameKey(key, certificate.publicKey) ? [`certificate ${index + 1} (${commonName(certificate) ?? certificate.subject.display})`] : [])
  const others = [
    ...analysis.csrs.filter((item) => `csr-${item.number}` !== self && sameKey(key, item.csr.publicKey)).map((item) => `CSR in block ${item.number}`),
    ...analysis.keys.filter((item) => `key-${item.number}` !== self && sameKey(key, item.report.publicKey)).map((item) => `key in block ${item.number}`),
  ]
  const all = [...certs, ...others]
  if (certificates.length && !certs.length) return { ok: false, text: `No supplied certificate has this public key${others.length ? ` (same key as the ${others.join(', ')})` : ''}` }
  if (!all.length) return { ok: null, text: 'Nothing else supplied uses this public key' }
  return { ok: true, text: `Same public key as ${all.join(', ')}` }
}

function KeyCard({ item, analysis, copy }: { item: KeyItem; analysis: Analysis; copy: (text: string, label: string) => unknown }) {
  const { report } = item
  const match = matchesFor(report.publicKey, analysis, `key-${item.number}`)
  return (
    <article className="ssl-card ssl-details ssl-item">
      <header><span className="material-symbols-outlined" aria-hidden>{report.kind === 'private' ? 'password' : 'fingerprint'}</span><strong>{report.kind === 'private' ? 'Private key' : 'Public key'}</strong><span>block {item.number} · {report.format}</span></header>
      <dl>
        <Field label="Key">{report.publicKey?.detail ?? report.algorithmHint ?? 'Unknown'}</Field>
        {report.encryption && <Field label="Encryption (not decrypted)">{report.encryption}</Field>}
        {report.comment && <Field label="Comment">{report.comment}</Field>}
        <Field label="Matches">{match.text}</Field>
        {report.publicKey ? <PrintFields prints={item.prints} copy={copy} /> : <Field label="Fingerprints">No public key in this file to fingerprint</Field>}
      </dl>
      {(report.warnings.length > 0 || report.notes.length > 0) && (
        <ul className="ssl-item-notes">
          {report.warnings.map((warning) => <li key={warning} className="bad">{warning}</li>)}
          {report.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
    </article>
  )
}

function CsrCard({ item, analysis, host, copy }: { item: CsrItem; analysis: Analysis; host: string; copy: (text: string, label: string) => unknown }) {
  const { csr, check } = item
  const ext = csr.extensions
  const match = matchesFor(csr.publicKey, analysis, `csr-${item.number}`)
  const target = normalizeHost(host)
  const rows = [
    { ok: check.ok, title: check.ok ? 'Proof of possession: signature valid' : check.ok === false ? 'Proof of possession failed' : 'Signature not checked', detail: check.ok ? 'Signed by the private key matching the request\'s public key' : check.reason },
    ...(target ? [{ ok: matchesHostname(target, ext?.sans ?? [], ext?.ipAddresses ?? []), title: `${matchesHostname(target, ext?.sans ?? [], ext?.ipAddresses ?? []) ? 'Requests' : 'Does not request'} ${target}`, detail: [...(ext?.sans ?? []), ...(ext?.ipAddresses ?? [])].join(', ') || 'No DNS or IP names requested' }] : []),
  ]
  return (
    <article className="ssl-card ssl-details ssl-item">
      <header><span className="material-symbols-outlined" aria-hidden>description</span><strong>Certificate request</strong><span>block {item.number} · {csr.signatureAlgorithm}</span></header>
      <ul className="ssl-item-checks">{rows.map((row) => <StatusRow key={row.title} {...row} />)}</ul>
      <dl>
        <Field label="Subject">{csr.subject.display || 'Empty subject'}</Field>
        <Field label="Public key">{csr.publicKey.detail}</Field>
        <Field label="DNS names">{ext?.sans.length ? ext.sans.join(', ') : 'None requested'}</Field>
        {ext && ext.ipAddresses.length > 0 && <Field label="IP addresses">{ext.ipAddresses.join(', ')}</Field>}
        {ext && ext.otherNames.length > 0 && <Field label="Other names">{ext.otherNames.join(', ')}</Field>}
        <Field label="Key usage">{ext?.keyUsage.length ? ext.keyUsage.join(', ') : 'Not requested'}</Field>
        <Field label="Extended use">{ext?.extendedKeyUsage.length ? ext.extendedKeyUsage.join(', ') : 'Not requested'}</Field>
        {ext?.basicConstraints && <Field label="Basic constraints">{ext.basicConstraints.ca ? `CA${ext.basicConstraints.pathLen !== undefined ? `, path length ${ext.basicConstraints.pathLen}` : ''}` : 'Not a CA'}</Field>}
        {ext && ext.others.length > 0 && <Field label="Other extensions">{ext.others.join(', ')}</Field>}
        {csr.attributes.length > 0 && <Field label="Attributes">{csr.attributes.join(', ')}</Field>}
        <Field label="Matches">{match.text}</Field>
        <PrintFields prints={item.prints} copy={copy} />
      </dl>
    </article>
  )
}

async function analyse(text: string): Promise<Analysis> {
  const scan = scanText(text)
  if (!scan.blocks.length) throw new Error(EMPTY_INPUT)
  const analysis: Analysis = { chain: null, chainError: '', csrs: [], keys: [], problems: [], ignored: [], privateRanges: scan.privateRanges }
  const certificates: Uint8Array[] = []
  await Promise.all(scan.blocks.map(async (block, index) => {
    const number = index + 1
    if (block.kind === 'certificate') certificates.push(block.der)
    else if (block.kind === 'ignored') analysis.ignored.push({ number, label: block.label, reason: block.reason })
    else if (block.kind === 'error') analysis.problems.push({ number, label: block.label, error: block.error })
    // narrowed by property, not by comparing kind to the quoted word, which
    // the icon-name scan would count as a Material Symbols ligature
    else if ('parsed' in block) {
      const report = await finishKey(block.parsed)
      analysis.keys.push({ number, label: block.label, report, prints: report.publicKey ? await fingerprints(report.publicKey) : {} })
    } else {
      try {
        const csr = parseCsr(block.der)
        analysis.csrs.push({ number, label: block.label, csr, check: await verifyCsr(csr), prints: await fingerprints(csr.publicKey) })
      } catch (cause) {
        analysis.problems.push({ number, label: block.label, error: errorText(cause, 'Could not read this CSR') })
      }
    }
  }))
  analysis.keys.sort((a, b) => a.number - b.number)
  analysis.csrs.sort((a, b) => a.number - b.number)
  analysis.problems.sort((a, b) => a.number - b.number)
  if (certificates.length) {
    try {
      const parsed = orderChain(certificates.map(parseCertificate))
      const chainCerts = await Promise.all(parsed.map(addFingerprints))
      const report = await checkChain(chainCerts, Date.now())
      analysis.chain = { certificates: chainCerts, report, leafPrints: await fingerprints(chainCerts[0].publicKey) }
    } catch (cause) {
      analysis.chainError = errorText(cause, 'Could not inspect this certificate')
    }
  }
  return analysis
}

export default function SslTool() {
  const [pem, setPem] = useState('')
  const [host, setHost] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast, showToast } = useToast()
  const copy = useCopy(showToast)

  const inspect = async (text: string) => {
    setBusy(true)
    setError('')
    try {
      setAnalysis(await analyse(text))
    } catch (cause) {
      setAnalysis(null)
      setError(errorText(cause, 'Could not inspect this input'))
    } finally {
      setBusy(false)
    }
  }

  const openFiles = async (files: File[]) => {
    if (!files.length) return
    try {
      const texts: string[] = []
      for (const file of files) texts.push(fileToText(new Uint8Array(await file.arrayBuffer())))
      // the textarea always shows what is being inspected, DER files included
      const text = texts.join('\n')
      setPem(text)
      await inspect(text)
    } catch (cause) {
      setAnalysis(null)
      setError(errorText(cause, 'Could not read the selected files'))
    }
  }

  const removePrivateKeys = () => {
    if (!analysis) return
    const text = removeRanges(pem, analysis.privateRanges)
    setPem(text)
    if (text.trim()) void inspect(text)
    else setAnalysis(null)
    showToast('Private keys removed from the input')
  }

  const chain = analysis?.chain ?? null
  const leaf = chain?.certificates[0]
  const report = chain?.report
  const coverage = leaf ? hostnameCoverage(leaf, host) : null
  const now = Date.now()
  const dateOk = leaf ? leaf.notBefore.getTime() <= now && leaf.notAfter.getTime() >= now : null
  const expiryDays = leaf ? daysFromNow(leaf.notAfter) : 0
  const privateKeys = analysis?.keys.filter((item) => item.report.kind === 'private') ?? []
  const comparablePrivate = privateKeys.filter((item) => item.report.publicKey?.identity)
  const keyMatch = leaf && comparablePrivate.length ? comparablePrivate.some((item) => sameKey(item.report.publicKey, leaf.publicKey)) : null
  const verdict = !leaf || !report ? 'bad'
    : !dateOk || coverage?.ok === false || report.status === 'bad' || keyMatch === false ? 'bad'
      : report.status === 'unchecked' ? 'partial' : 'ok'
  const pastedPrivate = Boolean(analysis?.privateRanges.length)

  const diagnostics = useMemo(() => {
    if (!leaf || !chain) return []
    const { certificates, report } = chain
    const rows: { ok: boolean | null; title: string; detail: string }[] = []
    rows.push({
      ok: dateOk,
      title: dateOk ? 'Certificate is currently valid' : leaf.notBefore.getTime() > now ? 'Certificate is not valid yet' : 'Certificate has expired',
      detail: dateOk
        ? `${expiryDays.toLocaleString()} day${expiryDays === 1 ? '' : 's'} until expiry`
        : leaf.notBefore.getTime() > now
          ? `Validity begins ${dateLabel(leaf.notBefore)}`
          : `Validity ended ${dateLabel(leaf.notAfter)}`,
    })
    if (coverage) rows.push({
      ok: coverage.ok,
      title: coverage.ok ? `Covers ${coverage.host}` : `Does not cover ${coverage.host}`,
      detail: coverage.detail,
    })
    if (keyMatch !== null) rows.push({
      ok: keyMatch,
      title: keyMatch ? 'Private key matches the leaf certificate' : 'No supplied private key matches the leaf certificate',
      detail: keyMatch ? 'The certificate\'s public key is the public half of the supplied private key' : 'The certificate was issued for a different key pair',
    })
    const problems = report.links.flatMap((link, index) => link.problems.map((problem) => `Certificate ${index + 1}: ${problem}`))
    const supplied = certificates.length > 1
    rows.push(
      report.status === 'bad'
        ? { ok: false, title: `${problems.length} problem${problems.length === 1 ? '' : 's'} in the supplied certificate${supplied ? 's' : ''}`, detail: problems.join(' · ') }
        : report.status === 'unchecked'
          ? { ok: null, title: 'Some signatures could not be checked', detail: report.links.flatMap((link, index) => link.signature?.ok === null ? [`Certificate ${index + 1}: ${link.signature.reason}`] : []).join(' · ') }
          : supplied
            ? { ok: true, title: 'Supplied chain checks pass', detail: `${certificates.length} certificates: signatures, names, CA flags, key usage, path length and validity of each issuer` }
            : { ok: null, title: 'No issuer chain supplied', detail: 'Add intermediate and root PEM blocks to check their links' },
    )
    rows.push({
      ok: null,
      title: 'Browser/OS trust is not evaluated',
      detail: 'Local JavaScript cannot read the device trust store or check live revocation status',
    })
    return rows
  }, [chain, coverage, dateOk, expiryDays, keyMatch, leaf, now])

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="ssl-app">
      <ToolHeader brand={<><span className="tool-mark-accent">TLS</span> certificate verifier</>} localLabel="100% local">
        <button onClick={() => fileRef.current?.click()} title="Open certificate, CSR or key files" aria-label="Open certificate, CSR or key files">
          <span className="material-symbols-outlined" aria-hidden>folder_open</span>
        </button>
        <input ref={fileRef} hidden type="file" multiple onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void openFiles(files)
        }} />
        <button onClick={() => { setPem(''); setHost(''); setAnalysis(null); setError('') }} disabled={!pem && !analysis} title="Clear" aria-label="Clear the input">
          <span className="material-symbols-outlined" aria-hidden>delete</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="ssl-main">
        <section className="ssl-intro">
          <div><span className="material-symbols-outlined" aria-hidden>encrypted</span></div>
          <div>
            <h2>Inspect certificates, CSRs and keys without uploading them</h2>
            <p>Check a certificate’s identity, expiry and supplied chain; read a CSR and verify its signature; see a key’s type, size and fingerprints, and whether it matches a certificate. Everything stays in this browser.</p>
          </div>
        </section>

        <section className="ssl-input-grid">
          <article className="ssl-card ssl-source">
            <header><span className="ssl-step">01</span><strong>Certificates, CSRs or keys</strong><span>PEM · DER · OpenSSH</span></header>
            <div className={`ssl-drop ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <textarea value={pem} onChange={(event) => setPem(event.target.value)} spellCheck={false} autoComplete="off" placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n\nPaste a chain (leaf first), a CSR, a key, or an ssh-ed25519 / ssh-rsa line. Mix them to check that a key matches its certificate.'} aria-label="Certificates, CSRs or keys" />
              {!pem && <button className="ssl-drop-hint" onClick={() => fileRef.current?.click()}><span className="material-symbols-outlined" aria-hidden>upload_file</span><strong>Drop files</strong><span>certificates, CSRs, keys — PEM, DER or OpenSSH</span></button>}
            </div>
          </article>

          <article className="ssl-card ssl-options">
            <header><span className="ssl-step">02</span><strong>Verification target</strong><span>optional</span></header>
            <div className="ssl-options-body">
              <label htmlFor="ssl-host">Hostname</label>
              <div className="ssl-host-row"><span className="material-symbols-outlined" aria-hidden>language</span><input id="ssl-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="www.example.com" autoCapitalize="none" spellCheck={false} /></div>
              <p>Compared against the certificate’s and any CSR’s Subject Alternative Names. No connection is made.</p>
              <button className="ssl-primary" onClick={() => void inspect(pem)} disabled={!pem.trim() || busy}>{busy ? 'Inspecting…' : 'Inspect'}</button>
              <div className="ssl-command">
                <span>Get a server chain locally</span>
                <code>openssl s_client -showcerts -connect example.com:443 -servername example.com</code>
                <button onClick={() => void copy('openssl s_client -showcerts -connect example.com:443 -servername example.com', 'OpenSSL command')} aria-label="Copy OpenSSL command"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
              </div>
            </div>
          </article>
        </section>

        {error && <div className="ssl-error" role="alert"><span className="material-symbols-outlined" aria-hidden>error</span><div><strong>Could not inspect the input</strong><span>{error}</span></div></div>}

        {analysis && (
          <section className="ssl-results" aria-live="polite">
            {pastedPrivate && (
              <div className="ssl-private" role="note">
                <span className="material-symbols-outlined" aria-hidden>warning</span>
                <div>
                  <strong>A private key was pasted</strong>
                  <span>It is read in this tab only — never uploaded, stored or put in the URL — and only its public half and protection are shown. If it was ever pasted anywhere else, treat it as exposed. Encrypted keys are not decrypted.</span>
                </div>
                <button onClick={removePrivateKeys}>Remove private keys from the input</button>
              </div>
            )}

            {analysis.problems.length > 0 && (
              <div className="ssl-error" role="alert">
                <span className="material-symbols-outlined" aria-hidden>error</span>
                <div>
                  <strong>{analysis.problems.length === 1 ? 'One block could not be read' : `${analysis.problems.length} blocks could not be read`}</strong>
                  {analysis.problems.map((problem) => <span key={problem.number}>Block {problem.number} ({problem.label}): {problem.error}</span>)}
                </div>
              </div>
            )}

            {analysis.chainError && <div className="ssl-error" role="alert"><span className="material-symbols-outlined" aria-hidden>error</span><div><strong>Could not inspect certificate</strong><span>{analysis.chainError}</span></div></div>}

            {leaf && chain && report && <>
              <article className={`ssl-verdict ${verdict}`}>
                <span className="material-symbols-outlined" aria-hidden>{verdict === 'ok' ? 'verified_user' : 'gpp_maybe'}</span>
                <div><strong>{verdict === 'ok' ? 'Local certificate checks passed' : verdict === 'partial' ? 'Some checks could not be completed' : 'Certificate needs attention'}</strong><span>{commonName(leaf) ?? leaf.subject.display}</span></div>
                <span className="ssl-expiry">{dateOk ? `${expiryDays} days left` : 'not currently valid'}</span>
              </article>

              <div className="ssl-result-grid">
                <article className="ssl-card ssl-diagnostics">
                  <header><strong>Verification summary</strong><span>{diagnostics.filter((row) => row.ok === true).length} passed</span></header>
                  <ul>{diagnostics.map((row) => <StatusRow key={row.title} {...row} />)}</ul>
                </article>

                <article className="ssl-card ssl-details">
                  <header><strong>Leaf certificate</strong><span>{leaf.signatureAlgorithm}</span></header>
                  <dl>
                    <Field label="Subject">{leaf.subject.display || 'Empty subject'}</Field>
                    <Field label="Issuer">{leaf.issuer.display || 'Empty issuer'}</Field>
                    <Field label="Valid from">{dateLabel(leaf.notBefore)}</Field>
                    <Field label="Valid until">{dateLabel(leaf.notAfter)}</Field>
                    <Field label="Public key">{leaf.publicKeyDetail}</Field>
                    <Field label="Serial" mono>{leaf.serialNumber}</Field>
                    <Field label="DNS names">{leaf.sans.length ? leaf.sans.join(', ') : 'None (browsers do not fall back to the Common Name)'}</Field>
                    {leaf.ipAddresses.length > 0 && <Field label="IP addresses">{leaf.ipAddresses.join(', ')}</Field>}
                    <Field label="Key usage">{leaf.keyUsage.length ? leaf.keyUsage.join(', ') : 'Not specified'}</Field>
                    <Field label="Extended use">{leaf.extendedKeyUsage.length ? leaf.extendedKeyUsage.join(', ') : 'Not specified'}</Field>
                    <Field label="SHA-256" mono><CopyValue value={leaf.sha256} label="SHA-256 fingerprint" copy={copy} /></Field>
                    <Field label="SHA-1" mono><CopyValue value={leaf.sha1} label="SHA-1 fingerprint" copy={copy} /></Field>
                    <Field label="SPKI pin (SHA-256, Base64)" mono><CopyValue value={chain.leafPrints.spkiPin} label="SPKI pin" copy={copy} /></Field>
                  </dl>
                </article>
              </div>

              <article className="ssl-card ssl-chain">
                <header><strong>Certificate chain</strong><span>{chain.certificates.length} certificate{chain.certificates.length === 1 ? '' : 's'}</span></header>
                <ol>
                  {chain.certificates.map((certificate, index) => {
                    const link = report.links[index]
                    const isLast = index === chain.certificates.length - 1
                    return <li key={`${certificate.serialNumber}-${index}`}>
                      <span className="ssl-chain-index">{index + 1}</span>
                      <div className="ssl-chain-name"><strong>{commonName(certificate) ?? certificate.subject.display}</strong><span>{roleLabel(certificate, link)}</span></div>
                      <span className="ssl-chain-key">{certificate.publicKeyDetail}</span>
                      <LinkStatus link={link} isLast={isLast} />
                      {(link.problems.length > 0 || link.notes.length > 0) && (
                        <ul className="ssl-chain-notes">
                          {link.problems.map((problem) => <li key={problem} className="bad">{problem}</li>)}
                          {link.notes.map((note) => <li key={note}>{note}</li>)}
                        </ul>
                      )}
                    </li>
                  })}
                </ol>
              </article>
            </>}

            {(analysis.csrs.length > 0 || analysis.keys.length > 0) && (
              <div className="ssl-items">
                {analysis.csrs.map((item) => <CsrCard key={`csr-${item.number}`} item={item} analysis={analysis} host={host} copy={copy} />)}
                {analysis.keys.map((item) => <KeyCard key={`key-${item.number}`} item={item} analysis={analysis} copy={copy} />)}
              </div>
            )}

            {analysis.ignored.length > 0 && (
              <aside className="ssl-limits"><span className="material-symbols-outlined" aria-hidden>info</span><p>{analysis.ignored.map((item) => `Block ${item.number} (${item.label}): ${item.reason}.`).join(' ')}</p></aside>
            )}

            {leaf && <aside className="ssl-limits"><span className="material-symbols-outlined" aria-hidden>info</span><p><strong>What this local check does not claim:</strong> it checks only the certificates you supplied — each link’s signature and issuer name, and that every issuer is a CA allowed to sign certificates (basicConstraints, keyUsage, path length) and valid today. It cannot query a server, enumerate TLS versions or ciphers, test vulnerabilities, fetch OCSP/CRLs, or consult your browser’s trust store, and it does not evaluate name constraints, policies or extended key usage along the chain. Wildcards are refused over a single-label suffix such as <code>*.com</code>; the Public Suffix List is not bundled, so <code>*.co.uk</code> is not caught. A chain that passes here links cryptographically; that does not by itself make its root trusted.</p></aside>}
            {(analysis.csrs.length > 0 || analysis.keys.length > 0) && <aside className="ssl-limits"><span className="material-symbols-outlined" aria-hidden>info</span><p><strong>About keys and CSRs:</strong> keys match when their public keys are equal, whatever the format. A CSR’s signature shows the requester held the matching private key; it says nothing about whether a CA will accept the request. Encrypted private keys are not decrypted, so an encrypted PKCS#8 or legacy PEM key cannot be fingerprinted or matched — OpenSSH keys can, because their public half is stored in the clear. Ed448, X448 and DSA public keys are not derived from a private key file that omits them.</p></aside>}
          </section>
        )}
      </main>
      <Toast message={toast} />
    </div>
  )
}
