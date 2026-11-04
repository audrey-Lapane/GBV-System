// Rate-limiting row of the attack matrix, measured on its own against the SHIPPED defaults.
// It is separate from metrics.mjs because that harness deliberately raises the limits so it can
// make hundreds of trials; this script must run against a backend started with .env defaults.
//
//   1. comment out the RATE_LIMIT_* lines in backend/.env (or set them to the defaults)
//   2. restart the backend
//   3. cd evaluation && node ratelimit.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const API = process.env.API_URL || "http://localhost:4000/api";
const post = (p, body) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const attempts = [];
for (let i = 0; i < 60; i++) {
  const r = await post("/auth/login", { staffNumber: "GUESS" + i, password: "wrong-password" });
  attempts.push(r.status);
  if (r.status === 429 && attempts.filter((s) => s === 429).length >= 5) break;
}
const first429 = attempts.indexOf(429) + 1;
const out = {
  measuredAt: new Date().toISOString(),
  endpoint: "POST /api/auth/login",
  attemptsMade: attempts.length,
  firstRateLimitedAtAttempt: first429 || null,
  rateLimited: first429 > 0,
  statusSequence: attempts.join(","),
  configuredLimit: "RATE_LIMIT_LOGIN_PER_15MIN (default 30 per 15 minutes per IP)",
  note: "run against the shipped defaults, not the raised limits used by metrics.mjs",
};
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL("./results/ratelimit-latest.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(out.rateLimited ? `Rate-limited from attempt ${first429} of ${attempts.length}.` : `NOT rate-limited in ${attempts.length} attempts.`);
console.log("Saved evaluation/results/ratelimit-latest.json");
