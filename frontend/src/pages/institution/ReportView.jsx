import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getConfig } from "../../api/client.js";
import { digests } from "../../crypto/signing.js";
import { signAsBoundWallet, short } from "../../crypto/staffWallet.js";
import { useSession } from "../../context/Session.jsx";
import { Notice, ErrorBanner, Busy, Tx, useAsync, formatTime } from "../../components/ui.jsx";
import { ROLE_LABEL, SECTION_LABEL, sectionNames } from "../../constants.js";

export default function ReportView() {
  const { id } = useParams();
  const { staff } = useSession();
  const [sections, setSections] = useState(1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { kind: 'requested'|'denied'|'opened', ... }
  const log = useAsync(() => api(`/audit/report/${id}`, { token: staff.token }), [id, result]);

  async function signed(kind) {
    setBusy(kind === "request" ? "Sign the request in MetaMask" : "Sign in MetaMask to open");
    setError(null);
    setResult(null);
    try {
      const cfg = await getConfig();
      const n = await api("/access/nonces", { token: staff.token });
      if (kind === "request") {
        const digest = digests.requestAccess({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId: id, scope: sections, nonce: n.requestNonce });
        const signature = await signAsBoundWallet(staff.user.wallet, digest);
        setBusy("Sending request");
        const r = await api(`/access/${id}/request`, { method: "POST", token: staff.token, body: { scope: sections, nonce: n.requestNonce, signature } });
        setResult({ kind: "requested", tx: r.transaction, message: r.message });
      } else {
        const digest = digests.access({ audit: cfg.contracts.AuditTrail, chainId: cfg.chainId, reportId: id, sections, nonce: n.accessNonce });
        const signature = await signAsBoundWallet(staff.user.wallet, digest);
        setBusy("Checking consent on the blockchain");
        try {
          const r = await api(`/access/${id}/open`, { method: "POST", token: staff.token, body: { sections, nonce: n.accessNonce, signature } });
          setResult({ kind: "opened", tx: r.transaction, items: r.items });
        } catch (e) {
          if (e.status === 403 && e.data?.permitted === false) setResult({ kind: "denied", tx: e.data.transaction, message: e.data.error });
          else throw e;
        }
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="wide">
      <p><Link to="/staff" className="back">Back to reports</Link></p>
      <h1>Report</h1>
      <p className="meta">ID <code>{id}</code></p>

      <div className="panel">
        <p className="legend">Parts of the report</p>
        <div className="checks" role="group" aria-label="Parts">
          {[1, 2, 4].map((bit) => (
            <label key={bit}>
              <input type="checkbox" checked={(sections & bit) === bit} disabled={bit === 1} onChange={(e) => setSections(e.target.checked ? sections | bit : sections & ~bit)} />
              {SECTION_LABEL[bit]}
            </label>
          ))}
        </div>
        <p className="small">Ask only for what you need. Opening is recorded whether or not it is allowed.</p>
        <div className="actions">
          <button type="button" className="btn" disabled={!!busy} onClick={() => signed("open")}>Open report</button>
          <button type="button" className="btn secondary" disabled={!!busy} onClick={() => signed("request")}>Request access</button>
          {busy && <Busy label={busy} />}
        </div>
      </div>

      <ErrorBanner error={error} />
      {result?.kind === "requested" && <Notice kind="ok"><p>{result.message}</p><p className="meta">Transaction <Tx hash={result.tx} /></p></Notice>}
      {result?.kind === "denied" && (
        <Notice kind="deny" title="Access denied">
          <p>{result.message}</p>
          <p className="meta">Recorded in transaction <Tx hash={result.tx} /></p>
        </Notice>
      )}
      {result?.kind === "opened" && <Opened items={result.items} tx={result.tx} />}

      <section style={{ marginTop: "2rem" }}>
        <h2>Access record</h2>
        <p className="small">Every attempt to open this report, from the blockchain. The reporter sees the same record.</p>
        {log.data && log.data.entries.length === 0 && <p>No attempts yet.</p>}
        {log.data && log.data.entries.length > 0 && (
          <div className="table-wrap">
            <table className="stacked">
              <thead><tr><th>When</th><th>Role</th><th>Staff reference</th><th>Parts</th><th>Result</th></tr></thead>
              <tbody>
                {[...log.data.entries].reverse().map((e, i) => (
                  <tr key={i}>
                    <td data-label="When">{formatTime(e.time)}</td>
                    <td data-label="Role">{ROLE_LABEL[e.role]}</td>
                    <td data-label="Staff reference"><code>{/^0x0+$/.test(e.staffRef) ? short(e.actor) : e.staffRef.slice(0, 10) + "…"}</code></td>
                    <td data-label="Parts">{sectionNames(e.sections)}</td>
                    <td data-label="Result"><span className={`pill ${e.permitted ? "ok" : "deny"}`}>{e.permitted ? "Allowed" : "Refused"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Opened({ items, tx }) {
  return (
    <section>
      <Notice kind="ok"><p>Access allowed by the reporter's consent. This opening is recorded in transaction <Tx hash={tx} />. Do not copy or forward the content outside your role.</p></Notice>
      {items.length === 0 && <p>The permitted parts have not been added by the reporter.</p>}
      {items.map((it) => (
        <article key={it.index} className="panel">
          <div className="row">
            <h2 style={{ margin: 0 }}>{{ summary: "Report", details: "Full details", evidence: "Evidence" }[it.section]}</h2>
            <span className={`pill ${it.integrity.matchesChain ? "ok" : "deny"}`}>{it.integrity.matchesChain ? "Unchanged since submission" : "Integrity check failed"}</span>
          </div>
          <p className="meta">SHA-256 <code>{it.integrity.computedHash.slice(0, 18)}…</code> checked against the blockchain record.</p>
          {it.error && <Notice kind="deny"><p>{it.error}</p></Notice>}
          {it.content && it.section === "summary" && (
            <dl>
              <dt className="legend">Date</dt><dd>{it.content.reportDate}</dd>
              <dt className="legend">General area</dt><dd>{it.content.area || "Not given"}</dd>
              <dt className="legend">What happened</dt><dd><div className="content-block">{it.content.description}</div></dd>
            </dl>
          )}
          {it.content && it.section === "details" && <div className="content-block">{it.content.text}</div>}
          {it.content && it.section === "evidence" && <EvidenceFiles files={it.content.files} />}
        </article>
      ))}
    </section>
  );
}

function EvidenceFiles({ files }) {
  const urls = useMemo(
    () => files.map((f) => URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: f.mime }))),
    [files]
  );
  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);
  return (
    <ul className="list">
      {files.map((f, i) => (
        <li key={i}>
          <div className="row"><strong>{f.name}</strong><span className="meta">{Math.ceil(f.size / 1024)} KB{f.metadataStripped ? ", metadata removed" : ""}</span></div>
          {f.mime.startsWith("image/") && <img className="evidence-img" src={urls[i]} alt={`Evidence file ${i + 1}`} />}
          {f.mime.startsWith("audio/") && <audio controls src={urls[i]} style={{ width: "100%" }} />}
          {f.mime === "application/pdf" && <a href={urls[i]} download={f.name}>Download {f.name}</a>}
        </li>
      ))}
    </ul>
  );
}
