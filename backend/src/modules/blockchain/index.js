// blockchain module: the only module that imports ethers.js for chain access.
// Loads ABIs and addresses written by blockchain/scripts/deploy.js. Holds no state of its own
// beyond the connection: every decision is read from the contracts.
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { config } from "../../config.js";
import { chainError } from "../../lib/http.js";

function load(f) {
  try {
    return JSON.parse(readFileSync(new URL(`../../contracts/${f}`, import.meta.url), "utf8"));
  } catch {
    throw new Error(`backend/src/contracts/${f} not found. Start the chain and run the deploy script first:\n  cd blockchain && npx hardhat node   (separate terminal)\n  cd blockchain && npm run deploy`);
  }
}

export const deployed = load("deployed-addresses.json");
export const provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, { pollingInterval: 1000 });
const gatewayWallet = new ethers.Wallet(config.gatewayKey, provider);
const gateway = new ethers.NonceManager(gatewayWallet);

if (gatewayWallet.address.toLowerCase() !== deployed.gateway.toLowerCase()) {
  console.warn(`[blockchain] GATEWAY_PRIVATE_KEY (${gatewayWallet.address}) is not the AuditTrail gateway (${deployed.gateway}).`);
}

export const registry = new ethers.Contract(deployed.ReportRegistry, load("ReportRegistry.json").abi, gateway);
export const consent = new ethers.Contract(deployed.ConsentManagement, load("ConsentManagement.json").abi, gateway);
export const audit = new ethers.Contract(deployed.AuditTrail, load("AuditTrail.json").abi, gateway);

// Transactions go out one at a time so the relayer's nonces never collide.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/**
 * Sends a transaction from the gateway and waits for it to be mined.
 * Returns { hash, blockNumber, gasUsed, events } with events parsed from all three contracts.
 */
export function send(contract, method, args) {
  return serial(async () => {
    try {
      const tx = await contract[method](...args);
      const receipt = await tx.wait();
      return { hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), events: parseLogs(receipt.logs) };
    } catch (e) {
      try { gateway.reset(); } catch { /* ignore */ }
      throw chainError(e, [registry.interface, consent.interface, audit.interface]);
    }
  });
}

const byAddress = () => ({
  [deployed.ReportRegistry.toLowerCase()]: registry,
  [deployed.ConsentManagement.toLowerCase()]: consent,
  [deployed.AuditTrail.toLowerCase()]: audit,
});

export function parseLogs(logs) {
  const map = byAddress();
  return logs
    .map((log) => {
      const c = map[log.address.toLowerCase()];
      if (!c) return null;
      const parsed = c.interface.parseLog(log);
      return parsed && { name: parsed.name, args: parsed.args, txHash: log.transactionHash, logIndex: log.index, blockNumber: log.blockNumber };
    })
    .filter(Boolean);
}

/** All events for one report across the three contracts, oldest first, with block times. */
export async function reportHistory(reportId) {
  const from = deployed.deployBlock ?? 0;
  const filters = [
    [registry, ["ReportRegistered", "ItemAdded", "ItemWithdrawn", "ReportWithdrawn"]],
    [consent, ["AlertSent", "ConsentGranted", "ConsentRevoked", "AccessRequested"]],
    [audit, ["AccessLogged"]],
  ];
  const results = [];
  for (const [c, names] of filters) {
    for (const n of names) {
      const evs = await c.queryFilter(c.filters[n](reportId), from);
      for (const e of evs) results.push({ name: n, args: e.args, txHash: e.transactionHash, logIndex: e.index, blockNumber: e.blockNumber });
    }
  }
  results.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const times = {};
  for (const r of results) {
    if (!(r.blockNumber in times)) times[r.blockNumber] = (await provider.getBlock(r.blockNumber)).timestamp;
    r.timestamp = times[r.blockNumber];
  }
  return results;
}

export async function chainInfo() {
  const net = await provider.getNetwork();
  return { chainId: Number(net.chainId), block: await provider.getBlockNumber() };
}

/** Recovers the signer of an EIP-191 message over a 32-byte digest (used for login-binding checks). */
export const recover = (digest, signature) => ethers.verifyMessage(ethers.getBytes(digest), signature);
export { ethers };
