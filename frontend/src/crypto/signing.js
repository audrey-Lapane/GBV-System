// Digests for every signed action. Field order and types MUST match the Solidity contracts:
// keccak256(abi.encode(contract, chainId, TAG, ...fields)), signed as an EIP-191 personal message.
// The same code is imported by blockchain/test/parity.test.js to prove the contract accepts it.
import { AbiCoder, getBytes, keccak256, toUtf8Bytes } from "ethers";

const coder = AbiCoder.defaultAbiCoder();
const tag = (name) => keccak256(toUtf8Bytes(name));

export const TAGS = {
  REGISTER: tag("GBV.REGISTER"),
  ADD_ITEM: tag("GBV.ADD_ITEM"),
  WITHDRAW_ITEM: tag("GBV.WITHDRAW_ITEM"),
  WITHDRAW_REPORT: tag("GBV.WITHDRAW_REPORT"),
  CREATE_CONSENT: tag("GBV.CREATE_CONSENT"),
  GRANT: tag("GBV.GRANT"),
  REVOKE: tag("GBV.REVOKE"),
  REQUEST_ACCESS: tag("GBV.REQUEST_ACCESS"),
  REGISTER_INSTITUTION: tag("GBV.REGISTER_INSTITUTION"),
  DEACTIVATE_INSTITUTION: tag("GBV.DEACTIVATE_INSTITUTION"),
  ACCESS: tag("GBV.ACCESS"),
  READ: tag("GBV.READ"), // off-chain: proves the reporter holds the secret when opening the portal
};

const enc = (types, values) => keccak256(coder.encode(types, values));

/** Matches ReportRegistry.hashItems: items = [{ section, contentHash, cid }] */
export function hashItems(items) {
  const parts = items.map((it) =>
    enc(["uint8", "bytes32", "bytes32"], [it.section, it.contentHash, keccak256(toUtf8Bytes(it.cid))])
  );
  return keccak256("0x" + parts.map((p) => p.slice(2)).join(""));
}

export const digests = {
  register: ({ registry, chainId, reportId, reporter, items }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "address", "bytes32"],
      [registry, chainId, TAGS.REGISTER, reportId, reporter, hashItems(items)]
    ),
  addItem: ({ registry, chainId, reportId, item, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "bytes32", "bytes32", "uint256"],
      [registry, chainId, TAGS.ADD_ITEM, reportId, item.section, item.contentHash, keccak256(toUtf8Bytes(item.cid)), nonce]
    ),
  withdrawItem: ({ registry, chainId, reportId, index, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint256", "uint256"],
      [registry, chainId, TAGS.WITHDRAW_ITEM, reportId, index, nonce]
    ),
  withdrawReport: ({ registry, chainId, reportId, nonce }) =>
    enc(["address", "uint256", "bytes32", "bytes32", "uint256"], [registry, chainId, TAGS.WITHDRAW_REPORT, reportId, nonce]),
  createConsent: ({ consent, chainId, reportId, category, reportDay, shareNow, scope, validUntil }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "uint32", "bool", "uint8", "uint64"],
      [consent, chainId, TAGS.CREATE_CONSENT, reportId, category, reportDay, shareNow, scope, validUntil]
    ),
  grant: ({ consent, chainId, reportId, role, scope, validUntil, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "uint8", "uint64", "uint256"],
      [consent, chainId, TAGS.GRANT, reportId, role, scope, validUntil, nonce]
    ),
  revoke: ({ consent, chainId, reportId, role, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
      [consent, chainId, TAGS.REVOKE, reportId, role, nonce]
    ),
  requestAccess: ({ consent, chainId, reportId, scope, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
      [consent, chainId, TAGS.REQUEST_ACCESS, reportId, scope, nonce]
    ),
  registerInstitution: ({ consent, chainId, account, role, staffRef, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "address", "uint8", "bytes32", "uint256"],
      [consent, chainId, TAGS.REGISTER_INSTITUTION, account, role, staffRef, nonce]
    ),
  deactivateInstitution: ({ consent, chainId, account, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "address", "uint256"],
      [consent, chainId, TAGS.DEACTIVATE_INSTITUTION, account, nonce]
    ),
  access: ({ audit, chainId, reportId, sections, nonce }) =>
    enc(
      ["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
      [audit, chainId, TAGS.ACCESS, reportId, sections, nonce]
    ),
  read: ({ registry, chainId, reportId, ts }) =>
    enc(["address", "uint256", "bytes32", "bytes32", "uint256"], [registry, chainId, TAGS.READ, reportId, ts]),
};

/** A fresh signed read proof for the reporter portal: { ts, signature }. */
export async function readProof(wallet, cfg, reportId) {
  const ts = Math.floor(Date.now() / 1000);
  const digest = digests.read({ registry: cfg.contracts.ReportRegistry, chainId: cfg.chainId, reportId, ts });
  return { ts, signature: await signWithWallet(wallet, digest) };
}

/** Sign with an ethers Wallet (reporter key derived in the browser). */
export function signWithWallet(wallet, digest) {
  return wallet.signMessage(getBytes(digest));
}

/** Sign with MetaMask (staff and administrator). personal_sign over the raw 32 bytes. */
export async function signWithMetaMask(address, digest) {
  if (!window.ethereum) throw new Error("MetaMask is not available in this browser.");
  return window.ethereum.request({ method: "personal_sign", params: [digest, address] });
}

export async function connectMetaMask() {
  if (!window.ethereum) throw new Error("MetaMask is not available in this browser.");
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  return account;
}
