import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";;
import { api, getConfig } from "../../api/client.js";
import { generateReportId, generateSecret, reporterWallet } from "../../crypto/secret.js";
import { digests, signWithWallet } from "../../crypto/signing.js";
import { useSession } from "../../context/Session.jsx";
import { Field, Notice, ErrorBanner, Busy } from "../../components/ui.jsx";
import { DURATIONS, SECTIONS, nowSeconds } from "../../constants.js";

const TABS = [
  { key: "report", label: "Report", optional: false },
  { key: "details", label: "Details", optional: true },
  { key: "evidence", label: "Evidence", optional: true },
  { key: "sharing", label: "Sharing", optional: false },
];
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/wav,audio/mp4";

export default function Report() {
  const navigate = useNavigate();
  const { setJustSubmitted, setReporter } = useSession();
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState(0);
  const [f, setF] = useState({ category: "", reportDate: "", area: "", description: "", details: "" });
  const [files, setFiles] = useState([]);
  const [choice, setChoice] = useState(null); // neither option pre-selected
  const [scope, setScope] = useState({ details: true, evidence: true });
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => { getConfig().then(setCfg).catch(setError); }, []);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const today = new Date().toISOString().slice(0, 10);

  const reportProblem = () => {
    if (!f.category) return "Choose what kind of incident this was.";
    if (!f.reportDate) return "Enter the date it happened.";
    if (f.reportDate > today) return "The date cannot be in the future.";
    if (f.description.trim().length < 10) return "Describe what happened in a few words.";
    return null;
  };

  const go = (i) => {
    if (i > 0 && reportProblem()) { setTab(0); setError(reportProblem()); return; }
    setError(null);
    setTab(i);
    window.scrollTo({ top: 0 });
  };

  async function submit(e) {
    e.preventDefault();
    const problem = reportProblem();
    if (problem) { setTab(0); setError(problem); return; }
    if (!choice) { setError("Choose how the GBV office should be told about this report."); return; }
    setError(null);
    try {
      // 1. The ID and secret are created here, in this browser. Neither identifies you.
      setBusy("Protecting your report");
      const reportId = generateReportId();
      const secret = generateSecret();
      const wallet = await reporterWallet(secret, reportId);

      // 2. The server removes identifying details it can find, encrypts each part and stores it.
      const form = new FormData();
      form.append("reportId", reportId);
      form.append("category", f.category);
      form.append("reportDate", f.reportDate);
      form.append("area", f.area);
      form.append("description", f.description);
      form.append("details", f.details);
      files.forEach((file) => form.append("evidence", file));
      const prep = await api("/reports/prepare", { method: "POST", form });

      // 3. Your key signs the stored items and your sharing choice. Only your key can change them later.
      setBusy("Recording your choice");
      const shareNow = choice === "share";
      let mask = SECTIONS.summary;
      if (shareNow && scope.details && f.details.trim()) mask |= SECTIONS.details;
      if (shareNow && scope.evidence && files.length) mask |= SECTIONS.evidence;
      const validUntil = nowSeconds() + days * 86400;
      const registerSignature = await signWithWallet(wallet, digests.register({
        registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, reporter: wallet.address, items: prep.items,
      }));
      const consentSignature = await signWithWallet(wallet, digests.createConsent({
        consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId,
        category: prep.category, reportDay: prep.reportDay, shareNow, scope: mask, validUntil,
      }));
      const result = await api(`/reports/${reportId}/commit`, {
        method: "POST",
        body: { reporterKey: wallet.address, registerSignature, consent: { shareNow, scope: mask, validUntil, signature: consentSignature } },
      });

      setReporter({ reportId, wallet }); // kept in memory only, cleared after 2 minutes idle
      setJustSubmitted({ reportId, secret, shareNow, removed: prep.anonymiser.removed, evidence: prep.evidence, transactions: result.transactions });
      setF({ category: "", reportDate: "", area: "", description: "", details: "" });
      setFiles([]);
      navigate("/submitted", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="narrow">
      <h1>Make a report</h1>
      <p>You do not need to give your name. Only the first and last steps are required.</p>

      <div className="steps" role="tablist" aria-label="Report steps">
        {TABS.map((t, i) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === i} aria-controls={`panel-${t.key}`} id={`tab-${t.key}`} onClick={() => go(i)}>
            <span className="num">{i + 1}</span> {t.label} {t.optional && <span className="opt">optional</span>}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} />

      <form onSubmit={submit} noValidate>
        {tab === 0 && (
          <section id="panel-report" role="tabpanel" aria-labelledby="tab-report">
            <Field id="category" label="What kind of incident was it?">
              <select id="category" value={f.category} onChange={set("category")} required>
                <option value="">Choose one</option>
                {cfg && Object.entries(cfg.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field id="date" label="When did it happen?" hint="The day is enough. If you are not sure, choose the closest day.">
              <input id="date" type="date" max={today} value={f.reportDate} onChange={set("reportDate")} required />
            </Field>
            <Field id="area" label="Where, in general?" hint="For example 'near the library' or 'a residence'. Leave out room numbers and names.">
              <input id="area" type="text" maxLength={200} value={f.area} onChange={set("area")} autoComplete="off" />
            </Field>
            <Field id="desc" label="What happened, in short?" hint="A few sentences is enough. Names, phone numbers and ID numbers are removed automatically, but the removal is not perfect, so please leave them out.">
              <textarea id="desc" maxLength={5000} value={f.description} onChange={set("description")} autoComplete="off" spellCheck />
            </Field>
                       <div className="actions">
              <button type="button" className="btn" onClick={() => go(1)}>Continue</button>
              <Link to="/" className="btn secondary">Back to start</Link>
            </div>
          </section>
        )}

        {tab === 1 && (
          <section id="panel-details" role="tabpanel" aria-labelledby="tab-details">
            <Notice kind="info"><p>Adding your full account is your choice. You can skip this, add it later from your report page, or withdraw it at any time.</p></Notice>
            <Field id="details" label="Your full account (optional)" hint="Anything you want the people you choose to know. Leave out names where you can.">
              <textarea id="details" style={{ minHeight: 240 }} maxLength={20000} value={f.details} onChange={set("details")} autoComplete="off" />
            </Field>
            <div className="actions">
              <button type="button" className="btn" onClick={() => go(2)}>Continue</button>
              <button type="button" className="btn secondary" onClick={() => go(0)}>Back</button>
            </div>
          </section>
        )}

        {tab === 2 && (
          <section id="panel-evidence" role="tabpanel" aria-labelledby="tab-evidence">
            <Notice kind="info"><p>Adding evidence is your choice. You can skip this, add it later, or withdraw it at any time.</p></Notice>
            <Field id="evidence" label="Photos, documents or audio (optional)"
              hint={`Up to ${cfg?.limits.maxEvidenceFiles ?? 5} files, ${cfg?.limits.maxEvidenceFileMb ?? 10} MB each. Allowed: JPEG, PNG, WebP, PDF, MP3, WAV, M4A. Location and camera details are removed from photos.`}>
              <input id="evidence" type="file" multiple accept={ACCEPT} onChange={(e) => setFiles([...e.target.files].slice(0, cfg?.limits.maxEvidenceFiles ?? 5))} />
            </Field>
            {files.length > 0 && (
              <ul className="list" aria-label="Chosen files">
                {files.map((file, i) => (
                  <li key={i} className="row">
                    <span>File {i + 1} <span className="meta">({Math.ceil(file.size / 1024)} KB)</span></span>
                    <button type="button" className="linkbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <Notice kind="caution"><p>Faces, voices, handwriting and documents can identify people. The system cannot hide these. Only add what you are comfortable sharing with the people you choose.</p></Notice>
            <div className="actions">
              <button type="button" className="btn" onClick={() => go(3)}>Continue</button>
              <button type="button" className="btn secondary" onClick={() => go(1)}>Back</button>
            </div>
          </section>
        )}

        {tab === 3 && (
          <section id="panel-sharing" role="tabpanel" aria-labelledby="tab-sharing">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="legend">How should the GBV office be told?</legend>
              <p className="small">Either way, the office is told that a report was made, with only its category and date. Nothing else is shared unless you allow it.</p>
              <label className="choice">
                <input type="radio" name="choice" value="share" checked={choice === "share"} onChange={() => setChoice("share")} />
                <span><strong>Share this report with the office now</strong>You can take access back at any time.</span>
              </label>
              <label className="choice">
                <input type="radio" name="choice" value="alert" checked={choice === "alert"} onChange={() => setChoice("alert")} />
                <span><strong>Alert only. I will decide when they ask</strong>The office can ask to read it. You approve or deny each request from your report page.</span>
              </label>
            </fieldset>

            {choice === "share" && (
              <div className="panel">
                <p className="legend">What the office may read</p>
                <div className="checks">
                  <label><input type="checkbox" checked disabled /> Report</label>
                  <label><input type="checkbox" disabled={!f.details.trim()} checked={scope.details && !!f.details.trim()} onChange={(e) => setScope((s) => ({ ...s, details: e.target.checked }))} /> Full details</label>
                  <label><input type="checkbox" disabled={!files.length} checked={scope.evidence && files.length > 0} onChange={(e) => setScope((s) => ({ ...s, evidence: e.target.checked }))} /> Evidence</label>
                </div>
                <Field id="days" label="For how long?">
                  <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
                  </select>
                </Field>
              </div>
            )}

            <Notice kind="caution">
              <p>On the next screen you will get a report ID and a secret. They are the only way back to this report. They cannot be recovered if lost, because nothing links the report to you.</p>
            </Notice>
            <div className="actions">
              <button type="submit" className="btn" disabled={!!busy || !cfg}>Send report</button>
              <button type="button" className="btn secondary" onClick={() => go(2)} disabled={!!busy}>Back</button>
              {busy && <Busy label={busy} />}
            </div>
          </section>
        )}
      </form>
    </div>
  );
}
