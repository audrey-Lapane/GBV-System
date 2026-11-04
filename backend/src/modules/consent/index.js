// consent module: relays the reporter's signed grant and revoke messages and serves the
// reporter's portal (consent state, pending requests, full history). It never signs consent
// itself: the contract checks the reporter's signature, so a relayed message is all it can do.
import express from "express";
import rateLimit from "express-rate-limit";
import { query, one } from "../../db.js";
import { config } from "../../config.js";
import { wrap, need, isBytes32, isSignature, isUint } from "../../lib/http.js";
import { verifyReporter } from "../../lib/reporterProof.js";
import { ROLES, SECTION_NAME } from "../../constants.js";
import * as chain from "../blockchain/index.js";
import { recordEvents, historyFromChain } from "../audit/service.js";

export const router = express.Router();
const portalLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.portalReadsPer15Min, standardHeaders: true, legacyHeaders: false });

const idParam = (req) => {
  need(isBytes32(req.params.id), "Invalid report ID.");
  return req.params.id;
};

// Everything the reporter's portal shows. Requires a fresh signature from the reporter key.
router.post("/:id/overview", portalLimiter, wrap(async (req, res) => {
  const id = idParam(req);
  await verifyReporter(id, req.body?.proof);

  const report = await one("SELECT category, report_date, status FROM reports_index WHERE report_id = ?", [id]);
  const chainItems = await chain.registry.getItems(id);
  const items = chainItems.map((it, index) => ({
    index,
    section: SECTION_NAME[Number(it.section)],
    active: it.active,
    addedAt: Number(it.addedAt),
  }));

  const consent = {};
  for (const roleId of Object.keys(ROLES)) {
    const g = await chain.consent.viewConsent(id, roleId);
    consent[roleId] = {
      status: ["none", "granted", "revoked"][Number(g.status)],
      scope: Number(g.scope),
      validUntil: Number(g.validUntil),
      active: await chain.consent.checkConsent(id, roleId, Number(g.scope) || 1),
    };
  }

  const requests = await query(
    "SELECT id, staff_ref AS staffRef, role, sections, decision, tx_hash AS txHash, DATE(created_at) AS day FROM access_requests WHERE report_id = ? ORDER BY id DESC",
    [id]
  );

  res.json({
    reportId: id,
    status: report?.status ?? (await chain.registry.isActive(id) ? "active" : "withdrawn"),
    category: report?.category ?? null,
    reportDate: report?.report_date ?? null,
    items,
    consent,
    requests,
    history: await historyFromChain(id),
    nonces: {
      registry: (await chain.registry.nonceOf(id)).toString(),
      consent: (await chain.consent.nonceOf(id)).toString(),
    },
  });
}));

router.post("/:id/grant", wrap(async (req, res) => {
  const id = idParam(req);
  const { role, scope, validUntil, nonce, signature, requestId } = req.body || {};
  need(ROLES[role] && isUint(scope) && isUint(validUntil) && isUint(nonce) && isSignature(signature), "Incomplete grant.");
  const r = await chain.send(chain.consent, "grantAccess", [id, Number(role), Number(scope), BigInt(validUntil), BigInt(nonce), signature]);
  await recordEvents(r.events);
  if (requestId) {
    await query("UPDATE access_requests SET decision = 'approved' WHERE id = ? AND report_id = ? AND decision = 'pending'", [requestId, id]);
  }
  res.json({ transaction: r.hash, gasUsed: r.gasUsed });
}));

router.post("/:id/revoke", wrap(async (req, res) => {
  const id = idParam(req);
  const { role, nonce, signature } = req.body || {};
  need(ROLES[role] && isUint(nonce) && isSignature(signature), "Incomplete revocation.");
  const r = await chain.send(chain.consent, "revokeConsent", [id, Number(role), BigInt(nonce), signature]);
  await recordEvents(r.events);
  res.json({ transaction: r.hash, gasUsed: r.gasUsed });
}));

// Denying a request changes nothing on-chain (no consent exists to remove); it is recorded off-chain.
router.post("/:id/deny", portalLimiter, wrap(async (req, res) => {
  const id = idParam(req);
  await verifyReporter(id, req.body?.proof);
  need(isUint(req.body?.requestId), "Missing request.");
  await query("UPDATE access_requests SET decision = 'denied' WHERE id = ? AND report_id = ? AND decision = 'pending'", [req.body.requestId, id]);
  res.json({ ok: true });
}));
