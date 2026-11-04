// authentication module: individual staff accounts only (one person, one staff number).
// Registration creates a pending account; the administrator approves it and binds one wallet.
// Passwords are bcrypt-hashed; accounts lock after repeated failures; JWTs are short-lived and
// carry the role and staff reference, never the name. There are no reporter accounts.
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { config } from "../../config.js";
import { query, one } from "../../db.js";
import { HttpError, wrap, need } from "../../lib/http.js";
import { ROLE_ID } from "../../constants.js";

const BCRYPT_ROUNDS = 12;
const STAFF_ROLES = ["gbv_office", "legal", "health", "social_worker"];
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", BCRYPT_ROUNDS);

export const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.loginsPer15Min, standardHeaders: true, legacyHeaders: false });

router.post("/register", loginLimiter, wrap(async (req, res) => {
  const { staffNumber, name, email, role, password, walletAddress } = req.body || {};
  need(/^[A-Za-z0-9-]{3,32}$/.test(staffNumber || ""), "Enter your staff number.");
  need((name || "").trim().length >= 2 && name.length <= 120, "Enter your full name.");
  need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "") && email.length <= 160, "Enter your work email.");
  need(STAFF_ROLES.includes(role), "Choose your role.");
  need(typeof password === "string" && password.length >= 10 && password.length <= 128, "Use a password of at least 10 characters.");
  need(!walletAddress || /^0x[0-9a-fA-F]{40}$/.test(walletAddress), "The wallet address is not valid.");
  const exists = await one("SELECT id FROM institutional_users WHERE staff_number = ?", [staffNumber.toUpperCase()]);
  need(!exists, "An account with this staff number already exists.", 409);
  await query(
    "INSERT INTO institutional_users (staff_number, name, work_email, role, password_hash, requested_wallet) VALUES (?,?,?,?,?,?)",
    [staffNumber.toUpperCase(), name.trim(), email.trim(), role, await bcrypt.hash(password, BCRYPT_ROUNDS), walletAddress || null]
  );
  res.status(201).json({ status: "pending", message: "Your account is waiting for approval by the administrator." });
}));

router.post("/login", loginLimiter, wrap(async (req, res) => {
  const { staffNumber, password } = req.body || {};
  const generic = new HttpError(401, "Staff number or password is not correct.");
  if (typeof staffNumber !== "string" || typeof password !== "string") throw generic;
  const u = await one("SELECT * FROM institutional_users WHERE staff_number = ?", [staffNumber.trim().toUpperCase()]);
  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH); // equalise timing so staff numbers cannot be probed
    throw generic;
  }
  if (u.locked_until && new Date(u.locked_until + "Z") > new Date()) {
    throw new HttpError(423, "This account is locked after too many failed attempts. Try again later.");
  }
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const failed = u.failed_attempts + 1;
    if (failed >= config.maxFailedLogins) {
      await query("UPDATE institutional_users SET failed_attempts = 0, locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?", [config.lockoutMinutes, u.id]);
      throw new HttpError(423, "This account is locked after too many failed attempts. Try again later.");
    }
    await query("UPDATE institutional_users SET failed_attempts = ? WHERE id = ?", [failed, u.id]);
    throw generic;
  }
  await query("UPDATE institutional_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", [u.id]);
  if (u.status === "pending") throw new HttpError(403, "Your account is waiting for approval by the administrator.");
  if (u.status === "suspended") throw new HttpError(403, "Your account is suspended. Contact the administrator.");

  const token = jwt.sign(
    { uid: u.id, role: u.role, staffRef: u.staff_ref, wallet: u.wallet_address },
    config.jwtSecret,
    { expiresIn: `${config.jwtLifetimeMinutes}m`, algorithm: "HS256" }
  );
  res.json({
    token,
    expiresInMinutes: config.jwtLifetimeMinutes,
    user: { role: u.role, roleId: ROLE_ID[u.role] ?? 0, staffRef: u.staff_ref, wallet: u.wallet_address, name: u.name },
    notice: "All access to reports is recorded with your staff reference and can be audited.",
  });
}));

/** Middleware: valid JWT, account still approved, role in `roles` (or any staff role if omitted). */
export function requireStaff(roles) {
  return wrap(async (req, _res, next) => {
    const h = req.get("authorization") || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) throw new HttpError(401, "Please log in.");
    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    } catch {
      throw new HttpError(401, "Your session has ended. Please log in again.");
    }
    const u = await one("SELECT id, role, status, staff_ref, wallet_address, name FROM institutional_users WHERE id = ?", [claims.uid]);
    if (!u || u.status !== "approved") throw new HttpError(403, "Your account is not active.");
    if (u.role !== claims.role) throw new HttpError(401, "Your session has ended. Please log in again.");
    if (roles && !roles.includes(u.role)) throw new HttpError(403, "Your role does not allow this.");
    req.staff = { id: u.id, role: u.role, roleId: ROLE_ID[u.role] ?? 0, staffRef: u.staff_ref, wallet: u.wallet_address, name: u.name };
    next();
  });
}

router.get("/me", requireStaff(), (req, res) => res.json({ user: req.staff }));
