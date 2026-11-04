import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return v;
}

function hexKey(name) {
  const v = required(name);
  if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} must be 64 hex characters (32 bytes)`);
  return Buffer.from(v, "hex");
}

const num = (name, def) => Number(process.env[name] ?? def);

export const config = {
  port: num("PORT", 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: num("DB_PORT", 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "gbv_consent",
  },
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  gatewayKey: required("GATEWAY_PRIVATE_KEY"),
  ipfsApi: process.env.IPFS_API_URL || "http://127.0.0.1:5001",
  masterKey: hexKey("MASTER_KEY"),
  staffRefKey: hexKey("STAFF_REF_KEY"),
  jwtSecret: required("JWT_SECRET"),
  jwtLifetimeMinutes: num("JWT_LIFETIME_MINUTES", 30),
  maxFailedLogins: num("MAX_FAILED_LOGINS", 5),
  lockoutMinutes: num("LOCKOUT_MINUTES", 15),
  maxEvidenceFiles: num("MAX_EVIDENCE_FILES", 5),
  maxEvidenceFileBytes: num("MAX_EVIDENCE_FILE_MB", 10) * 1024 * 1024,
  pendingMinutes: num("PENDING_SUBMISSION_MINUTES", 15),
  reporterProofMaxAge: num("REPORTER_PROOF_MAX_AGE_SECONDS", 300),
  // Submissions per hour per IP. The low default is a deliberate abuse control; the
  // evaluation harness raises it so it can make the hundreds of trials the metrics need.
  submitsPerHour: num("RATE_LIMIT_SUBMITS_PER_HOUR", 20),
  portalReadsPer15Min: num("RATE_LIMIT_PORTAL_PER_15MIN", 60),
  loginsPer15Min: num("RATE_LIMIT_LOGIN_PER_15MIN", 30),
  apiRequestsPerMin: num("RATE_LIMIT_API_PER_MIN", 300),
};
