import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getConfig } from "../../api/client.js";
import { isValidReportId, isValidSecret, reporterWallet } from "../../crypto/secret.js";
import { digests, readProof, signWithWallet } from "../../crypto/signing.js";
import { useSession } from "../../context/Session.jsx";
import { Field, Notice, ErrorBanner, Busy, Tx, formatDay, formatTime } from "../../components/ui.jsx";
import { ACTION_LABEL, DURATIONS, ROLE_LABEL, SECTIONS, SECTION_LABEL, nowSeconds, sectionNames } from "../../constants.js";

// ---------------------------------------------------------------- open with ID and secret

function OpenForm() {
  const { setReporter, idleNotice } = useSession();
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function open(e) {
    e.preventDefault();
    if (!isValidReportId(id)) return setError("The report ID should start with 0x and have 64 more letters and numbers.");
    if (!isValidSecret(secret)) return setError("The secret should have 30 letters and numbers, in six groups of five.");
    setBusy(true);
    setError(null);
    try {
      const cfg = await getConfig();
      const reportId = id.trim().toLowerCase();
      const wallet = await reporterWallet(secret, reportId);
      await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await readProof(wallet, cfg, reportId) } });
      setReporter({ reportId, wallet });
      setSecret("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Open my report</h1>
      {idleNotice && <Notice kind="info"><p>Your report was closed because the page was not used for two minutes. Enter your details again to continue.</p></Notice>}
      <p>Enter the report ID and secret you were given when you made the report.</p>
      <ErrorBanner error={error} />
      <form onSubmit={open} noValidate>
        <Field id="rid" label="Report ID">
          <input id="rid" type="text" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" />
        </Field>
        <Field id="secret" label="Secret" hint="Capitals, spaces and dashes do not matter.">
          <input id="secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy}>Open report</button>
          {busy && <Busy label="Checking" />}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- portal

export default function Portal() {
  const { reporter } = useSession();
  if (!reporter) return <OpenForm />;
  return <ReporterPortal />;
}

function ReporterPortal() {
  const { reporter, setReporter } = useSession();
  const { reportId, wallet } = reporter;
  const [cfg, setCfg] = useState(null);
  const [ov, setOv] = useState(null);
  const [view, setView] = useState("sharing");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const c = await getConfig();
    setCfg(c);
    setOv(await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await readProof(wallet, c, reportId) } }));
  }, [reportId, wallet]);

  useEffect(() => { load().catch(setError); }, [load]);

  /** Runs a signed action, then reloads. */
  const act = async (label, fn, done) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await fn();
      await load();
      setMessage(done);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  const grant = (role, scope, days, requestId) =>
    act("Giving access", async () => {
      const validUntil = nowSeconds() + days * 86400;
      const nonce = ov.nonces.consent;
      const signature = await signWithWallet(wallet, digests.grant({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, role, scope, validUntil, nonce }));
      await api(`/consent/${reportId}/grant`, { method: "POST", body: { role, scope, validUntil, nonce, signature, requestId } });
    }, `${ROLE_LABEL[role]} can now read: ${sectionNames(scope)}, for ${days} days.`);

  const revoke = (role) =>
    act("Taking access back", async () => {
      const nonce = ov.nonces.consent;
      const signature = await signWithWallet(wallet, digests.revoke({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, role, nonce }));
      await api(`/consent/${reportId}/revoke`, { method: "POST", body: { role, nonce, signature } });
    }, `Access taken back from ${ROLE_LABEL[role]}. Their next attempt will be refused.`);

  const deny = (requestId) =>
    act("Denying", async () => {
      await api(`/consent/${reportId}/deny`, { method: "POST", body: { requestId, proof: await readProof(wallet, cfg, reportId) } });
    }, "Request denied. Nothing was shared.");

  if (!ov) {
    return <div className="narrow">{error ? <ErrorBanner error={error} /> : <Busy label="Opening your report" />}</div>;
  }

  const withdrawn = ov.status === "withdrawn";
  const pending = ov.requests.filter((r) => r.decision === "pending");
  const views = [
    ["sharing", "Who can read it"],
    ["requests", `Requests${pending.length ? ` (${pending.length})` : ""}`],
    ["history", "History"],
    ["add", "Add more"],
    ["withdraw", "Withdraw"],
  ];

  return (
    <div className="narrow">
      <div className="row" style={{ alignItems: "baseline" }}>
        <h1>My report</h1>
        <button type="button" className="linkbtn" onClick={() => setReporter(null)}>Close report</button>
      </div>
      <p className="meta">
        {cfg?.categories[ov.category] ?? "Report"}{ov.reportDate ? `, ${new Date(ov.reportDate + "T00:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}` : ""}
        {withdrawn && <> <span className="pill deny">Withdrawn</span></>}
      </p>

      <div className="subnav" role="group" aria-label="Report sections">
        {views.map(([k, label]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setMessage(null); load().catch(setError); }}>{label}</button>)}
      </div>

      <ErrorBanner error={error} />
      {message && <Notice kind="ok"><p>{message}</p></Notice>}
      {busy && <p><Busy label={busy} /></p>}

      {view === "sharing" && <Sharing ov={ov} withdrawn={withdrawn} busy={!!busy} onGrant={grant} onRevoke={revoke} />}
      {view === "requests" && <Requests ov={ov} busy={!!busy} onApprove={grant} onDeny={deny} />}
      {view === "history" && <History ov={ov} />}
      {view === "add" && <AddMore ov={ov} cfg={cfg} wallet={wallet} reportId={reportId} withdrawn={withdrawn} onDone={async (msg) => { await load(); setMessage(msg); }} />}
      {view === "withdraw" && <Withdraw ov={ov} cfg={cfg} wallet={wallet} reportId={reportId} withdrawn={withdrawn} act={act} />}
    </div>
  );
}

function ScopePicker({ items, value, onChange, idPrefix }) {
  const present = new Set(items.filter((i) => i.active).map((i) => SECTIONS[i.section]));
  return (
    <div className="checks" role="group" aria-label="Parts they may read">
      {[1, 2, 4].map((bit) => (
        <label key={bit} htmlFor={`${idPrefix}-${bit}`}>
          <input id={`${idPrefix}-${bit}`} type="checkbox" disabled={bit === 1 || !present.has(bit)} checked={(value & bit) === bit}
            onChange={(e) => onChange(e.target.checked ? value | bit : value & ~bit)} />
          {SECTION_LABEL[bit]}{!present.has(bit) && bit !== 1 ? " (not added)" : ""}
        </label>
      ))}
    </div>
  );
}

function Sharing({ ov, withdrawn, busy, onGrant, onRevoke }) {
  const [role, setRole] = useState("");
  const [scope, setScope] = useState(1);
  const [days, setDays] = useState(30);
  const active = Object.entries(ov.consent).filter(([, c]) => c.status === "granted" && c.validUntil > nowSeconds());
  return (
    <>
      <h2>Who can read your report now</h2>
      {active.length === 0 ? (
        <p>Nobody. Staff can ask, and you decide.</p>
      ) : (
        <ul className="list">
          {active.map(([r, c]) => (
            <li key={r} className="row">
              <span><strong>{ROLE_LABEL[r]}</strong><br /><span className="meta">{sectionNames(c.scope)}, until {formatDay(c.validUntil)}</span></span>
              <button type="button" className="btn danger" disabled={busy} onClick={() => onRevoke(Number(r))}>Take back access</button>
            </li>
          ))}
        </ul>
      )}
      {!withdrawn && (
        <div className="panel" style={{ marginTop: "2rem" }}>
          <h3>Give access to someone</h3>
          <Field id="grant-role" label="Who">
            <select id="grant-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Choose a role</option>
              {[1, 2, 3, 4].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </Field>
          <p className="legend">What they may read</p>
          <ScopePicker items={ov.items} value={scope} onChange={setScope} idPrefix="grant" />
          <Field id="grant-days" label="For how long">
            <select id="grant-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
            </select>
          </Field>
          <button type="button" className="btn" disabled={busy || !role} onClick={() => onGrant(Number(role), scope, days)}>Give access</button>
        </div>
      )}
    </>
  );
}

function Requests({ ov, busy, onApprove, onDeny }) {
  const [choice, setChoice] = useState({});
  const pending = ov.requests.filter((r) => r.decision === "pending");
  const decided = ov.requests.filter((r) => r.decision !== "pending");
  const roleId = (key) => ({ gbv_office: 1, legal: 2, health: 3, social_worker: 4 })[key];
  return (
    <>
      <h2>Requests to read your report</h2>
      {pending.length === 0 && <p>No requests are waiting for you.</p>}
      <ul className="list">
        {pending.map((r) => {
          const c = choice[r.id] ?? { scope: r.sections | 1, days: 30 };
          const setC = (patch) => setChoice((s) => ({ ...s, [r.id]: { ...c, ...patch } }));
          return (
            <li key={r.id}>
              <p><strong>{ROLE_LABEL[roleId(r.role)]}</strong> asked to read: {sectionNames(r.sections)}<br />
                <span className="meta">Asked on {new Date(r.day + "T00:00:00Z").toLocaleDateString("en-ZA")}. Staff reference <code>{r.staffRef.slice(0, 10)}…</code></span></p>
              <ScopePicker items={ov.items} value={c.scope} onChange={(scope) => setC({ scope })} idPrefix={`req-${r.id}`} />
              <Field id={`req-days-${r.id}`} label="For how long">
                <select id={`req-days-${r.id}`} value={c.days} onChange={(e) => setC({ days: Number(e.target.value) })}>
                  {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
                </select>
              </Field>
              <div className="actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => onApprove(roleId(r.role), c.scope, c.days, r.id)}>Approve</button>
                <button type="button" className="btn secondary" disabled={busy} onClick={() => onDeny(r.id)}>Deny</button>
              </div>
            </li>
          );
        })}
      </ul>
      {decided.length > 0 && (
        <>
          <h3 style={{ marginTop: "2rem" }}>Earlier requests</h3>
          <ul className="list">
            {decided.map((r) => (
              <li key={r.id} className="row">
                <span>{ROLE_LABEL[roleId(r.role)]}: {sectionNames(r.sections)}</span>
                <span className={`pill ${r.decision === "approved" ? "ok" : "muted"}`}>{r.decision === "approved" ? "Approved" : "Denied"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function History({ ov }) {
  return (
    <>
      <h2>Everything that has happened to your report</h2>
      <p className="small">Every entry is recorded permanently and cannot be changed or hidden by anyone, including the system's operators. Each has a transaction reference you can check.</p>
      <ol className="timeline">
        {ov.history.map((h, i) => {
          const isAttempt = h.action === "access_attempt";
          return (
            <li key={`${h.txHash}-${i}`} className={isAttempt ? (h.permitted ? "ok" : "deny") : ""}>
              <strong>{ACTION_LABEL[h.action] ?? h.action}</strong>
              {isAttempt && <> <span className={`pill ${h.permitted ? "ok" : "deny"}`}>{h.permitted ? "Allowed" : "Refused"}</span></>}
              <div className="meta">
                {formatTime(h.time)}
                {h.role ? `. ${ROLE_LABEL[h.role]}` : ""}
                {h.sections && h.action !== "item_added" ? `: ${sectionNames(h.sections)}` : ""}
                {h.action === "item_added" && h.sections ? `. ${SECTION_LABEL[h.sections]}` : ""}
                {h.action === "consent_granted" && h.validUntil ? `, until ${formatDay(h.validUntil)}` : ""}
              </div>
              <div className="meta">
                {h.staffRef && !/^0x0+$/.test(h.staffRef) && <>Staff reference <code>{h.staffRef.slice(0, 10)}…</code>. </>}
                Transaction <Tx hash={h.txHash} />
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function AddMore({ ov, cfg, wallet, reportId, withdrawn, onDone }) {
  const [section, setSection] = useState("details");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (withdrawn) return <p>This report has been withdrawn, so nothing can be added.</p>;

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("section", section);
      form.append("proof", JSON.stringify(await readProof(wallet, cfg, reportId)));
      if (section === "details") form.append("details", details);
      else files.forEach((f) => form.append("evidence", f));
      const prep = await api(`/reports/${reportId}/items/prepare`, { method: "POST", form });
      const signature = await signWithWallet(wallet, digests.addItem({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, item: prep.item, nonce: prep.nonce }));
      await api(`/reports/${reportId}/items/commit`, { method: "POST", body: { nonce: prep.nonce, signature } });
      setDetails("");
      setFiles([]);
      await onDone(section === "details" ? "Your details were added. Nobody can read them unless you give access." : "Your evidence was added. Nobody can read it unless you give access.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} noValidate>
      <h2>Add details or evidence</h2>
      <p>What you add is stored as a new part. Earlier parts are never changed. Adding something does not share it: you choose who can read each part.</p>
      <ErrorBanner error={error} />
      <div className="subnav" role="group" aria-label="What to add">
        <button type="button" aria-pressed={section === "details"} onClick={() => setSection("details")}>Full details</button>
        <button type="button" aria-pressed={section === "evidence"} onClick={() => setSection("evidence")}>Evidence</button>
      </div>
      {section === "details" ? (
        <Field id="more-details" label="Your account" hint="Names, phone numbers and ID numbers are removed automatically, but not perfectly.">
          <textarea id="more-details" style={{ minHeight: 220 }} maxLength={20000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field id="more-files" label="Files" hint={`Up to ${cfg.limits.maxEvidenceFiles} files, ${cfg.limits.maxEvidenceFileMb} MB each: photos, PDF documents or audio. Location and camera details are removed from photos.`}>
            <input id="more-files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/wav,audio/mp4" onChange={(e) => setFiles([...e.target.files])} />
          </Field>
          <Notice kind="caution"><p>Faces, voices and documents can identify people. The system cannot hide these.</p></Notice>
        </>
      )}
      <div className="actions">
        <button className="btn" type="submit" disabled={busy || (section === "details" ? !details.trim() : !files.length)}>Add to my report</button>
        {busy && <Busy label="Protecting and storing" />}
      </div>
      <p className="meta" style={{ marginTop: "1.5rem" }}>Parts stored so far: {ov.items.filter((i) => i.active).map((i) => SECTION_LABEL[SECTIONS[i.section]]).join(", ") || "none"}</p>
    </form>
  );
}

function Withdraw({ ov, cfg, wallet, reportId, withdrawn, act }) {
  const [confirm, setConfirm] = useState(false);
  if (withdrawn) {
    return <Notice kind="info"><p>This report has been withdrawn. Its encryption keys were destroyed, so its contents can no longer be read by anyone. The history of who accessed it remains.</p></Notice>;
  }
  const withdrawItem = (index) =>
    act("Withdrawing", async () => {
      const nonce = ov.nonces.registry;
      const signature = await signWithWallet(wallet, digests.withdrawItem({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, index, nonce }));
      await api(`/reports/${reportId}/items/withdraw`, { method: "POST", body: { index, nonce, signature } });
    }, "That part was withdrawn and can no longer be read.");
  const withdrawAll = () =>
    act("Withdrawing your report", async () => {
      const nonce = ov.nonces.registry;
      const signature = await signWithWallet(wallet, digests.withdrawReport({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, nonce }));
      await api(`/reports/${reportId}/withdraw`, { method: "POST", body: { nonce, signature } });
    }, "Your report was withdrawn. Its contents can no longer be read by anyone.");

  const optional = ov.items.filter((i) => i.active && i.section !== "summary");
  return (
    <>
      <h2>Withdraw</h2>
      {optional.length > 0 && (
        <>
          <p>Withdraw one part. It becomes unreadable for everyone, including people you gave access to.</p>
          <ul className="list">
            {optional.map((i) => (
              <li key={i.index} className="row">
                <span>{SECTION_LABEL[SECTIONS[i.section]]} <span className="meta">added {formatDay(i.addedAt)}</span></span>
                <button type="button" className="btn danger small" onClick={() => withdrawItem(i.index)}>Withdraw this part</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="panel" style={{ marginTop: "2rem" }}>
        <h3>Withdraw the whole report</h3>
        <p>All access ends, and the encryption keys are destroyed, so the report can no longer be read by anyone. This cannot be undone. Anything someone read or copied before now cannot be taken back.</p>
        <label className="choice">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          <span>I understand this cannot be undone</span>
        </label>
        <button type="button" className="btn danger" disabled={!confirm} onClick={withdrawAll}>Withdraw my report</button>
      </div>
      <p className="footer-links"><Link to="/">Back to start</Link></p>
    </>
  );
}

