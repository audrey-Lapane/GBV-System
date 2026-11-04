import { useState } from "react";
import { api, getConfig } from "../../api/client.js";
import { digests } from "../../crypto/signing.js";
import { signAsBoundWallet, short } from "../../crypto/staffWallet.js";
import { useSession } from "../../context/Session.jsx";
import { Field, Notice, ErrorBanner, Busy, Tx, useAsync } from "../../components/ui.jsx";
import { ROLE_KEY_LABEL } from "../../constants.js";

export default function Admin() {
  const [view, setView] = useState("approvals");
  const views = [["approvals", "Approvals"], ["accounts", "Accounts"], ["stats", "Statistics"], ["audit", "Audit check"], ["lookup", "Staff lookup"]];
  return (
    <div className="wide">
      <h1>Administration</h1>
      <p className="small">Administrators manage accounts and see counts. There is no way to read report content from here.</p>
      <div className="subnav" role="group" aria-label="Administration sections">
        {views.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {view === "approvals" && <Accounts status="pending" />}
      {view === "accounts" && <Accounts status="approved" />}
      {view === "stats" && <Stats />}
      {view === "audit" && <AuditCheck />}
      {view === "lookup" && <Lookup />}
    </div>
  );
}

function Accounts({ status }) {
  const { staff } = useSession();
  const list = useAsync(() => api(`/admin/users?status=${status}`, { token: staff.token }), [status]);
  const [wallets, setWallets] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function approve(u) {
    const walletAddress = (wallets[u.id] ?? u.requestedWallet ?? "").trim();
    setBusy(u.id); setError(null); setDone(null);
    try {
      const cfg = await getConfig();
      const prep = await api(`/admin/users/${u.id}/approve-prepare`, { method: "POST", token: staff.token, body: { walletAddress } });
      const digest = digests.registerInstitution({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, account: prep.account, role: prep.role, staffRef: prep.staffRef, nonce: prep.nonce });
      const signature = await signAsBoundWallet(staff.user.wallet, digest);
      const r = await api(`/admin/users/${u.id}/approve`, { method: "POST", token: staff.token, body: { walletAddress, nonce: prep.nonce, signature } });
      setDone({ text: `${u.name} approved and bound to ${short(walletAddress)}.`, tx: r.transaction });
      list.reload();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  async function suspend(u) {
    setBusy(u.id); setError(null); setDone(null);
    try {
      const cfg = await getConfig();
      const { nonce } = await api("/admin/admin-nonce", { token: staff.token });
      const digest = digests.deactivateInstitution({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, account: u.wallet, nonce });
      const signature = await signAsBoundWallet(staff.user.wallet, digest);
      const r = await api(`/admin/users/${u.id}/suspend`, { method: "POST", token: staff.token, body: { nonce, signature } });
      setDone({ text: `${u.name} suspended. Their wallet can no longer request or open reports.`, tx: r.transaction });
      list.reload();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }

  return (
    <section>
      <h2>{status === "pending" ? "Accounts waiting for approval" : "Approved accounts"}</h2>
      {status === "pending" && <p className="small">Check each person against the institution's staff records before approving. Approving binds the account to one wallet on the blockchain, signed with your MetaMask.</p>}
      <ErrorBanner error={error || list.error} />
      {done && <Notice kind="ok"><p>{done.text}</p><p className="meta">Transaction <Tx hash={done.tx} /></p></Notice>}
      {list.loading && <Busy label="Loading" />}
      {list.data && list.data.users.length === 0 && <p>{status === "pending" ? "No accounts are waiting." : "No approved accounts yet."}</p>}
      <ul className="list">
        {list.data?.users.map((u) => (
          <li key={u.id}>
            <div className="row">
              <span><strong>{u.name}</strong> <span className="meta">{u.staffNumber}, {ROLE_KEY_LABEL[u.role]}, {u.email}</span></span>
              <span className="meta">Registered {u.registeredOn}</span>
            </div>
            {status === "pending" ? (
              <div className="row" style={{ marginTop: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 320px" }}>
                  <label className="sr-only" htmlFor={`w-${u.id}`}>Wallet address for {u.name}</label>
                  <input id={`w-${u.id}`} type="text" placeholder="Wallet address 0x…" spellCheck={false}
                    value={wallets[u.id] ?? u.requestedWallet ?? ""} onChange={(e) => setWallets((s) => ({ ...s, [u.id]: e.target.value }))} />
                </div>
                <button type="button" className="btn" disabled={busy === u.id} onClick={() => approve(u)}>Approve and bind wallet</button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: "0.5rem" }}>
                <span className="meta">Wallet <code>{short(u.wallet)}</code>. Staff reference <code>{u.staffRef?.slice(0, 10)}…</code></span>
                <button type="button" className="btn danger small" disabled={busy === u.id} onClick={() => suspend(u)}>Suspend</button>
              </div>
            )}
            {busy === u.id && <Busy label="Waiting for your MetaMask signature" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stats() {
  const { staff } = useSession();
  const s = useAsync(() => api("/admin/stats", { token: staff.token }), []);
  const cfg = useAsync(() => getConfig(), []);
  if (s.error) return <ErrorBanner error={s.error} />;
  if (!s.data) return <Busy label="Loading" />;
  const d = s.data;
  const tiles = [
    ["Reports", d.reports], ["Withdrawn", d.withdrawn], ["Alerts", d.alerts], ["Access requests", d.accessRequests],
    ["Openings allowed", d.accessPermitted], ["Openings refused", d.accessDenied], ["Access given", d.consentGrants], ["Access taken back", d.consentRevocations],
  ];
  return (
    <section>
      <h2>Statistics</h2>
      <div className="stats">{tiles.map(([l, v]) => <div key={l} className="stat"><b>{v}</b><span>{l}</span></div>)}</div>
      <div className="split">
        <div>
          <h3>Reports by category</h3>
          <table><tbody>{d.byCategory.map((c) => <tr key={c.category}><td>{cfg.data?.categories[c.category]}</td><td>{c.n}</td></tr>)}</tbody></table>
        </div>
        <div>
          <h3>Staff accounts</h3>
          <table><tbody>{d.staff.map((c) => <tr key={c.status}><td>{c.status}</td><td>{c.n}</td></tr>)}</tbody></table>
          <p className="meta" style={{ marginTop: "1rem" }}>Chain {d.chain.chainId}, block {d.chain.block}</p>
        </div>
      </div>
    </section>
  );
}

function AuditCheck() {
  const { staff } = useSession();
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { setR(await api("/admin/reconcile", { token: staff.token })); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <section>
      <h2>Audit check</h2>
      <p>Compares the database's copy of the access record with the blockchain. The blockchain cannot be edited, so any difference means the database copy was changed or missed an event.</p>
      <button type="button" className="btn" onClick={run} disabled={busy}>Run audit check</button> {busy && <Busy label="Comparing" />}
      <ErrorBanner error={error} />
      {r && (
        <div style={{ marginTop: "1.5rem" }}>
          <Notice kind={r.ok ? "ok" : "deny"} title={r.ok ? "The database matches the blockchain" : `${r.mismatches.length} difference${r.mismatches.length === 1 ? "" : "s"} found`}>
            <p>{r.reports} reports, {r.chainEvents} blockchain events, {r.mirrorRows} database rows. Checked {new Date(r.checkedAt).toLocaleString("en-ZA")}.</p>
          </Notice>
          {r.mismatches.length > 0 && (
            <div className="table-wrap"><table className="stacked">
              <thead><tr><th>Report</th><th>Transaction</th><th>Problem</th><th>Blockchain</th><th>Database</th></tr></thead>
              <tbody>{r.mismatches.map((m, i) => (
                <tr key={i}><td data-label="Report"><code>{m.reportId.slice(0, 10)}…</code></td><td data-label="Transaction"><Tx hash={m.txHash} /></td><td data-label="Problem">{m.problem}</td><td data-label="Blockchain">{String(m.chain ?? "")}</td><td data-label="Database">{String(m.mirror ?? "")}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}

function Lookup() {
  const { staff } = useSession();
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const lookups = useAsync(() => api("/admin/lookups", { token: staff.token }), [found]);
  const submit = async (e) => {
    e.preventDefault(); setError(null); setFound(null);
    try { setFound(await api("/admin/staff-lookup", { method: "POST", token: staff.token, body: { staffRef: ref.trim(), reason } })); } catch (err) { setError(err); }
  };
  return (
    <section>
      <h2>Find who a staff reference belongs to</h2>
      <p>Use this only when investigating an access, for example a complaint. Every lookup is recorded with your staff number and reason.</p>
      <ErrorBanner error={error} />
      <form onSubmit={submit}>
        <Field id="ref" label="Staff reference"><input id="ref" type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="0x…" spellCheck={false} /></Field>
        <Field id="reason" label="Reason"><input id="reason" type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn" type="submit">Look up and record</button>
      </form>
      {found && <Notice kind="info"><p><strong>{found.name}</strong>, staff number {found.staffNumber}, {ROLE_KEY_LABEL[found.role]} ({found.status}).</p></Notice>}
      <h3 style={{ marginTop: "2rem" }}>Lookup record</h3>
      {lookups.data && (
        <div className="table-wrap"><table className="stacked">
          <thead><tr><th>When</th><th>By</th><th>Staff reference</th><th>Reason</th></tr></thead>
          <tbody>{lookups.data.lookups.map((l) => <tr key={l.id}><td data-label="When">{l.at}</td><td data-label="By">{l.byStaffNumber}</td><td data-label="Staff reference"><code>{l.staffRef.slice(0, 10)}…</code></td><td data-label="Reason">{l.reason}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}
