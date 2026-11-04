// Reporter secret and key derivation. Runs in the browser only.
// The secret and private key never leave this module's callers' memory: they are not sent
// to the server and never written to localStorage, sessionStorage or cookies.
import { Wallet } from "ethers";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid misreading

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 32 random bytes as 0x hex (a bytes32). */
export function generateReportId() {
  return "0x" + toHex(randomBytes(32));
}

/** 30 characters from a 32-symbol alphabet = 150 bits, shown as six groups of five. */
export function generateSecret() {
  const bytes = randomBytes(30);
  const chars = [...bytes].map((b) => ALPHABET[b & 31]).join("");
  return chars.match(/.{5}/g).join("-");
}

/** Normalise what the reporter typed: case, spaces and dashes do not matter. */
export function normaliseSecret(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.match(/.{1,5}/g)?.join("-") ?? "";
}

export function isValidSecret(input) {
  const s = normaliseSecret(input).replace(/-/g, "");
  return s.length === 30 && [...s].every((c) => ALPHABET.includes(c));
}

export function isValidReportId(id) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(id).trim());
}

/** HKDF-SHA256(secret, salt = reportId) -> 32-byte private key, as 0x hex. */
export async function deriveReporterKey(secret, reportId) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(normaliseSecret(secret)), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(reportId.toLowerCase()), info: enc.encode("gbv-reporter-key") },
    base,
    256
  );
  return "0x" + toHex(new Uint8Array(bits));
}

/** Returns an ethers Wallet for the reporter (address is what the contract stores). */
export async function reporterWallet(secret, reportId) {
  return new Wallet(await deriveReporterKey(secret, reportId));
}
