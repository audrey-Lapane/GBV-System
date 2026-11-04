// audit module: mirrors on-chain events into audit_cache (with tx hash and log index),
// builds the reporter's history from the chain itself, and reconciles the mirror with the chain.
// There is no route that edits or deletes an audit entry.
import { query } from "../../db.js";
import * as chain from "../blockchain/index.js";

const ACTION = {
  ReportRegistered: "report_registered",
  ItemAdded: "item_added",
  ItemWithdrawn: "item_withdrawn",
  ReportWithdrawn: "report_withdrawn",
  AlertSent: "alert_sent",
  ConsentGranted: "consent_granted",
  ConsentRevoked: "consent_revoked",
  AccessRequested: "access_requested",
  AccessLogged: "access_attempt",
};

function row(e) {
  const a = e.args;
  return {
    report_id: a.reportId,
    action: ACTION[e.name],
    staff_ref: a.staffRef ?? null,
    role: a.role !== undefined ? Number(a.role) : a.officeRole !== undefined ? Number(a.officeRole) : null,
    sections: a.sections !== undefined ? Number(a.sections) : a.scope !== undefined ? Number(a.scope) : a.section !== undefined ? Number(a.section) : null,
    permitted: a.permitted !== undefined ? (a.permitted ? 1 : 0) : null,
    tx_hash: e.txHash,
    log_index: e.logIndex,
    block_number: e.blockNumber,
  };
}

/** Writes report-scoped events to the mirror. Idempotent (unique on tx hash + log index). */
export async function recordEvents(events) {
  for (const e of events) {
    if (!ACTION[e.name]) continue;
    const r = row(e);
    await query(
      `INSERT IGNORE INTO audit_cache (report_id, action, staff_ref, role, sections, permitted, tx_hash, log_index, block_number)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [r.report_id, r.action, r.staff_ref, r.role, r.sections, r.permitted, r.tx_hash, r.log_index, r.block_number]
    );
  }
}

/** The reporter's history, read directly from the chain (authoritative). */
export async function historyFromChain(reportId) {
  const events = await chain.reportHistory(reportId);
  return events.map((e) => {
    const r = row(e);
    return {
      action: r.action,
      role: r.role,
      sections: r.sections,
      permitted: r.permitted === null ? null : !!r.permitted,
      staffRef: r.staff_ref,
      validUntil: e.args.validUntil !== undefined ? Number(e.args.validUntil) : null,
      txHash: e.txHash,
      blockNumber: e.blockNumber,
      time: e.timestamp,
    };
  });
}

/**
 * Compares every mirror row with the chain. Reports rows missing from either side and rows
 * whose fields differ (for example a `permitted` value edited in MySQL).
 */
export async function reconcile() {
  const reports = await query("SELECT report_id FROM reports_index");
  const mismatches = [];
  let chainEvents = 0;
  let mirrorRows = 0;
  for (const { report_id } of reports) {
    const onChain = (await chain.reportHistory(report_id)).map(row);
    const mirror = await query(
      "SELECT report_id, action, staff_ref, role, sections, permitted, tx_hash, log_index, block_number FROM audit_cache WHERE report_id = ?",
      [report_id]
    );
    chainEvents += onChain.length;
    mirrorRows += mirror.length;
    const key = (r) => `${r.tx_hash.toLowerCase()}:${r.log_index}`;
    const m = new Map(mirror.map((r) => [key(r), r]));
    for (const c of onChain) {
      const k = key(c);
      const mr = m.get(k);
      if (!mr) {
        mismatches.push({ reportId: report_id, txHash: c.tx_hash, problem: "missing from mirror", action: c.action });
        continue;
      }
      m.delete(k);
      for (const f of ["action", "staff_ref", "role", "sections", "permitted", "block_number"]) {
        const a = c[f] === null ? null : String(c[f]).toLowerCase();
        const b = mr[f] === null ? null : String(mr[f]).toLowerCase();
        if (a !== b) mismatches.push({ reportId: report_id, txHash: c.tx_hash, problem: `field '${f}' differs`, chain: c[f], mirror: mr[f] });
      }
    }
    for (const r of m.values()) mismatches.push({ reportId: report_id, txHash: r.tx_hash, problem: "in mirror but not on chain", action: r.action });
  }
  return { checkedAt: new Date().toISOString(), reports: reports.length, chainEvents, mirrorRows, mismatches, ok: mismatches.length === 0 };
}
