// notification module: listens for AlertSent (and mirrors all report events) with a stored
// checkpoint so nothing is missed after a restart. Alerts hold only ID, category and day,
// and are served only to staff whose on-chain registration is the designated office role.
import express from "express";
import { query, one } from "../../db.js";
import { wrap, need, isUint, HttpError } from "../../lib/http.js";
import { OFFICE_ROLE, dayNumberToDate, today, CATEGORIES } from "../../constants.js";
import { requireStaff } from "../authentication/index.js";
import * as chain from "../blockchain/index.js";
import { recordEvents } from "../audit/service.js";

export const router = express.Router();

async function requireOfficeOnChain(req) {
  need(req.staff.wallet, "Your account has no wallet bound yet.", 403);
  const inst = await chain.consent.institutionOf(req.staff.wallet);
  if (!inst.active || Number(inst.role) !== OFFICE_ROLE) throw new HttpError(403, "Alerts are only shown to the designated office.");
}

router.get("/", requireStaff(["gbv_office"]), wrap(async (req, res) => {
  await requireOfficeOnChain(req);
  const rows = await query(
    `SELECT n.id, n.report_id AS reportId, n.category, n.report_date AS reportDate, n.status, r.status AS reportStatus
       FROM notifications n JOIN reports_index r ON r.report_id = n.report_id
      ORDER BY n.id DESC LIMIT 200`
  );
  res.json({ alerts: rows.map((r) => ({ ...r, categoryLabel: CATEGORIES[r.category] })) });
}));

router.post("/:nid/seen", requireStaff(["gbv_office"]), wrap(async (req, res) => {
  need(isUint(req.params.nid), "Invalid alert.");
  await requireOfficeOnChain(req);
  await query("UPDATE notifications SET status = 'seen' WHERE id = ? AND status = 'new'", [req.params.nid]);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ event listener

const CHECKPOINT = "events";
let running = false;

async function poll() {
  if (running) return;
  running = true;
  try {
    const cp = await one("SELECT last_block FROM sync_state WHERE name = ?", [CHECKPOINT]);
    const from = cp ? cp.last_block + 1 : chain.deployed.deployBlock ?? 0;
    const latest = await chain.provider.getBlockNumber();
    if (from > latest) return;
    const to = Math.min(latest, from + 2000);
    const logs = await chain.provider.getLogs({
      address: [chain.deployed.ReportRegistry, chain.deployed.ConsentManagement, chain.deployed.AuditTrail],
      fromBlock: from,
      toBlock: to,
    });
    const events = chain.parseLogs(logs);
    for (const e of events.filter((x) => x.name === "AlertSent")) {
      const exists = await one("SELECT report_id FROM reports_index WHERE report_id = ?", [e.args.reportId]);
      if (!exists) continue; // the submitting request inserts it, together with its own copy of this alert
      await query(
        "INSERT IGNORE INTO notifications (report_id, office_role, category, report_date, tx_hash, created_at) VALUES (?,?,?,?,?,?)",
        [e.args.reportId, Number(e.args.officeRole), Number(e.args.category), dayNumberToDate(Number(e.args.reportDay)), e.txHash, today()]
      );
    }
    await recordEvents(events);
    await query("INSERT INTO sync_state (name, last_block) VALUES (?, ?) ON DUPLICATE KEY UPDATE last_block = VALUES(last_block)", [CHECKPOINT, to]);
  } catch (e) {
    console.error("[notification] listener error:", e.message);
  } finally {
    running = false;
  }
}

export function startListener(intervalMs = 2000) {
  poll();
  return setInterval(poll, intervalMs);
}
