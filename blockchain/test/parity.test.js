// Signature parity: the browser's own key derivation and digest code (frontend/src/crypto)
// must produce signatures that the deployed contracts accept. If this fails, the digest
// field order or encoding differs between the frontend and Solidity.
const path = require("path");
const fs = require("fs");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deploy, ROLE, SEC, DAY } = require("./helpers");

const cryptoDir = path.join(__dirname, "..", "..", "frontend", "src", "crypto");
const frontendInstalled = fs.existsSync(path.join(__dirname, "..", "..", "frontend", "node_modules", "ethers"));

(frontendInstalled ? describe : describe.skip)("Browser signing parity (needs frontend npm install)", function () {
  let secretLib, signing;
  before(async function () {
    secretLib = await import(path.join(cryptoDir, "secret.js"));
    signing = await import(path.join(cryptoDir, "signing.js"));
  });

  it("P01 derives a stable key from the secret and reportId", async function () {
    const id = secretLib.generateReportId();
    const secret = secretLib.generateSecret();
    expect(secretLib.isValidSecret(secret)).to.equal(true);
    const a = await secretLib.reporterWallet(secret, id);
    const b = await secretLib.reporterWallet(secret.toLowerCase().replace(/-/g, " "), id);
    expect(a.address).to.equal(b.address);
    const c = await secretLib.reporterWallet(secretLib.generateSecret(), id);
    expect(c.address).not.to.equal(a.address);
  });

  it("P02 the contracts accept register, createConsent, grant, revoke and withdraw signed by browser code", async function () {
    const f = await loadFixture(deploy);
    const id = secretLib.generateReportId();
    const wallet = await secretLib.reporterWallet(secretLib.generateSecret(), id);
    const base = { chainId: f.chainId, reportId: id };
    const items = [{ section: 1, contentHash: ethers.keccak256("0x1234"), cid: "bafytest" }];

    expect(signing.hashItems(items)).to.equal(f.s.hashItems(items));

    let d = signing.digests.register({ ...base, registry: f.addr.registry, reporter: wallet.address, items });
    await f.registry.registerReport(id, wallet.address, items, await signing.signWithWallet(wallet, d));

    const until = BigInt(await time.latest()) + BigInt(DAY);
    d = signing.digests.createConsent({ ...base, consent: f.addr.consent, category: 1, reportDay: 2, shareNow: false, scope: SEC.ALL, validUntil: until });
    await expect(f.consent.createConsent(id, 1, 2, false, SEC.ALL, until, await signing.signWithWallet(wallet, d)))
      .to.emit(f.consent, "AlertSent");

    d = signing.digests.grant({ ...base, consent: f.addr.consent, role: ROLE.OFFICE, scope: SEC.SUMMARY, validUntil: until, nonce: 0 });
    await f.consent.grantAccess(id, ROLE.OFFICE, SEC.SUMMARY, until, 0, await signing.signWithWallet(wallet, d));
    expect(await f.consent.checkConsent(id, ROLE.OFFICE, SEC.SUMMARY)).to.equal(true);

    d = signing.digests.revoke({ ...base, consent: f.addr.consent, role: ROLE.OFFICE, nonce: 1 });
    await f.consent.revokeConsent(id, ROLE.OFFICE, 1, await signing.signWithWallet(wallet, d));

    const extra = { section: 4, contentHash: ethers.keccak256("0xabcd"), cid: "bafyevidence" };
    d = signing.digests.addItem({ ...base, registry: f.addr.registry, item: extra, nonce: 0 });
    await f.registry.addItem(id, extra, 0, await signing.signWithWallet(wallet, d));

    d = signing.digests.withdrawItem({ ...base, registry: f.addr.registry, index: 1, nonce: 1 });
    await f.registry.withdrawItem(id, 1, 1, await signing.signWithWallet(wallet, d));

    d = signing.digests.withdrawReport({ ...base, registry: f.addr.registry, nonce: 2 });
    await expect(f.registry.withdrawReport(id, 2, await signing.signWithWallet(wallet, d))).to.emit(f.registry, "ReportWithdrawn");
  });

  it("P03 staff and administrator digests match (request, register institution, access)", async function () {
    const f = await loadFixture(deploy);
    const nonce = await f.consent.adminNonce();
    const ref = ethers.keccak256("0x01");
    let d = signing.digests.registerInstitution({ consent: f.addr.consent, chainId: f.chainId, account: f.legal.address, role: ROLE.LEGAL, staffRef: ref, nonce });
    await f.consent.registerInstitution(f.legal.address, ROLE.LEGAL, ref, nonce, await f.admin.signMessage(ethers.getBytes(d)));
    expect((await f.consent.institutionOf(f.legal.address)).role).to.equal(ROLE.LEGAL);

    // a report to request
    const id = secretLib.generateReportId();
    const w = await secretLib.reporterWallet(secretLib.generateSecret(), id);
    const items = [{ section: 1, contentHash: ethers.keccak256("0x99"), cid: "bafyx" }];
    await f.registry.registerReport(id, w.address, items,
      await signing.signWithWallet(w, signing.digests.register({ registry: f.addr.registry, chainId: f.chainId, reportId: id, reporter: w.address, items })));
    const until = BigInt(await time.latest()) + BigInt(DAY);
    await f.consent.createConsent(id, 1, 1, true, SEC.ALL, until,
      await signing.signWithWallet(w, signing.digests.createConsent({ consent: f.addr.consent, chainId: f.chainId, reportId: id, category: 1, reportDay: 1, shareNow: true, scope: SEC.ALL, validUntil: until })));

    d = signing.digests.requestAccess({ consent: f.addr.consent, chainId: f.chainId, reportId: id, scope: SEC.SUMMARY, nonce: 0 });
    await expect(f.consent.requestAccess(id, SEC.SUMMARY, 0, await f.office.signMessage(ethers.getBytes(d))))
      .to.emit(f.consent, "AccessRequested");

    d = signing.digests.access({ audit: f.addr.audit, chainId: f.chainId, reportId: id, sections: SEC.SUMMARY, nonce: 0 });
    await expect(f.audit.connect(f.gateway).logAccess(id, SEC.SUMMARY, 0, await f.office.signMessage(ethers.getBytes(d))))
      .to.emit(f.audit, "AccessLogged").withArgs(id, f.office.address, f.staffRef("office"), ROLE.OFFICE, SEC.SUMMARY, true);
  });
});
