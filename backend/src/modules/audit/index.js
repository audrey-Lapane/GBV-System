// audit routes. Read-only by design: there is no edit or delete route for audit records.
import express from "express";
import { wrap, need, isBytes32 } from "../../lib/http.js";
import { requireStaff } from "../authentication/index.js";
import * as chain from "../blockchain/index.js";

export const router = express.Router();

// Lets anyone verify a transaction hash shown in the interface against the chain.
router.get("/tx/:hash", wrap(async (req, res) => {
  need(isBytes32(req.params.hash), "Invalid transaction hash.");
  const receipt = await chain.provider.getTransactionReceipt(req.params.hash);
  need(receipt, "Transaction not found on this chain.", 404);
  const events = chain.parseLogs(receipt.logs).map((e) => ({ name: e.name, logIndex: e.logIndex }));
  res.json({ hash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString(), events });
}));

// Staff see the on-chain audit log for a report they work on (no content, only who/when/result).
router.get("/report/:id", requireStaff(["gbv_office", "legal", "health", "social_worker", "admin"]), wrap(async (req, res) => {
  need(isBytes32(req.params.id), "Invalid report ID.");
  const entries = await chain.audit.getAuditLog(req.params.id);
  res.json({
    entries: entries.map((e) => ({
      actor: e.actor, staffRef: e.staffRef, role: Number(e.role), sections: Number(e.sections), permitted: e.permitted, time: Number(e.timestamp),
    })),
  });
}));
