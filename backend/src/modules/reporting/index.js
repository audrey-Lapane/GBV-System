import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { config } from "../../config.js";
import { wrap, need, isBytes32, HttpError } from "../../lib/http.js";
import { verifyReporter } from "../../lib/reporterProof.js";
import * as svc from "./service.js";

export const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(), // files are never written to disk unencrypted
  limits: { fileSize: config.maxEvidenceFileBytes, files: config.maxEvidenceFiles, fieldSize: 64 * 1024, fields: 12 },
});
const uploadEvidence = (req, res, next) =>
  upload.array("evidence", config.maxEvidenceFiles)(req, res, (err) => {
    if (err) return next(new HttpError(400, err.code === "LIMIT_FILE_SIZE" ? "A file is larger than the size limit." : "The upload was not accepted."));
    next();
  });

const submitLimiter = rateLimit({ windowMs: 60 * 60_000, limit: config.submitsPerHour, standardHeaders: true, legacyHeaders: false });
const idParam = (req) => {
  need(isBytes32(req.params.id), "Invalid report ID.");
  return req.params.id;
};

// Step 1: content is anonymised, encrypted and pinned; the browser receives CIDs and hashes to sign.
router.post("/prepare", submitLimiter, uploadEvidence, wrap(async (req, res) => {
  res.json(await svc.prepareReport(req.body, req.files || []));
}));

// Step 2: the browser's signatures are relayed; the report and the reporter's choice go on-chain.
router.post("/:id/commit", wrap(async (req, res) => {
  res.status(201).json(await svc.commitReport(idParam(req), req.body || {}));
}));

// Adding details or evidence later. Preparing requires proof of the secret (a signed read request).
router.post("/:id/items/prepare", submitLimiter, uploadEvidence, wrap(async (req, res) => {
  const id = idParam(req);
  let proof;
  try { proof = JSON.parse(req.body.proof || "null"); } catch { proof = null; }
  await verifyReporter(id, proof);
  res.json(await svc.prepareItem(id, req.body, req.files || []));
}));

router.post("/:id/items/commit", wrap(async (req, res) => {
  res.status(201).json(await svc.commitItem(idParam(req), req.body || {}));
}));

router.post("/:id/items/withdraw", wrap(async (req, res) => {
  res.json(await svc.withdrawItem(idParam(req), req.body || {}));
}));

router.post("/:id/withdraw", wrap(async (req, res) => {
  res.json(await svc.withdrawReport(idParam(req), req.body || {}));
}));
