import { useEffect, useState } from "react";
import { Link, NavLink, Navigate } from "react-router-dom";
import { useSession } from "../context/Session.jsx";
import { IconDoc, IconExit, IconCheck, IconDeny, IconWarn, IconInfo } from "./icons.jsx";

export function TopBar({ area }) {
  const { quickExit, staff } = useSession();
  return (
    <header className="topbar">
      <Link to="/" className="brand"><span className="mark"><IconDoc size={19} /></span>Campus Desk</Link>
      {area === "staff" && staff && (
        <nav aria-label="Staff">
          {staff.user.role === "admin" ? <NavLink to="/admin">Administration</NavLink> : <NavLink to="/staff" end>Reports</NavLink>}
        </nav>
      )}
      <button type="button" className="exit" onClick={quickExit} title="Leave this site now (Esc)">
        <IconExit /> Leave now
      </button>
    </header>
  );
}

const NOTICE_ICON = { ok: IconCheck, deny: IconDeny, caution: IconWarn, info: IconInfo };

export function Notice({ kind = "info", children, title }) {
  const Ico = NOTICE_ICON[kind] ?? IconInfo;
  return (
    <div className={`notice ${kind}`} role={kind === "deny" ? "alert" : "status"}>
      <span className="ico"><Ico /></span>
      <div>
        {title && <p><strong>{title}</strong></p>}
        {children}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }) {
  if (!error) return null;
  return <Notice kind="deny">{typeof error === "string" ? <p>{error}</p> : <p>{error.message}</p>}</Notice>;
}

export function Busy({ label = "Working" }) {
  return <span className="meta" role="status"><span className="spinner" aria-hidden="true" /> {label}…</span>;
}

export function Field({ id, label, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {children}
    </div>
  );
}

/** Shortened transaction hash, shown in full on hover and to screen readers. */
export function Tx({ hash }) {
  if (!hash) return null;
  return <code title={hash} aria-label={`transaction ${hash}`}>{hash.slice(0, 10)}…{hash.slice(-6)}</code>;
}

export function ProtectedRoute({ roles, children }) {
  const { staff } = useSession();
  // Convenience only: the real checks are on the server and the chain.
  if (!staff) return <Navigate to="/staff/login" replace />;
  if (roles && !roles.includes(staff.user.role)) return <Navigate to={staff.user.role === "admin" ? "/admin" : "/staff"} replace />;
  return children;
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = () => {
    setState((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload };
}

export const formatDay = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
export const formatTime = (unixSeconds) =>
  new Date(unixSeconds * 1000).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
