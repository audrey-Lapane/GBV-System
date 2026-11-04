// administration module: approve accounts and bind each to one wallet (registered on-chain by
// the administrator's own MetaMask signature), suspend accounts, statistics, reconciliation and
// the logged staff-reference lookup. There is no route here, or anywhere, that returns report content.
import express from "express";
import { query, one } from "../../db.js";
import { HttpError, wrap, need, isAddress, isSignature, isUint } from "../../lib/http.js";
import { ROLE_ID } from "../../constants.js";
import { requireStaff } from "../authentication/index.js";
import * as chain from "../blockchain/index.js";
import { staffRefOf } from "../reporting/crypto.js";
import { reconcile } from "../audit/service.js";

export const router = express.Router();
router.use(requireStaff(["admin"]));

router.get("/users", wrap(async (req, res) => {
  const status = ["pending", "approved", "suspended"].includes(req.query.status) ? req.query.status : null;
  const rows = await query(
    `SELECT id, staff_number AS staffNumber, name, work_email AS email, role, status, wallet_address AS wallet, requested_wallet AS requestedWallet,
            staff_ref AS staffRef, DATE(created_at) AS registeredOn
       FROM institutional_users WHERE role <> 'admin' ${status ? "AND status = ?" : ""} ORDER BY id DESC`,
    status ? [status] : []
  );
  res.json({ users: rows });
}));

async function staffUser(uid) {
  need(isUint(uid), "Invalid account.");
  const u = await one("SELECT * FROM institutional_users WHERE id = ? AND role <> 'admin'", [uid]);
  need(u, "Account not found.", 404);
  return u;
}

// Gives the admin's browser everything it needs to build and sign the registration digest.
router.post("/users/:uid/approve-prepare", wrap(async (req, res) => {
  const u = await staffUser(req.params.uid);
  const wallet = req.body?.walletAddress;
  need(isAddress(wallet), "Enter the staff member's wallet address.");
  const taken = await one("SELECT id FROM institutional_users WHERE wallet_address = ? AND id <> ?", [wallet, u.id]);
  need(!taken, "This wallet is already bound to another account.", 409);
  res.json({
    account: chain.ethers.getAddress(wallet),
    role: ROLE_ID[u.role],
    staffRef: staffRefOf(u.staff_number),
    nonce: (await chain.consent.adminNonce()).toString(),
  });
}));

router.post("/users/:uid/approve", wrap(async (req, res) => {
  const u = await staffUser(req.params.uid);
  const { walletAddress, nonce, signature } = req.body || {};
  need(isAddress(walletAddress) && isUint(nonce) && isSignature(signature), "Incomplete approval.");
  const ref = staffRefOf(u.staff_number);
  const r = await chain.send(chain.consent, "registerInstitution", [walletAddress, ROLE_ID[u.role], ref, BigInt(nonce), signature]);
  await query("UPDATE institutional_users SET status = 'approved', wallet_address = ?, staff_ref = ? WHERE id = ?",
    [chain.ethers.getAddress(walletAddress), ref, u.id]);
  res.json({ transaction: r.hash, staffRef: ref });
}));

router.post("/users/:uid/suspend", wrap(async (req, res) => {
  const u = await staffUser(req.params.uid);
  const { nonce, signature } = req.body || {};
  need(u.wallet_address, "This account has no wallet bound.");
  need(isUint(nonce) && isSignature(signature), "Incomplete request.");
  const r = await chain.send(chain.consent, "deactivateInstitution", [u.wallet_address, BigInt(nonce), signature]);
  await query("UPDATE institutional_users SET status = 'suspended' WHERE id = ?", [u.id]);
  res.json({ transaction: r.hash });
}));

router.get("/admin-nonce", wrap(async (_req, res) => {
  res.json({ nonce: (await chain.consent.adminNonce()).toString() });
}));

router.get("/stats", wrap(async (_req, res) => {
  const count = async (sql) => Number((await one(sql)).n);
  res.json({
    reports: await count("SELECT COUNT(*) n FROM reports_index"),
    withdrawn: await count("SELECT COUNT(*) n FROM reports_index WHERE status = 'withdrawn'"),
    alerts: await count("SELECT COUNT(*) n FROM notifications"),
    accessRequests: await count("SELECT COUNT(*) n FROM access_requests"),
    accessPermitted: await count("SELECT COUNT(*) n FROM audit_cache WHERE action = 'access_attempt' AND permitted = 1"),
    accessDenied: await count("SELECT COUNT(*) n FROM audit_cache WHERE action = 'access_attempt' AND permitted = 0"),
    consentGrants: await count("SELECT COUNT(*) n FROM audit_cache WHERE action = 'consent_granted'"),
    consentRevocations: await count("SELECT COUNT(*) n FROM audit_cache WHERE action = 'consent_revoked'"),
    staff: await query("SELECT status, COUNT(*) n FROM institutional_users WHERE role <> 'admin' GROUP BY status"),
    byCategory: await query("SELECT category, COUNT(*) n FROM reports_index GROUP BY category"),
    chain: await chain.chainInfo(),
  });
}));

router.get("/reconcile", wrap(async (_req, res) => res.json(await reconcile())));

// Resolving a staff reference to a person is allowed only here, and every lookup is recorded first.
router.post("/staff-lookup", wrap(async (req, res) => {
  const { staffRef, reason } = req.body || {};
  need(/^0x[0-9a-fA-F]{64}$/.test(staffRef || ""), "Enter a staff reference.");
  need((reason || "").trim().length >= 5, "Give a reason for the lookup (it is recorded).");
  await query("INSERT INTO staff_lookups (looked_up_by, staff_ref, reason) VALUES (?,?,?)", [req.staff.id, staffRef, reason.trim().slice(0, 200)]);
  const u = await one("SELECT staff_number AS staffNumber, name, role, status FROM institutional_users WHERE staff_ref = ?", [staffRef]);
  if (!u) throw new HttpError(404, "No account has this staff reference.");
  res.json(u);
}));

router.get("/lookups", wrap(async (_req, res) => {
  res.json({
    lookups: await query(
      `SELECT l.id, l.staff_ref AS staffRef, l.reason, l.created_at AS at, u.staff_number AS byStaffNumber
         FROM staff_lookups l JOIN institutional_users u ON u.id = l.looked_up_by ORDER BY l.id DESC LIMIT 100`
    ),
  });
}));
