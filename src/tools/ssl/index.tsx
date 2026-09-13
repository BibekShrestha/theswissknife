import { useMemo, useRef, useState, type DragEvent } from 'react'
import { ToolHeader } from '../../shell/ToolHeader'
import { useCopy } from '../../shell/useCopy'
import { useToast } from '../../shell/useToast'
import {
  addFingerprints,
  decodeCertificates,
  matchesHostname,
  normalizeHost,
  orderChain,
  parseCertificate,
  verifyIssuedBy,
  type CertificateInfo,
} from './x509'
import './ssl.css'

type SignatureState = boolean | null

interface Analysis {
  certificates: CertificateInfo[]
  signatures: SignatureState[]
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
      const signatures = await Promise.all(certificates.slice(0, -1).map((certificate, index) => verifyIssuedBy(certificate, certificates[index + 1])))
      setAnalysis({ certificates, signatures })
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
    const pemParts: string[] = []
    try {
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const source = new TextDecoder().decode(bytes)
        if (source.includes('-----BEGIN CERTIFICATE-----')) {
          pemParts.push(source)
          ders.push(...decodeCertificates(source))
        } else {
          ders.push(bytes)
        }
      }
      if (pemParts.length) setPem(pemParts.join('\n'))
      await inspectDer(ders)
    } catch (cause) {
      setAnalysis(null)
      setError(cause instanceof Error ? cause.message : 'Could not read the selected certificate files')
    }
  }

  const leaf = analysis?.certificates[0]
  const normalizedHost = normalizeHost(host)
  const names = leaf ? (leaf.sans.length ? leaf.sans : [commonName(leaf)].filter((value): value is string => Boolean(value))) : []
  const hostnameOk = leaf && normalizedHost ? matchesHostname(normalizedHost, names, leaf.ipAddresses) : null
  const now = Date.now()
  const dateOk = leaf ? leaf.notBefore.getTime() <= now && leaf.notAfter.getTime() >= now : null
  const expiryDays = leaf ? daysFromNow(leaf.notAfter) : 0
  const chainOk = analysis && analysis.signatures.length ? analysis.signatures.every((result) => result === true) : null
  const selfSigned = leaf?.subject.display === leaf?.issuer.display
  const overallOk = Boolean(leaf && dateOk && hostnameOk !== false && chainOk !== false)

  const diagnostics = useMemo(() => {
    if (!leaf) return []
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
    if (normalizedHost) rows.push({
      ok: hostnameOk,
      title: hostnameOk ? `Covers ${normalizedHost}` : `Does not cover ${normalizedHost}`,
      detail: names.length || leaf.ipAddresses.length ? [...names, ...leaf.ipAddresses].join(', ') : 'No DNS or IP names found',
    })
    rows.push({
      ok: chainOk,
      title: analysis && analysis.certificates.length > 1 ? (chainOk ? 'Provided chain signatures verify' : chainOk === false ? 'A chain signature is invalid' : 'Some signature algorithms could not be checked') : 'No issuer chain supplied',
      detail: analysis && analysis.certificates.length > 1 ? `${analysis.certificates.length} certificates supplied, leaf first` : 'Add intermediate and root PEM blocks to verify their links',
    })
    rows.push({
      ok: null,
      title: 'Browser/OS trust is not evaluated',
      detail: 'Local JavaScript cannot read the device trust store or check live revocation status',
    })
    return rows
  }, [analysis, chainOk, dateOk, expiryDays, hostnameOk, leaf, names, normalizedHost, now])

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void openFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div className="ssl-app">
      <ToolHeader brand={<><span className="tool-mark-accent">TLS</span> certificate verifier</>} localLabel="100% local">
        <button onClick={() => fileRef.current?.click()} title="Open PEM, CRT, CER, or DER files" aria-label="Open certificate files">
          <span className="material-symbols-outlined">folder_open</span>
        </button>
        <input ref={fileRef} hidden type="file" multiple accept=".pem,.crt,.cer,.der,application/x-x509-ca-cert" onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void openFiles(files)
        }} />
        <button onClick={() => { setPem(''); setHost(''); setAnalysis(null); setError('') }} disabled={!pem && !analysis} title="Clear" aria-label="Clear certificates">
          <span className="material-symbols-outlined">delete</span>
        </button>
      </ToolHeader>

      <main id="main-content" className="ssl-main">
        <section className="ssl-intro">
          <div><span className="material-symbols-outlined" aria-hidden>encrypted</span></div>
          <div>
            <h1>Inspect an X.509 certificate without uploading it</h1>
            <p>Check identity, expiry, key details, fingerprints, and the signatures linking a supplied chain. Your certificates and hostname stay in this browser.</p>
          </div>
        </section>

        <section className="ssl-input-grid">
          <article className="ssl-card ssl-source">
            <header><span className="ssl-step">01</span><strong>Certificate or chain</strong><span>PEM · DER</span></header>
            <div className={`ssl-drop ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <textarea value={pem} onChange={(event) => setPem(event.target.value)} spellCheck={false} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----\n\nPaste leaf first, followed by intermediates and the root.'} aria-label="PEM certificate or chain" />
              {!pem && <button className="ssl-drop-hint" onClick={() => fileRef.current?.click()}><span className="material-symbols-outlined">upload_file</span><strong>Drop certificate files</strong><span>or choose PEM, CRT, CER, or DER</span></button>}
            </div>
          </article>

          <article className="ssl-card ssl-options">
            <header><span className="ssl-step">02</span><strong>Verification target</strong><span>optional</span></header>
            <div className="ssl-options-body">
              <label htmlFor="ssl-host">Hostname</label>
              <div className="ssl-host-row"><span className="material-symbols-outlined">language</span><input id="ssl-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="www.example.com" autoCapitalize="none" spellCheck={false} /></div>
              <p>Used only to compare against Subject Alternative Names. No connection is made.</p>
              <button className="ssl-primary" onClick={inspectPem} disabled={!pem.trim() || busy}>{busy ? 'Inspecting…' : 'Inspect certificate'}</button>
              <div className="ssl-command">
                <span>Get a server chain locally</span>
                <code>openssl s_client -showcerts -connect example.com:443 -servername example.com</code>
                <button onClick={() => void copy('openssl s_client -showcerts -connect example.com:443 -servername example.com', 'OpenSSL command')} aria-label="Copy OpenSSL command"><span className="material-symbols-outlined">content_copy</span></button>
              </div>
            </div>
          </article>
        </section>

        {error && <div className="ssl-error" role="alert"><span className="material-symbols-outlined">error</span><div><strong>Could not inspect certificate</strong><span>{error}</span></div></div>}

        {leaf && analysis && (
          <section className="ssl-results" aria-live="polite">
            <article className={`ssl-verdict ${overallOk ? 'ok' : 'bad'}`}>
              <span className="material-symbols-outlined">{overallOk ? 'verified_user' : 'gpp_maybe'}</span>
              <div><strong>{overallOk ? 'Local certificate checks passed' : 'Certificate needs attention'}</strong><span>{commonName(leaf) ?? leaf.subject.display}</span></div>
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
                  <Field label="DNS names">{leaf.sans.length ? leaf.sans.join(', ') : 'None (Common Name fallback only)'}</Field>
                  {leaf.ipAddresses.length > 0 && <Field label="IP addresses">{leaf.ipAddresses.join(', ')}</Field>}
                  <Field label="Key usage">{leaf.keyUsage.length ? leaf.keyUsage.join(', ') : 'Not specified'}</Field>
                  <Field label="Extended use">{leaf.extendedKeyUsage.length ? leaf.extendedKeyUsage.join(', ') : 'Not specified'}</Field>
                  <Field label="SHA-256" mono><button className="ssl-copy-value" onClick={() => void copy(leaf.sha256 ?? '', 'SHA-256 fingerprint')}>{leaf.sha256}<span className="material-symbols-outlined">content_copy</span></button></Field>
                  <Field label="SHA-1" mono><button className="ssl-copy-value" onClick={() => void copy(leaf.sha1 ?? '', 'SHA-1 fingerprint')}>{leaf.sha1}<span className="material-symbols-outlined">content_copy</span></button></Field>
                </dl>
              </article>
            </div>

            <article className="ssl-card ssl-chain">
              <header><strong>Certificate chain</strong><span>{analysis.certificates.length} certificate{analysis.certificates.length === 1 ? '' : 's'}</span></header>
              <ol>
                {analysis.certificates.map((certificate, index) => {
                  const signature = index < analysis.signatures.length ? analysis.signatures[index] : null
                  const isRoot = index === analysis.certificates.length - 1
                  return <li key={`${certificate.serialNumber}-${index}`}>
                    <span className="ssl-chain-index">{index + 1}</span>
                    <div className="ssl-chain-name"><strong>{commonName(certificate) ?? certificate.subject.display}</strong><span>{index === 0 ? 'Leaf certificate' : isRoot && certificate.subject.display === certificate.issuer.display ? 'Self-signed root' : certificate.isCA ? 'Certificate authority' : 'Certificate'}</span></div>
                    <span className="ssl-chain-key">{certificate.publicKeyDetail}</span>
                    {!isRoot && <span className={`ssl-chain-status ${signature === true ? 'ok' : signature === false ? 'bad' : 'neutral'}`}><span className="material-symbols-outlined">{statusIcon(signature)}</span>{signature === true ? 'Signature valid' : signature === false ? 'Invalid signature' : 'Not checked'}</span>}
                    {isRoot && <span className="ssl-chain-status neutral"><span className="material-symbols-outlined">{selfSigned && analysis.certificates.length === 1 ? 'info' : 'account_tree'}</span>Trust not checked</span>}
                  </li>
                })}
              </ol>
            </article>

            <aside className="ssl-limits"><span className="material-symbols-outlined">info</span><p><strong>What this local check does not claim:</strong> it cannot query a server for its certificate, enumerate TLS versions or ciphers, test vulnerabilities, fetch OCSP/CRLs, or consult your browser’s private trust store. A verified chain signature proves that the supplied certificates link cryptographically; it does not by itself make the root trusted.</p></aside>
          </section>
        )}
      </main>
      {toast && <div className="shell-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
