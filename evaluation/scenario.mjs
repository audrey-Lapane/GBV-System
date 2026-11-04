// Phase 8 end-to-end scenario, run against the live API with synthetic data only.
// Uses the frontend's own crypto code (frontend/src/crypto) for every reporter signature.
// MetaMask signatures are simulated: the admin with Hardhat test account #0 (the contract
// administrator), staff with fresh random wallets.
//
//   cd evaluation && node scenario.mjs            (backend on :4000, chain, IPFS and MySQL running)
//
// Writes evaluation/results/scenario-<timestamp>.json
import { writeFileSync, mkdirSync } from "node:fs";
import { ethers } from "../frontend/node_modules/ethers/lib.esm/index.js";
import * as secretLib from "../frontend/src/crypto/secret.js";
import * as signing from "../frontend/src/crypto/signing.js";

const API = process.env.API_URL || "http://localhost:4000/api";
const MNEMONIC = "test test test test test test test test test test test junk"; // Hardhat's public test mnemonic
const hd = (i) => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
// Staff never pay gas (the gateway relays their signed messages), so fresh wallets are used each run.
const admin = hd(0), officeWallet = ethers.Wallet.createRandom(), socialWallet = ethers.Wallet.createRandom();
const RUN = Date.now().toString(36).toUpperCase();
const DAY = 86400;

const log = [];
function step(n, text, ok, extra = {}) {
  log.push({ step: n, text, ok, ...extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(n).padEnd(4)} ${text}${extra.tx ? "  tx " + extra.tx.slice(0, 12) + "…" : ""}`);
}

async function api(path, { method = "GET", body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sign = (w, digest) => w.signMessage(ethers.getBytes(digest));

async function createStaff(staffNumber, role, wallet, adminToken, cfg) {
  const password = "Synthetic-Pass-" + RUN;
  await api("/auth/register", { method: "POST", body: { staffNumber, name: `Test ${role}`, email: `${staffNumber.toLowerCase()}@example.ac.za`, role, password } });
  const users = (await api("/admin/users?status=pending", { token: adminToken })).data.users;
  const u = users.find((x) => x.staffNumber === staffNumber);
  const prep = (await api(`/admin/users/${u.id}/approve-prepare`, { method: "POST", token: adminToken, body: { walletAddress: wallet.address } })).data;
  const digest = signing.digests.registerInstitution({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, account: prep.account, role: prep.role, staffRef: prep.staffRef, nonce: prep.nonce });
  const ok = await api(`/admin/users/${u.id}/approve`, { method: "POST", token: adminToken, body: { walletAddress: wallet.address, nonce: prep.nonce, signature: await sign(admin, digest) } });
  const login = await api("/auth/login", { method: "POST", body: { staffNumber, password } });
  return { token: login.data.token, staffRef: ok.data.staffRef, wallet };
}

async function open(staff, cfg, reportId, sections) {
  const n = (await api("/access/nonces", { token: staff.token })).data.accessNonce;
  const d = signing.digests.access({ audit: cfg.contracts.AuditTrail, chainId: cfg.chainId, reportId, sections, nonce: n });
  return api(`/access/${reportId}/open`, { method: "POST", token: staff.token, body: { sections, nonce: n, signature: await sign(staff.wallet, d) } });
}

async function main() {
  const cfg = (await api("/config")).data;
  const adminLogin = await api("/auth/login", { method: "POST", body: { staffNumber: process.env.ADMIN_STAFF || "A0001", password: process.env.ADMIN_PASSWORD || "Admin-Password-123" } });
  if (!adminLogin.data.token) throw new Error("Admin login failed: run `npm run create-admin` in backend/ first (see README).");
  const adminToken = adminLogin.data.token;

  const office = await createStaff("GBV" + RUN, "gbv_office", officeWallet, adminToken, cfg);
  const social = await createStaff("SW" + RUN, "social_worker", socialWallet, adminToken, cfg);
  step(0, "Two staff accounts registered, approved and bound to wallets", !!(office.token && social.token));

  // 1. Reporter submits a synthetic report and chooses "Alert only"
  const reportId = secretLib.generateReportId();
  const secret = secretLib.generateSecret();
  const wallet = await secretLib.reporterWallet(secret, reportId);
  const form = new FormData();
  form.append("reportId", reportId);
  form.append("category", "1");
  form.append("reportDate", new Date().toISOString().slice(0, 10));
  form.append("area", "Near the library, Room 214");
  form.append("description", "Synthetic test report. Canary: my name is Thandiwe Canary, phone 082 555 0199, ID 9001015009087.");
  form.append("details", "Synthetic details text for the evaluation run.");
  const prep = await api("/reports/prepare", { method: "POST", form });
  const items = prep.data.items;
  const registerSig = await signing.signWithWallet(wallet, signing.digests.register({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, reporter: wallet.address, items }));
  const validUntil = Math.floor(Date.now() / 1000) + 30 * DAY;
  const consentSig = await signing.signWithWallet(wallet, signing.digests.createConsent({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, category: prep.data.category, reportDay: prep.data.reportDay, shareNow: false, scope: 7, validUntil }));
  const commit = await api(`/reports/${reportId}/commit`, { method: "POST", body: { reporterKey: wallet.address, registerSignature: registerSig, consent: { shareNow: false, scope: 7, validUntil, signature: consentSig } } });
  step(1, `Report submitted with "Alert only" (${items.length} encrypted items; anonymiser removed ${JSON.stringify(prep.data.anonymiser.removed)})`, commit.status === 201, { tx: commit.data.transactions?.[0] });

  // 2. Office sees the minimal alert
  const alerts = (await api("/notifications", { token: office.token })).data.alerts || [];
  const alert = alerts.find((a) => a.reportId === reportId);
  const alertKeys = alert ? Object.keys(alert).sort().join(",") : "";
  step(2, `Office sees alert with only ID, category and date [${alertKeys}]`, !!alert && !JSON.stringify(alert).includes("Canary"));
  const socialAlerts = await api("/notifications", { token: social.token });
  step("2b", "A non-office role cannot read alerts", socialAlerts.status === 403);

  // 3. Office requests access
  let n = (await api("/access/nonces", { token: office.token })).data.requestNonce;
  let d = signing.digests.requestAccess({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, scope: 3, nonce: n });
  const req = await api(`/access/${reportId}/request`, { method: "POST", token: office.token, body: { scope: 3, nonce: n, signature: await sign(officeWallet, d) } });
  step(3, "Office requests access (summary + details); request appears for the reporter", req.status === 201, { tx: req.data.transaction });

  const before = await open(office, cfg, reportId, 1);
  step("3b", "Office cannot read before approval (attempt logged)", before.status === 403, { tx: before.data.transaction });

  // 4. Reporter approves for 30 days
  let ov = (await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await signing.readProof(wallet, cfg, reportId) } })).data;
  const pendingReq = ov.requests.find((r) => r.decision === "pending");
  const until = Math.floor(Date.now() / 1000) + 30 * DAY;
  d = signing.digests.grant({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, role: 1, scope: pendingReq.sections, validUntil: until, nonce: ov.nonces.consent });
  const g = await api(`/consent/${reportId}/grant`, { method: "POST", body: { role: 1, scope: pendingReq.sections, validUntil: until, nonce: ov.nonces.consent, signature: await signing.signWithWallet(wallet, d), requestId: pendingReq.id } });
  step(4, "Reporter approves the request for 30 days", g.status === 200, { tx: g.data.transaction, gas: g.data.gasUsed });

  // 5. Office opens the report
  const opened = await open(office, cfg, reportId, 3);
  const integrityOk = opened.data.items?.every((i) => i.integrity.matchesChain);
  const leaked = JSON.stringify(opened.data).includes("Thandiwe") || JSON.stringify(opened.data).includes("082 555");
  step(5, `Office opens the report: permitted, ${opened.data.items?.length} sections, integrity verified, canaries removed`, opened.status === 200 && integrityOk && !leaked, { tx: opened.data.transaction });
  const evidenceOpen = await open(office, cfg, reportId, 4);
  step("5b", "Evidence section outside the granted scope is denied", evidenceOpen.status === 403);

  // 6. Social worker without a grant
  const sw = await open(social, cfg, reportId, 1);
  step(6, "Social worker without a grant: denied and logged", sw.status === 403 && !!sw.data.transaction, { tx: sw.data.transaction });

  // 7. Reporter revokes
  ov = (await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await signing.readProof(wallet, cfg, reportId) } })).data;
  d = signing.digests.revoke({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, role: 1, nonce: ov.nonces.consent });
  const rv = await api(`/consent/${reportId}/revoke`, { method: "POST", body: { role: 1, nonce: ov.nonces.consent, signature: await signing.signWithWallet(wallet, d) } });
  step(7, "Reporter revokes the office's grant", rv.status === 200, { tx: rv.data.transaction });

  // 8. Office again: denied on first attempt
  const again = await open(office, cfg, reportId, 1);
  step(8, "Office requests again: denied on the first attempt", again.status === 403, { tx: again.data.transaction });

  // Forged consent: backend-style grant signed by someone else is rejected
  d = signing.digests.grant({ consent: cfg.contracts.ConsentManagement, chainId: cfg.chainId, reportId, role: 4, scope: 7, validUntil: until, nonce: Number(ov.nonces.consent) + 1 });
  const forged = await api(`/consent/${reportId}/grant`, { method: "POST", body: { role: 4, scope: 7, validUntil: until, nonce: String(Number(ov.nonces.consent) + 1), signature: await sign(admin, d) } });
  step("8b", "A grant signed by any key other than the reporter's is rejected", forged.status === 409);

  // Wrong reporter secret cannot open the portal
  const wrong = await secretLib.reporterWallet(secretLib.generateSecret(), reportId);
  const wrongOv = await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await signing.readProof(wrong, cfg, reportId) } });
  step("8c", "The portal refuses a wrong secret", wrongOv.status === 401);

  // 9. Withdraw: content becomes unreadable
  ov = (await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await signing.readProof(wallet, cfg, reportId) } })).data;
  d = signing.digests.withdrawReport({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, nonce: ov.nonces.registry });
  const wd = await api(`/reports/${reportId}/withdraw`, { method: "POST", body: { nonce: ov.nonces.registry, signature: await signing.signWithWallet(wallet, d) } });
  step(9, "Reporter withdraws the report: keys destroyed, ciphertext unpinned", wd.status === 200, { tx: wd.data.transaction });

  // 10. Reconcile and count transactions
  ov = (await api(`/consent/${reportId}/overview`, { method: "POST", body: { proof: await signing.readProof(wallet, cfg, reportId) } })).data;
  const txs = [...new Set(ov.history.map((h) => h.txHash))];
  const accessAttempts = ov.history.filter((h) => h.action === "access_attempt");
  const rec = (await api("/admin/reconcile", { token: adminToken })).data;
  step(10, `Reconcile: ${rec.chainEvents} chain events vs ${rec.mirrorRows} mirror rows, ${rec.mismatches.length} mismatches`, rec.ok);
  console.log(`\nState-changing transactions for this report: ${txs.length} (access attempts logged: ${accessAttempts.length}, of which denied: ${accessAttempts.filter((a) => !a.permitted).length})`);
  console.log("History actions:", ov.history.map((h) => h.action + (h.permitted === null ? "" : h.permitted ? "(permitted)" : "(denied)")).join(" → "));

  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const file = new URL(`./results/scenario-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ reportId, steps: log, transactions: txs, history: ov.history, reconcile: rec }, null, 2));
  const failed = log.filter((l) => !l.ok).length;
  console.log(`\n${log.length - failed}/${log.length} checks passed. Saved ${file.pathname}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
