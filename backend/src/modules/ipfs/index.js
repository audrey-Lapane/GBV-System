// ipfs module: add, pin, fetch and unpin through the Kubo RPC API that IPFS Desktop exposes
// on port 5001. Only ciphertext ever reaches this module (enforced by the caller signature:
// it accepts an { encrypted: true } envelope only).
import { config } from "../../config.js";

async function rpc(path, init = {}) {
  const res = await fetch(`${config.ipfsApi}/api/v0/${path}`, { method: "POST", ...init });
  if (!res.ok) throw new Error(`IPFS ${path.split("?")[0]} failed with ${res.status}`);
  return res;
}

export async function add(envelope) {
  if (!envelope?.encrypted || !Buffer.isBuffer(envelope.bytes)) throw new Error("Refusing to send unencrypted data to IPFS");
  const form = new FormData();
  form.append("file", new Blob([envelope.bytes]), "item.bin");
  const res = await rpc("add?pin=true&cid-version=1&quiet=true", { body: form });
  const { Hash } = JSON.parse((await res.text()).trim().split("\n").pop());
  return Hash;
}

export async function cat(cid) {
  const res = await rpc(`cat?arg=${encodeURIComponent(cid)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function unpin(cid) {
  try {
    await rpc(`pin/rm?arg=${encodeURIComponent(cid)}`);
    return true;
  } catch {
    return false; // already unpinned; key destruction still makes it unreadable
  }
}

export async function id() {
  const res = await rpc("id");
  return (await res.json()).ID;
}
