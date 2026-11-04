// reporting module: validate -> anonymise -> encrypt each section separately -> strip image
// metadata -> hash -> pin each item to IPFS -> register the items on-chain (reporter-signed)
// -> create consent (reporter-signed) -> store metadata. Never stores the secret or identity.
import { query, one, transaction } from "../../db.js";
import { config } from "../../config.js";
import { HttpError, need, isBytes32, isAddress, isSignature, isUint } from "../../lib/http.js";
import { CATEGORIES, SECTIONS, SECTION_NAME, dateToDayNumber, today, SCOPE_ALL } from "../../constants.js";
import * as chain from "../blockchain/index.js";
import * as ipfs from "../ipfs/index.js";
import { anonymise } from "./anonymiser.js";
import { prepareEvidence } from "./evidence.js";
import { encryptItem, wrapKey } from "./crypto.js";
import { recordEvents } from "../audit/service.js";

// Prepared-but-not-yet-signed submissions, held in memory only, for a few minutes.
const pending = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, p] of pending) {
    if (p.expires < now) {
      pending.delete(k);
      p.items.forEach((it) => ipfs.unpin(it.cid)); // never registered: remove the ciphertext too
    }
  }
}, 60_000).unref();

async function sealSection(section, plaintext, mime) {
  const enc = encryptItem(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8"));
  const cid = await ipfs.add(enc.envelope); // ciphertext only, and only after encryption
  return { section, cid, contentHash: enc.contentHash, key: enc.key, iv: enc.iv, mime, size: enc.envelope.bytes.length };
}

const publicItem = ({ section, cid, contentHash }) => ({ section, cid, contentHash });

/** Builds the encrypted items for whatever sections were supplied. */
async function buildItems({ summary, details, files }) {
  const items = [];
  const removed = {};
  const merge = (r) => Object.entries(r).forEach(([k, v]) => (removed[k] = (removed[k] || 0) + v));
  let evidenceFiles = [];

  if (summary) {
    const area = anonymise(summary.area);
    const desc = anonymise(summary.description);
    merge(area.removed);
    merge(desc.removed);
    const body = JSON.stringify({ category: summary.category, reportDate: summary.reportDate, area: area.text, description: desc.text });
    items.push(await sealSection(SECTIONS.summary, body, "application/json"));
  }
  if (details && details.trim()) {
    const d = anonymise(details);
    merge(d.removed);
    items.push(await sealSection(SECTIONS.details, JSON.stringify({ text: d.text }), "application/json"));
  }
  if (files && files.length) {
    const ev = await prepareEvidence(files);
    evidenceFiles = ev.files;
    items.push(await sealSection(SECTIONS.evidence, ev.bundle, "application/json+evidence-bundle"));
  }
  return { items, removed, evidenceFiles };
}

// ------------------------------------------------------------------ new report

export async function prepareReport(fields, files) {
  const { reportId, category, reportDate } = fields;
  need(isBytes32(reportId), "Invalid report ID.");
  need(CATEGORIES[Number(category)], "Choose a category.");
  need(/^\d{4}-\d{2}-\d{2}$/.test(reportDate || "") && reportDate <= today(), "Enter the date it happened (not in the future).");
  need((fields.description || "").trim().length >= 10, "Please describe what happened in a few words.");
  need((fields.description || "").length <= 5000 && (fields.details || "").length <= 20000 && (fields.area || "").length <= 200, "Text is too long.");
  need((await chain.registry.reporterOf(reportId)) === chain.ethers.ZeroAddress, "This report ID is already in use.", 409);

  const built = await buildItems({
    summary: { category: Number(category), reportDate, area: fields.area || "", description: fields.description },
    details: fields.details,
    files,
  });
  pending.set(reportId, {
    items: built.items,
    category: Number(category),
    reportDate,
    reportDay: dateToDayNumber(reportDate),
    expires: Date.now() + config.pendingMinutes * 60_000,
  });
  return {
    items: built.items.map(publicItem),
    category: Number(category),
    reportDay: dateToDayNumber(reportDate),
    anonymiser: { removed: built.removed },
    evidence: built.evidenceFiles,
    expiresInMinutes: config.pendingMinutes,
  };
}

export async function commitReport(reportId, body) {
  const p = pending.get(reportId);
  need(p, "This submission has expired. Please submit again.", 410);
  const { reporterKey, registerSignature, consent } = body;
  need(isAddress(reporterKey) && isSignature(registerSignature), "Missing signature.");
  need(consent && typeof consent.shareNow === "boolean", "Choose whether to share now or send an alert only.");
  need(isSignature(consent.signature) && isUint(consent.validUntil) && isUint(consent.scope), "Missing consent signature.");
  need(Number(consent.scope) >= 1 && Number(consent.scope) <= SCOPE_ALL, "Invalid sharing scope.");

  const events = [];
  const existing = await chain.registry.reporterOf(reportId);
  if (existing === chain.ethers.ZeroAddress) {
    const r = await chain.send(chain.registry, "registerReport", [reportId, reporterKey, p.items.map(publicItem), registerSignature]);
    events.push(...r.events);
  } else {
    need(existing.toLowerCase() === reporterKey.toLowerCase(), "This report ID is already in use.", 409);
  }
  const c = await chain.send(chain.consent, "createConsent", [
    reportId, p.category, p.reportDay, consent.shareNow, Number(consent.scope), BigInt(consent.validUntil), consent.signature,
  ]);
  events.push(...c.events);

  await transaction(async (q) => {
    await q("INSERT INTO reports_index (report_id, category, report_date, created_at) VALUES (?,?,?,?)", [reportId, p.category, p.reportDate, today()]);
    for (const [i, it] of p.items.entries()) await insertItem(q, reportId, i, it);
  });
  pending.delete(reportId);
  await recordEvents(events);

  const alert = events.find((e) => e.name === "AlertSent");
  if (alert) {
    await query(
      "INSERT IGNORE INTO notifications (report_id, office_role, category, report_date, tx_hash, created_at) VALUES (?,?,?,?,?,?)",
      [reportId, Number(alert.args.officeRole), p.category, p.reportDate, alert.txHash, today()]
    );
  }
  return { transactions: [...new Set(events.map((e) => e.txHash))], sharedNow: consent.shareNow };
}

async function insertItem(q, reportId, chainIndex, it) {
  const res = await q(
    "INSERT INTO report_items (report_id, chain_index, section, ipfs_cid, content_hash, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [reportId, chainIndex, SECTION_NAME[it.section], it.cid, it.contentHash, it.mime, it.size, today()]
  );
  await q("INSERT INTO report_keys (item_id, wrapped_key, content_iv) VALUES (?,?,?)", [res.insertId, wrapKey(it.key), it.iv]);
}

// ------------------------------------------------------------------ add details or evidence later

export async function prepareItem(reportId, fields, files) {
  need(isBytes32(reportId), "Invalid report ID.");
  const report = await one("SELECT status FROM reports_index WHERE report_id = ?", [reportId]);
  need(report && report.status === "active", "Report not found or withdrawn.", 404);
  const section = fields.section;
  need(section === "details" || section === "evidence", "Choose details or evidence.");
  need(section !== "details" || (fields.details || "").trim().length > 0, "Write the details you want to add.");
  need(section !== "evidence" || (files && files.length), "Choose at least one file.");

  const built = await buildItems(section === "details" ? { details: fields.details } : { files });
  const item = built.items[0];
  pending.set(`${reportId}:item`, { items: [item], expires: Date.now() + config.pendingMinutes * 60_000 });
  return { item: publicItem(item), nonce: (await chain.registry.nonceOf(reportId)).toString(), anonymiser: { removed: built.removed }, evidence: built.evidenceFiles };
}

export async function commitItem(reportId, { nonce, signature }) {
  const p = pending.get(`${reportId}:item`);
  need(p, "This addition has expired. Please try again.", 410);
  need(isUint(nonce) && isSignature(signature), "Missing signature.");
  const it = p.items[0];
  const r = await chain.send(chain.registry, "addItem", [reportId, publicItem(it), BigInt(nonce), signature]);
  const added = r.events.find((e) => e.name === "ItemAdded");
  await transaction((q) => insertItem(q, reportId, Number(added.args.index), it));
  pending.delete(`${reportId}:item`);
  await recordEvents(r.events);
  return { transaction: r.hash, index: Number(added.args.index) };
}

// ------------------------------------------------------------------ withdrawal and crypto-shredding

async function shred(rows) {
  for (const row of rows) {
    await query("DELETE FROM report_keys WHERE item_id = ?", [row.id]); // the key is gone: ciphertext is unreadable
    await query("UPDATE report_items SET status = 'shredded' WHERE id = ?", [row.id]);
    await ipfs.unpin(row.ipfs_cid);
  }
}

export async function withdrawItem(reportId, { index, nonce, signature }) {
  need(isUint(index) && isUint(nonce) && isSignature(signature), "Missing signature.");
  const r = await chain.send(chain.registry, "withdrawItem", [reportId, BigInt(index), BigInt(nonce), signature]);
  await shred(await query("SELECT id, ipfs_cid FROM report_items WHERE report_id = ? AND chain_index = ?", [reportId, Number(index)]));
  await recordEvents(r.events);
  return { transaction: r.hash };
}

export async function withdrawReport(reportId, { nonce, signature }) {
  need(isUint(nonce) && isSignature(signature), "Missing signature.");
  const r = await chain.send(chain.registry, "withdrawReport", [reportId, BigInt(nonce), signature]);
  await shred(await query("SELECT id, ipfs_cid FROM report_items WHERE report_id = ?", [reportId]));
  await query("UPDATE reports_index SET status = 'withdrawn' WHERE report_id = ?", [reportId]);
  await query("UPDATE access_requests SET decision = 'denied' WHERE report_id = ? AND decision = 'pending'", [reportId]);
  await recordEvents(r.events);
  return { transaction: r.hash };
}

export function hasPending(reportId) {
  if (!pending.has(reportId)) throw new HttpError(410, "This submission has expired. Please submit again.");
}
