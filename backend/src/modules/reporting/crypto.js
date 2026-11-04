// AES-256-GCM per item: fresh random key and 96-bit IV for every item; the authentication
// tag is appended to the ciphertext. The content key is stored only wrapped under MASTER_KEY.
import crypto from "node:crypto";
import { config } from "../../config.js";

export function encryptItem(plaintext) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { envelope: { encrypted: true, bytes }, key, iv, contentHash: sha256Hex(bytes) };
}

export function decryptItem(bytes, key, iv) {
  const tag = bytes.subarray(bytes.length - 16);
  const body = bytes.subarray(0, bytes.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function wrapKey(key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", config.masterKey, iv);
  const enc = Buffer.concat([c.update(key), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function unwrapKey(wrapped) {
  const d = crypto.createDecipheriv("aes-256-gcm", config.masterKey, wrapped.subarray(0, 12));
  d.setAuthTag(wrapped.subarray(12, 28));
  return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
}

/** SHA-256 as a 0x-prefixed bytes32, the form stored on-chain. */
export const sha256Hex = (buf) => "0x" + crypto.createHash("sha256").update(buf).digest("hex");

/** Keyed hash of a staff number (HMAC-SHA256). Staff numbers are guessable, so a plain hash would be weak. */
export const staffRefOf = (staffNumber) =>
  "0x" + crypto.createHmac("sha256", config.staffRefKey).update(String(staffNumber).trim().toUpperCase()).digest("hex");
