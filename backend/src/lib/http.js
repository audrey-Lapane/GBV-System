// Error type, async wrapper and validators shared by all modules.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const isBytes32 = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
export const isAddress = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
export const isSignature = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v);
export const isUint = (v) => (typeof v === "number" || typeof v === "string") && /^\d+$/.test(String(v));

export function need(cond, message, status = 400) {
  if (!cond) throw new HttpError(status, message);
}

/** Turns a contract revert into a plain 4xx message without leaking internals. */
export function chainError(e, interfaces = []) {
  let name = e?.revert?.name;
  if (!name) {
    const data = [e?.data, e?.info?.error?.data, e?.error?.data].find((d) => typeof d === "string" && d.startsWith("0x"));
    for (const iface of interfaces) {
      try { name = iface.parseError(data)?.name; } catch { /* not this contract */ }
      if (name) break;
    }
  }
  const known = {
    BadSignature: "The signature does not match the key on record.",
    BadNonce: "This request is out of date. Please try again.",
    AlreadyRegistered: "This report ID is already registered.",
    AlreadyCreated: "Consent for this report already exists.",
    UnknownReport: "Report not found.",
    ReportNotActive: "This report has been withdrawn.",
    ReportIsWithdrawn: "This report has been withdrawn.",
    NotInstitution: "This wallet is not registered to an approved staff account.",
    NotGranted: "There is no active consent for that role.",
    BadExpiry: "The expiry date must be in the future.",
    BadRole: "Unknown role.",
    BadScope: "Choose at least one section.",
  };
  if (name && known[name]) return new HttpError(409, known[name]);
  return e;
}
