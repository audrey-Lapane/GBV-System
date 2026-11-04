import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../../context/Session.jsx";
import { Notice } from "../../components/ui.jsx";

const LABELS = { email: "email address", id_number: "ID number", phone: "phone number", number: "long number", name: "name", address: "street address", room: "room number" };

export default function Submitted() {
  const { justSubmitted, setJustSubmitted, setReporter } = useSession();
  const [copied, setCopied] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  if (!justSubmitted) return <Navigate to="/" replace />;
  const { reportId, secret, shareNow, removed, evidence } = justSubmitted;
  const removedList = Object.entries(removed || {}).map(([k, n]) => `${n} ${LABELS[k] || k}${n > 1 ? "s" : ""}`);

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(""); }
  };

  return (
    <div className="narrow">
      <h1>Your report has been sent</h1>
      <p>{shareNow ? "The GBV office has been told and can read the parts you chose, until the date you set." : "The GBV office has been told that a report was made. They cannot read it unless you approve their request."}</p>

      <section className="keycard" aria-labelledby="key-h">
        <h2 id="key-h">Your secret</h2>
        <div className="secret" aria-label={`Secret: ${secret.split("").join(" ")}`}>
          {secret.split("-").map((g, i) => <span key={i}>{g}</span>)}
        </div>
        <h2>Your report ID</h2>
        <div className="rid">{reportId}</div>
        <div className="actions">
          <button type="button" className="btn secondary small" onClick={() => copy(secret, "secret")}>{copied === "secret" ? "Secret copied" : "Copy secret"}</button>
          <button type="button" className="btn secondary small" onClick={() => copy(reportId, "id")}>{copied === "id" ? "ID copied" : "Copy report ID"}</button>
        </div>
      </section>

      <Notice kind="caution" title="These are shown only once">
        <p>Write them down somewhere only you can reach. Do not photograph them or save them on a shared phone or computer. If you lose them, nobody can recover your report for you.</p>
      </Notice>

      {removedList.length > 0 && (
        <Notice kind="info"><p>Before your report was stored, we removed: {removedList.join(", ")}. Check your report page if you want to see what was kept.</p></Notice>
      )}
      {evidence?.length > 0 && (
        <Notice kind="info"><p>{evidence.length} evidence file{evidence.length > 1 ? "s were" : " was"} stored. {evidence.some((e) => e.metadataStripped) && "Location and camera details were removed from photos."}</p></Notice>
      )}

      <label className="choice" style={{ marginTop: "1.5rem" }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span><strong>I have kept my secret and report ID safe</strong></span>
      </label>
      <div className="actions">
        <Link to="/my" className="btn" aria-disabled={!confirmed} onClick={(e) => { if (!confirmed) e.preventDefault(); else setJustSubmitted(null); }}>
          Go to my report
        </Link>
        <Link to="/" className="btn secondary" onClick={(e) => { if (!confirmed) e.preventDefault(); else { setJustSubmitted(null); setReporter(null); } }} aria-disabled={!confirmed}>
          Done
        </Link>
      </div>
    </div>
  );
}
