import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client.js";
import { useSession } from "../../context/Session.jsx";
import { Field, Notice, ErrorBanner, Busy, useAsync } from "../../components/ui.jsx";
import { ROLE_KEY_LABEL } from "../../constants.js";
import { isValidReportId } from "../../crypto/secret.js";
import { short } from "../../crypto/staffWallet.js";

export default function Dashboard() {
  const { staff } = useSession();
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [error, setError] = useState(null);
  const isOffice = staff.user.role === "gbv_office";

  const go = (e) => {
    e.preventDefault();
    if (!isValidReportId(id)) return setError("A report ID starts with 0x followed by 64 letters and numbers.");
    navigate(`/staff/report/${id.trim().toLowerCase()}`);
  };

  return (
    <div className="wide">
      <h1>Reports</h1>
      <p className="meta">
        Signed in as {staff.user.name}, {ROLE_KEY_LABEL[staff.user.role]}. Bound wallet {staff.user.wallet ? <code>{short(staff.user.wallet)}</code> : "none"}.
      </p>
      {staff.notice && <Notice kind="info"><p>{staff.notice}</p></Notice>}

      <div className="split">
        <section>
          {isOffice ? <Alerts /> : (
            <>
              <h2>Your reports</h2>
              <p>Reports are not listed for your role. A reporter, or the GBV office, gives you the report ID when your help is needed. You can then request access, and the reporter decides.</p>
            </>
          )}
        </section>
        <section>
          <h2>Find a report</h2>
          <ErrorBanner error={error} />
          <form onSubmit={go}>
            <Field id="find" label="Report ID"><input id="find" type="text" value={id} onChange={(e) => setId(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /></Field>
            <button className="btn" type="submit">Open</button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Alerts() {
  const { staff } = useSession();
  const { data, error, loading, reload } = useAsync(() => api("/notifications", { token: staff.token }), []);
  const markSeen = async (nid) => { await api(`/notifications/${nid}/seen`, { method: "POST", token: staff.token }); reload(); };
  return (
    <>
      <div className="row"><h2 style={{ margin: 0 }}>Alerts</h2><button type="button" className="linkbtn" onClick={reload}>Refresh</button></div>
      <p className="small">An alert tells you a report was made. It shows only its ID, category and date. To read it, request access; the reporter decides.</p>
      <ErrorBanner error={error} />
      {loading && <Busy label="Loading alerts" />}
      {data && data.alerts.length === 0 && <p>No alerts yet.</p>}
      {data && (
        <ul className="list">
          {data.alerts.map((a) => (
            <li key={a.id}>
              <div className="row">
                <strong>{a.categoryLabel}</strong>
                <span className={`pill ${a.reportStatus === "withdrawn" ? "muted" : a.status === "new" ? "caution" : "muted"}`}>
                  {a.reportStatus === "withdrawn" ? "Withdrawn" : a.status === "new" ? "New" : a.status === "seen" ? "Seen" : "Requested"}
                </span>
              </div>
              <div className="meta">Date of incident {new Date(a.reportDate + "T00:00:00Z").toLocaleDateString("en-ZA")}. ID <code>{a.reportId.slice(0, 12)}…</code></div>
              <div className="actions" style={{ marginTop: "0.5rem" }}>
                {a.reportStatus !== "withdrawn" && <Link className="btn small" to={`/staff/report/${a.reportId}`} onClick={() => a.status === "new" && markSeen(a.id)}>Request or open</Link>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
