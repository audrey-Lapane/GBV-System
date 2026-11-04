// One fetch wrapper for every API call. Same-origin (/api); the JWT is attached only for staff
// and admin calls; request and response bodies are never logged.
const BASE = import.meta.env.VITE_API_URL || "/api";
const TIMEOUT_MS = 30000;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body, token, form } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: ctrl.signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (e) {
    throw new ApiError(0, e.name === "AbortError" ? "The server took too long to answer. Please try again." : "You appear to be offline, or the service is not running.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || "Something went wrong. Please try again.", data);
  return data;
}

let configPromise;
/** Public chain values: chain id, contract addresses, categories, roles. Never secrets. */
export function getConfig() {
  configPromise ??= api("/config").catch((e) => {
    configPromise = undefined;
    throw e;
  });
  return configPromise;
}
