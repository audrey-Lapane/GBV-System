// accessControl module: JWT -> role and staff reference -> bound-wallet signature ->
// AuditTrail.logAccess (which itself calls checkConsent and records the attempt, permitted or
// denied) -> release only the permitted sections, each with its integrity check.
// Content is never released on a role check alone.
import express from "express";
import { query, one } from "../../db.js";
import { HttpError, wrap, need, isBytes32, isSignature, isUint } from "../../lib/http.js";
import { SECTION_NAME, SECTIONS, SCOPE_ALL, ROLE_ID } from "../../constants.js";
import { requireStaff } from "../authentication/index.js";
import * as chain from "../blockchain/index.js";
import * as ipfs from "../ipfs/index.js";
import { recordEvents } from "../audit/service.js";
import { unwrapKey, decryptItem, sha256Hex } from "../reporting/crypto.js";

export const router = express.Router();
const STAFF = ["gbv_office", "legal", "health", "social_worker"];
const { ethers, deployed } = { ethers: chain.ethers, deployed: chain.deployed };
const coder = ethers.AbiCoder.defaultAbiCoder();
const tag = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

const requestDigest = (reportId, scope, nonce) =>
  ethers.keccak256(coder.encode(["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
    [deployed.ConsentManagement, deployed.chainId, tag("GBV.REQUEST_ACCESS"), reportId, scope, nonce]));
const accessDigest = (reportId, sections, nonce) =>
  ethers.keccak256(coder.encode(["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
    [deployed.AuditTrail, deployed.chainId, tag("GBV.ACCESS"), reportId, sections, nonce]));

/** The signature must come from the wallet bound to the logged-in account (login + wallet = two checks). */
function requireBoundWallet(req, digest, signature) {
  need(req.staff.wallet, "Your account has no wallet bound yet. Contact the administrator.", 403);
  const signer = chain.recover(digest, signature);
  if (signer.toLowerCase() !== req.staff.wallet.toLowerCase()) {
    throw new HttpError(401, "This request was not signed by the wallet bound to your account.");
  }
}

router.get("/nonces", requireStaff(STAFF), wrap(async (req, res) => {
  need(req.staff.wallet, "Your account has no wallet bound yet.", 403);
  res.json({
    wallet: req.staff.wallet,
    requestNonce: (await chain.consent.staffNonce(req.staff.wallet)).toString(),
    accessNonce: (await chain.audit.accessNonce(req.staff.wallet)).toString(),
  });
}));

router.post("/:id/request", requireStaff(STAFF), wrap(async (req, res) => {
  const id = req.params.id;
  const { scope, nonce, signature } = req.body || {};
  need(isBytes32(id) && isUint(scope) && Number(scope) >= 1 && Number(scope) <= SCOPE_ALL && isUint(nonce) && isSignature(signature), "Incomplete request.");
  requireBoundWallet(req, requestDigest(id, Number(scope), BigInt(nonce)), signature);
  const report = await one("SELECT status FROM reports_index WHERE report_id = ?", [id]);
  need(report && report.status === "active", "Report not found.", 404);

  const r = await chain.send(chain.consent, "requestAccess", [id, Number(scope), BigInt(nonce), signature]);
  await recordEvents(r.events);
  await query("INSERT INTO access_requests (report_id, staff_ref, role, sections, tx_hash) VALUES (?,?,?,?,?)",
    [id, req.staff.staffRef, req.staff.role, Number(scope), r.hash]);
  if (req.staff.role === "gbv_office") await query("UPDATE notifications SET status = 'actioned' WHERE report_id = ?", [id]);
  res.status(201).json({ transaction: r.hash, message: "Your request has been sent to the reporter, who can approve or deny it." });
}));

router.post("/:id/open", requireStaff(STAFF), wrap(async (req, res) => {
  const id = req.params.id;
  const { sections, nonce, signature } = req.body || {};
  need(isBytes32(id) && isUint(sections) && Number(sections) >= 1 && Number(sections) <= SCOPE_ALL && isUint(nonce) && isSignature(signature), "Incomplete request.");
  requireBoundWallet(req, accessDigest(id, Number(sections), BigInt(nonce)), signature);

  // The attempt is written to the chain first, permitted or not. The contract decides.
  const r = await chain.send(chain.audit, "logAccess", [id, Number(sections), BigInt(nonce), signature]);
  await recordEvents(r.events);
  const logged = r.events.find((e) => e.name === "AccessLogged");
  if (!logged || !logged.args.permitted) {
    return res.status(403).json({
      permitted: false,
      transaction: r.hash,
      error: "Access denied. The reporter has not given your role consent for these sections, or it has expired or been revoked. This attempt has been recorded.",
    });
  }

  const wanted = Object.values(SECTIONS).filter((bit) => (Number(sections) & bit) === bit).map((bit) => SECTION_NAME[bit]);
  const rows = await query(
    `SELECT i.id, i.chain_index, i.section, i.ipfs_cid, i.content_hash, i.mime_type, k.wrapped_key, k.content_iv
       FROM report_items i JOIN report_keys k ON k.item_id = i.id
      WHERE i.report_id = ? AND i.status = 'active' AND i.section IN (?) ORDER BY i.chain_index`,
    [id, wanted]
  );

  const items = [];
  for (const row of rows) {
    const bytes = await ipfs.cat(row.ipfs_cid);
    const computed = sha256Hex(bytes);
    const onChain = await chain.registry.verifyIntegrity(id, row.chain_index, computed);
    const integrity = { computedHash: computed, matchesDatabase: computed === row.content_hash, matchesChain: onChain };
    if (!onChain) {
      items.push({ section: row.section, index: row.chain_index, integrity, error: "Integrity check failed: this item was changed after it was submitted and has not been opened." });
      continue;
    }
    const plain = decryptItem(bytes, unwrapKey(row.wrapped_key), row.content_iv);
    items.push({ section: row.section, index: row.chain_index, integrity, content: JSON.parse(plain.toString("utf8")) });
  }
  res.json({ permitted: true, transaction: r.hash, roleId: ROLE_ID[req.staff.role], items });
}));
