// Compares the MySQL audit mirror with the chain and prints every mismatch.  npm run reconcile
import { reconcile } from "../src/modules/audit/service.js";
import { pool } from "../src/db.js";

const r = await reconcile();
console.log(`Checked ${r.reports} reports: ${r.chainEvents} on-chain events, ${r.mirrorRows} mirror rows.`);
if (r.ok) console.log("OK: the mirror matches the chain.");
else {
  console.log(`MISMATCH: ${r.mismatches.length} problem(s) found`);
  for (const m of r.mismatches) console.log(" -", m.reportId.slice(0, 10) + "…", m.txHash.slice(0, 10) + "…", m.problem, m.chain !== undefined ? `(chain ${m.chain}, mirror ${m.mirror})` : "");
}
await pool.end();
process.exit(r.ok ? 0 : 2);
