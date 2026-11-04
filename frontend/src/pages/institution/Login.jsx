import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client.js";
import { connectMetaMask } from "../../crypto/signing.js";
import { useSession } from "../../context/Session.jsx";
import { Field, Notice, ErrorBanner, Busy } from "../../components/ui.jsx";

export function Login() {
  const { setStaff } = useSession();
  const navigate = useNavigate();
  const [staffNumber, setStaffNumber] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/auth/login", { method: "POST", body: { staffNumber, password } });
      setStaff({ token: r.token, user: r.user, notice: r.notice, expiresAt: Date.now() + r.expiresInMinutes * 60_000 });
      setPassword("");
      navigate(r.user.role === "admin" ? "/admin" : "/staff", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>Staff sign in</h1>
      <Notice kind="info"><p>Sign in with your own staff number. Shared accounts are not allowed. Every time you request or open a report, it is recorded with your staff reference.</p></Notice>
      <ErrorBanner error={error} />
      <form onSubmit={submit}>
        <Field id="sn" label="Staff number">
          <input id="sn" type="text" value={staffNumber} onChange={(e) => setStaffNumber(e.target.value)} autoComplete="username" required />
        </Field>
        <Field id="pw" label="Password">
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy}>Sign in</button>
          {busy && <Busy label="Signing in" />}
        </div>
      </form>
      <p className="footer-links">New staff member? <Link to="/staff/register">Request an account</Link> · <Link to="/">Back to start</Link></p>  
    </div>
  );
}

export function Register() {
  const [f, setF] = useState({ staffNumber: "", name: "", email: "", role: "", password: "", walletAddress: "" });
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function useMetaMask() {
    try { setF((s) => ({ ...s, walletAddress: "" })); const a = await connectMetaMask(); setF((s) => ({ ...s, walletAddress: a })); }
    catch (e) { setError(e); }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/auth/register", { method: "POST", body: { ...f, walletAddress: f.walletAddress || undefined } });
      setDone(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="narrow">
        <h1>Account requested</h1>
        <Notice kind="ok"><p>{done}</p></Notice>
        <p>The administrator checks your details against staff records and binds your account to your wallet. You can sign in once it is approved.</p>
        <Link className="btn secondary" to="/staff/login">Go to sign in</Link>
      </div>
    );
  }

  return (
    <div className="narrow">
      <h1>Request a staff account</h1>
      <ErrorBanner error={error} />
      <form onSubmit={submit}>
        <Field id="r-sn" label="Staff number"><input id="r-sn" type="text" value={f.staffNumber} onChange={set("staffNumber")} required autoComplete="username" /></Field>
        <Field id="r-name" label="Full name"><input id="r-name" type="text" value={f.name} onChange={set("name")} required autoComplete="name" /></Field>
        <Field id="r-email" label="Work email"><input id="r-email" type="email" value={f.email} onChange={set("email")} required autoComplete="email" /></Field>
        <Field id="r-role" label="Your role">
          <select id="r-role" value={f.role} onChange={set("role")} required>
            <option value="">Choose your role</option>
            <option value="gbv_office">GBV office</option>
            <option value="legal">Legal services</option>
            <option value="health">Campus health</option>
            <option value="social_worker">Social worker</option>
          </select>
        </Field>
        <Field id="r-pw" label="Password" hint="At least 10 characters."><input id="r-pw" type="password" value={f.password} onChange={set("password")} required minLength={10} autoComplete="new-password" /></Field>
        <Field id="r-wallet" label="Your MetaMask wallet address" hint="The administrator binds your account to this one address. You will sign every request with it.">
          <input id="r-wallet" type="text" value={f.walletAddress} onChange={set("walletAddress")} placeholder="0x…" spellCheck={false} />
        </Field>
        <button type="button" className="btn secondary small" onClick={useMetaMask}>Use my MetaMask address</button>
        <div className="actions">
          <button className="btn" type="submit" disabled={busy}>Request account</button>
            {busy && <Busy label="Sending" />}
        </div>
      </form>
      <p className="footer-links">Already have an account? <Link to="/staff/login">Sign in</Link> · <Link to="/">Back to start</Link></p>
    </div>
  );
}
