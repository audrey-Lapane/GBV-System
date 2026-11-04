// Test helpers: deploy fixture and signature builders.
// The digest builders here are written independently of the frontend; parity.test.js checks
// that the frontend's own code produces signatures the contracts accept.
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const coder = ethers.AbiCoder.defaultAbiCoder();
const tag = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const enc = (types, values) => ethers.keccak256(coder.encode(types, values));
const sign = (wallet, digest) => wallet.signMessage(ethers.getBytes(digest));

const ROLE = { OFFICE: 1, LEGAL: 2, HEALTH: 3, SOCIAL: 4 };
const SEC = { SUMMARY: 1, DETAILS: 2, EVIDENCE: 4, ALL: 7 };
const DAY = 24 * 60 * 60;

async function deploy() {
  const [admin, gateway, office, social, outsider, legal] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const registry = await (await ethers.getContractFactory("ReportRegistry")).deploy();
  const consent = await (await ethers.getContractFactory("ConsentManagement")).deploy(
    await registry.getAddress(),
    admin.address
  );
  const audit = await (await ethers.getContractFactory("AuditTrail")).deploy(
    await consent.getAddress(),
    gateway.address
  );

  const addr = {
    registry: await registry.getAddress(),
    consent: await consent.getAddress(),
    audit: await audit.getAddress(),
  };

  const s = {
    hashItems(items) {
      const parts = items.map((it) =>
        enc(["uint8", "bytes32", "bytes32"], [it.section, it.contentHash, ethers.keccak256(ethers.toUtf8Bytes(it.cid))])
      );
      return ethers.keccak256(ethers.concat(parts));
    },
    register: (w, reportId, items, reporter = w.address) =>
      sign(
        w,
        enc(
          ["address", "uint256", "bytes32", "bytes32", "address", "bytes32"],
          [addr.registry, chainId, tag("GBV.REGISTER"), reportId, reporter, s.hashItems(items)]
        )
      ),
    addItem: (w, reportId, item, nonce) =>
      sign(
        w,
        enc(
          ["address", "uint256", "bytes32", "bytes32", "uint8", "bytes32", "bytes32", "uint256"],
          [addr.registry, chainId, tag("GBV.ADD_ITEM"), reportId, item.section, item.contentHash,
            ethers.keccak256(ethers.toUtf8Bytes(item.cid)), nonce]
        )
      ),
    withdrawItem: (w, reportId, index, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint256", "uint256"],
        [addr.registry, chainId, tag("GBV.WITHDRAW_ITEM"), reportId, index, nonce])),
    withdrawReport: (w, reportId, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint256"],
        [addr.registry, chainId, tag("GBV.WITHDRAW_REPORT"), reportId, nonce])),
    createConsent: (w, reportId, category, reportDay, shareNow, scope, validUntil) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint8", "uint32", "bool", "uint8", "uint64"],
        [addr.consent, chainId, tag("GBV.CREATE_CONSENT"), reportId, category, reportDay, shareNow, scope, validUntil])),
    grant: (w, reportId, role, scope, validUntil, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint8", "uint8", "uint64", "uint256"],
        [addr.consent, chainId, tag("GBV.GRANT"), reportId, role, scope, validUntil, nonce])),
    revoke: (w, reportId, role, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
        [addr.consent, chainId, tag("GBV.REVOKE"), reportId, role, nonce])),
    request: (w, reportId, scope, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
        [addr.consent, chainId, tag("GBV.REQUEST_ACCESS"), reportId, scope, nonce])),
    registerInst: (w, account, role, staffRef, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "address", "uint8", "bytes32", "uint256"],
        [addr.consent, chainId, tag("GBV.REGISTER_INSTITUTION"), account, role, staffRef, nonce])),
    deactivateInst: (w, account, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "address", "uint256"],
        [addr.consent, chainId, tag("GBV.DEACTIVATE_INSTITUTION"), account, nonce])),
    access: (w, reportId, sections, nonce) =>
      sign(w, enc(["address", "uint256", "bytes32", "bytes32", "uint8", "uint256"],
        [addr.audit, chainId, tag("GBV.ACCESS"), reportId, sections, nonce])),
  };

  const staffRef = (n) => ethers.keccak256(ethers.toUtf8Bytes("staff-" + n));

  // Register two staff through the administrator's signature (relayed by the gateway).
  await consent.connect(gateway).registerInstitution(
    office.address, ROLE.OFFICE, staffRef("office"), 0, await s.registerInst(admin, office.address, ROLE.OFFICE, staffRef("office"), 0));
  await consent.connect(gateway).registerInstitution(
    social.address, ROLE.SOCIAL, staffRef("social"), 1, await s.registerInst(admin, social.address, ROLE.SOCIAL, staffRef("social"), 1));

  return { admin, gateway, office, social, outsider, legal, chainId, registry, consent, audit, addr, s, staffRef };
}

function item(section = SEC.SUMMARY, seed = "summary") {
  return { section, contentHash: ethers.keccak256(ethers.toUtf8Bytes("ciphertext-" + seed)), cid: "bafy" + seed };
}

/** Registers a report and creates consent. Returns { reporter, reportId }. */
async function fileReport(f, { shareNow = false, scope = SEC.ALL, days = 30, items } = {}) {
  const reporter = ethers.Wallet.createRandom();
  const reportId = ethers.hexlify(ethers.randomBytes(32));
  const list = items ?? [item(SEC.SUMMARY, reportId)];
  await f.registry.connect(f.gateway).registerReport(reportId, reporter.address, list, await f.s.register(reporter, reportId, list));
  const validUntil = BigInt(await time.latest()) + BigInt(days * DAY);
  const reportDay = Math.floor((await time.latest()) / DAY);
  await f.consent.connect(f.gateway).createConsent(
    reportId, 2, reportDay, shareNow, scope, validUntil,
    await f.s.createConsent(reporter, reportId, 2, reportDay, shareNow, scope, validUntil)
  );
  return { reporter, reportId, items: list, validUntil, reportDay };
}

async function grant(f, r, role, scope = SEC.ALL, days = 30) {
  const nonce = await f.consent.nonceOf(r.reportId);
  const validUntil = BigInt(await time.latest()) + BigInt(days * DAY);
  await f.consent.connect(f.gateway).grantAccess(
    r.reportId, role, scope, validUntil, nonce, await f.s.grant(r.reporter, r.reportId, role, scope, validUntil, nonce));
  return validUntil;
}

/** Staff access attempt through the gateway; returns the `permitted` flag from the event. */
async function attempt(f, staff, reportId, sections = SEC.ALL) {
  const nonce = await f.audit.accessNonce(staff.address);
  const tx = await f.audit.connect(f.gateway).logAccess(reportId, sections, nonce, await f.s.access(staff, reportId, sections, nonce));
  const receipt = await tx.wait();
  const ev = receipt.logs.map((l) => f.audit.interface.parseLog(l)).find((e) => e && e.name === "AccessLogged");
  return ev.args.permitted;
}

module.exports = { deploy, fileReport, grant, attempt, item, ROLE, SEC, DAY };
