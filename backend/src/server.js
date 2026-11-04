import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { pool } from "./db.js";
import { HttpError } from "./lib/http.js";
import { CATEGORIES, ROLES } from "./constants.js";

import * as blockchain from "./modules/blockchain/index.js";
import * as ipfs from "./modules/ipfs/index.js";
import { router as authentication } from "./modules/authentication/index.js";
import { router as reporting } from "./modules/reporting/index.js";
import { router as consent } from "./modules/consent/index.js";
import { router as notification, startListener } from "./modules/notification/index.js";
import { router as accessControl } from "./modules/accessControl/index.js";
import { router as audit } from "./modules/audit/index.js";
import { router as administration } from "./modules/administration/index.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(helmet());
app.use(cors({ origin: config.frontendOrigin, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: config.apiRequestsPerMin, standardHeaders: true, legacyHeaders: false }));
// No request logging: IP addresses, bodies and CIDs are never written to application logs.

app.get("/api/config", (_req, res) =>
  res.json({
    chainId: blockchain.deployed.chainId,
    contracts: {
      ReportRegistry: blockchain.deployed.ReportRegistry,
      ConsentManagement: blockchain.deployed.ConsentManagement,
      AuditTrail: blockchain.deployed.AuditTrail,
    },
    admin: blockchain.deployed.admin,
    categories: CATEGORIES,
    roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])),
    limits: { maxEvidenceFiles: config.maxEvidenceFiles, maxEvidenceFileMb: config.maxEvidenceFileBytes / 1024 / 1024 },
  })
);

app.get("/api/health", async (_req, res) => {
  const check = async (fn) => { try { await fn(); return "ok"; } catch { return "unreachable"; } };
  res.json({
    database: await check(() => pool.query("SELECT 1")),
    blockchain: await check(() => blockchain.provider.getBlockNumber()),
    ipfs: await check(() => ipfs.id()),
  });
});

app.use("/api/auth", authentication);
app.use("/api/reports", reporting);
app.use("/api/consent", consent);
app.use("/api/notifications", notification);
app.use("/api/access", accessControl);
app.use("/api/audit", audit);
app.use("/api/admin", administration);
app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found.")));

// Optional: serve the built web app (frontend/dist) from the same origin for the demonstration.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { index: "index.html" }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// Generic error handler: never returns stack traces or internal messages.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "The request is too large." });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "The request could not be read." });
  console.error("[error]", err?.code || err?.name || "Error", err?.shortMessage || err?.message?.slice(0, 200));
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  console.log("GBV consent system backend");
  console.log("Modules: authentication, reporting, consent, notification, blockchain, ipfs, accessControl, audit, administration");
  try {
    const info = await blockchain.chainInfo();
    console.log(`Blockchain: chainId ${info.chainId}, block ${info.block}, contracts ReportRegistry ${blockchain.deployed.ReportRegistry}, ConsentManagement ${blockchain.deployed.ConsentManagement}, AuditTrail ${blockchain.deployed.AuditTrail}`);
    if (info.chainId !== blockchain.deployed.chainId) console.warn("Warning: connected chain id differs from the deployment.");
  } catch {
    console.warn("Blockchain: not reachable at", config.rpcUrl, "(start `npx hardhat node` and deploy)");
  }
  try { await pool.query("SELECT 1"); console.log("Database: connected"); } catch (e) { console.warn("Database: not reachable -", e.code); }
  try { console.log("IPFS: node", (await ipfs.id()).slice(0, 12) + "…"); } catch { console.warn("IPFS: not reachable at", config.ipfsApi); }
  startListener();
  app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}/api`));
}

if (process.env.NODE_ENV !== "test") start();
export { app };
