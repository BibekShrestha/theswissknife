import { useMemo, useRef, useState, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { Toast } from '../../shell/Toast'
import { useToast } from '../../shell/useToast'
import {
  addFingerprints,
  certificatesFromBytes,
  checkChain,
  decodeCertificates,
  hostnameCoverage,
  orderChain,
  parseCertificate,
  toPem,
  type CertificateInfo,
  type CertificateReport,
  type ChainReport,
} from './x509'
import './ssl.css'

interface Analysis {
  certificates: CertificateInfo[]
  report: ChainReport
}

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

function StatusRow({ ok, title, detail }: { ok: boolean | null; title: string; detail: string }) {
  const tone = ok === true ? 'ok' : ok === false ? 'bad' : 'neutral'
  return (
    <li className={`ssl-check ${tone}`}>
      <span className="material-symbols-outlined" aria-hidden>{statusIcon(ok)}</span>
      <div><strong>{title}</strong><span>{detail}</span></div>
    </li>
  )
}

function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
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

  const inspectDer = async (ders: Uint8Array[]) => {
    setBusy(true)
    setError('')
    try {
      const parsed = orderChain(ders.map(parseCertificate))
      const certificates = await Promise.all(parsed.map(addFingerprints))
      const report = await checkChain(certificates, Date.now())
      setAnalysis({ certificates, report })
    } catch (cause) {
      setAnalysis(null)
      setError(cause instanceof Error ? cause.message : 'Could not inspect this certificate')
    } finally {
      setBusy(false)
    }
  }

  const inspectPem = () => {
    try {
      void inspectDer(decodeCertificates(pem))
    } catch (cause) {
      setAnalysis(null)
      setError(cause instanceof Error ? cause.message : 'Could not read the PEM certificate')
    }
  }

  const openFiles = async (files: File[]) => {
    if (!files.length) return
    const ders: Uint8Array[] = []
    try {
      for (const file of files) ders.push(...certificatesFromBytes(new Uint8Array(await file.arrayBuffer())))
      // the textarea always shows what is being inspected, DER files included
      setPem(ders.map(toPem).join('\n'))
      await inspectDer(ders)
    } catch (cause) {
      setAnalysis(null)
      setError(cause instanceof Error ? cause.message : 'Could not read the selected certificate files')
    }
  }

  const leaf = analysis?.certificates[0]
  const report = analysis?.report
  const coverage = leaf ? hostnameCoverage(leaf, host) : null
  const now = Date.now()
  const dateOk = leaf ? leaf.notBefore.getTime() <= now && leaf.notAfter.getTime() >= now : null
  const expiryDays = leaf ? daysFromNow(leaf.notAfter) : 0
  const verdict = !leaf || !report ? 'bad'
    : !dateOk || coverage?.ok === false || report.status === 'bad' ? 'bad'
      : report.status === 'unchecked' ? 'partial' : 'ok'

  const diagnostics = useMemo(() => {
    if (!leaf || !analysis) return []
    const { certificates, report } = analysis
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
  }, [analysis, coverage, dateOk, expiryDays, leaf, now])

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="ssl-app">
      <ToolHeader brand={<><span className="tool-mark-accent">TLS</span> certificate verifier</>} localLabel="100% local">
        <button onClick={() => fileRef.current?.click()} title="Open PEM, CRT, CER, or DER files" aria-label="Open certificate files">
          <span className="material-symbols-outlined" aria-hidden>folder_open</span>
        </button>
        <input ref={fileRef} hidden type="file" multiple accept=".pem,.crt,.cer,.der,application/x-x509-ca-cert" onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void openFiles(files)
        }} />
        <button onClick={() => { setPem(''); setHost(''); setAnalysis(null); setError('') }} disabled={!pem && !analysis} title="Clear" aria-label="Clear certificates">
          <span className="material-symbols-outlined" aria-hidden>delete</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="ssl-main">
        <section className="ssl-intro">
          <div><span className="material-symbols-outlined" aria-hidden>encrypted</span></div>
          <div>
            <h2>Inspect an X.509 certificate without uploading it</h2>
            <p>Check identity, expiry, key details, fingerprints, and the signatures linking a supplied chain. Your certificates and hostname stay in this browser.</p>
          </div>
        </section>

        <section className="ssl-input-grid">
          <article className="ssl-card ssl-source">
            <header><span className="ssl-step">01</span><strong>Certificate or chain</strong><span>PEM · DER</span></header>
            <div className={`ssl-drop ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <textarea value={pem} onChange={(event) => setPem(event.target.value)} spellCheck={false} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n\nPaste leaf first, followed by intermediates and the root.'} aria-label="PEM certificate or chain" />
              {!pem && <button className="ssl-drop-hint" onClick={() => fileRef.current?.click()}><span className="material-symbols-outlined" aria-hidden>upload_file</span><strong>Drop certificate files</strong><span>or choose PEM, CRT, CER, or DER</span></button>}
            </div>
          </article>

          <article className="ssl-card ssl-options">
            <header><span className="ssl-step">02</span><strong>Verification target</strong><span>optional</span></header>
            <div className="ssl-options-body">
              <label htmlFor="ssl-host">Hostname</label>
              <div className="ssl-host-row"><span className="material-symbols-outlined" aria-hidden>language</span><input id="ssl-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="www.example.com" autoCapitalize="none" spellCheck={false} /></div>
              <p>Used only to compare against Subject Alternative Names. No connection is made.</p>
              <button className="ssl-primary" onClick={inspectPem} disabled={!pem.trim() || busy}>{busy ? 'Inspecting…' : 'Inspect certificate'}</button>
              <div className="ssl-command">
                <span>Get a server chain locally</span>
                <code>openssl s_client -showcerts -connect example.com:443 -servername example.com</code>
                <button onClick={() => void copy('openssl s_client -showcerts -connect example.com:443 -servername example.com', 'OpenSSL command')} aria-label="Copy OpenSSL command"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button>
              </div>
            </div>
          </article>
        </section>

        {error && <div className="ssl-error" role="alert"><span className="material-symbols-outlined" aria-hidden>error</span><div><strong>Could not inspect certificate</strong><span>{error}</span></div></div>}

        {leaf && analysis && (
          <section className="ssl-results" aria-live="polite">
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
                  <Field label="SHA-256" mono><button className="ssl-copy-value" onClick={() => void copy(leaf.sha256 ?? '', 'SHA-256 fingerprint')}>{leaf.sha256}<span className="material-symbols-outlined" aria-hidden>content_copy</span></button></Field>
                  <Field label="SHA-1" mono><button className="ssl-copy-value" onClick={() => void copy(leaf.sha1 ?? '', 'SHA-1 fingerprint')}>{leaf.sha1}<span className="material-symbols-outlined" aria-hidden>content_copy</span></button></Field>
                </dl>
              </article>
            </div>

            <article className="ssl-card ssl-chain">
              <header><strong>Certificate chain</strong><span>{analysis.certificates.length} certificate{analysis.certificates.length === 1 ? '' : 's'}</span></header>
              <ol>
                {analysis.certificates.map((certificate, index) => {
                  const link = analysis.report.links[index]
                  const isLast = index === analysis.certificates.length - 1
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

            <aside className="ssl-limits"><span className="material-symbols-outlined" aria-hidden>info</span><p><strong>What this local check does not claim:</strong> it checks only the certificates you supplied — each link’s signature and issuer name, and that every issuer is a CA allowed to sign certificates (basicConstraints, keyUsage, path length) and valid today. It cannot query a server, enumerate TLS versions or ciphers, test vulnerabilities, fetch OCSP/CRLs, or consult your browser’s trust store, and it does not evaluate name constraints, policies or extended key usage along the chain. Wildcards are refused over a single-label suffix such as <code>*.com</code>; the Public Suffix List is not bundled, so <code>*.co.uk</code> is not caught. A chain that passes here links cryptographically; that does not by itself make its root trusted.</p></aside>
          </section>
        )}
      </main>
      <Toast message={toast} />
    </div>
  )
}
