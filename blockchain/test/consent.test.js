const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deploy, fileReport, grant, attempt, item, ROLE, SEC, DAY } = require("./helpers");

describe("GBV consent system", function () {
  // ------------------------------------------------------------------ registration
  describe("ReportRegistry", function () {
    it("T01 registers a report signed by the reporter key and stores no identity", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      expect(await f.registry.reporterOf(r.reportId)).to.equal(r.reporter.address);
      const items = await f.registry.getItems(r.reportId);
      expect(items.length).to.equal(1);
      expect(items[0].cid).to.equal(r.items[0].cid);
    });

    it("T02 rejects a registration signed by a different key", async function () {
      const f = await loadFixture(deploy);
      const reporter = ethers.Wallet.createRandom();
      const attacker = ethers.Wallet.createRandom();
      const id = ethers.hexlify(ethers.randomBytes(32));
      const list = [item()];
      await expect(
        f.registry.registerReport(id, reporter.address, list, await f.s.register(attacker, id, list, reporter.address))
      ).to.be.revertedWithCustomError(f.registry, "BadSignature");
    });

    it("T03 rejects registration when the items differ from what the reporter signed", async function () {
      const f = await loadFixture(deploy);
      const reporter = ethers.Wallet.createRandom();
      const id = ethers.hexlify(ethers.randomBytes(32));
      const sig = await f.s.register(reporter, id, [item(1, "a")]);
      await expect(f.registry.registerReport(id, reporter.address, [item(1, "b")], sig))
        .to.be.revertedWithCustomError(f.registry, "BadSignature");
    });

    it("T04 cannot register the same report ID twice", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await expect(
        f.registry.registerReport(r.reportId, r.reporter.address, r.items, await f.s.register(r.reporter, r.reportId, r.items))
      ).to.be.revertedWithCustomError(f.registry, "AlreadyRegistered");
    });

    it("T05 verifyIntegrity passes for the stored hash and fails when one byte differs", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const h = r.items[0].contentHash;
      expect(await f.registry.verifyIntegrity(r.reportId, 0, h)).to.equal(true);
      const bytes = ethers.getBytes(h);
      bytes[31] ^= 0x01;
      expect(await f.registry.verifyIntegrity(r.reportId, 0, ethers.hexlify(bytes))).to.equal(false);
    });

    it("T06 adding details later creates a new item and leaves earlier items unchanged", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const before = await f.registry.getItems(r.reportId);
      const details = item(SEC.DETAILS, "details-later");
      await expect(
        f.registry.addItem(r.reportId, details, 0, await f.s.addItem(r.reporter, r.reportId, details, 0))
      ).to.emit(f.registry, "ItemAdded").withArgs(r.reportId, 1, SEC.DETAILS, details.contentHash);
      const after = await f.registry.getItems(r.reportId);
      expect(after.length).to.equal(2);
      expect(after[0].contentHash).to.equal(before[0].contentHash);
      expect(after[0].cid).to.equal(before[0].cid);
    });

    it("T07 addItem with a replayed nonce or another key reverts", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const it1 = item(SEC.EVIDENCE, "e1");
      const sig0 = await f.s.addItem(r.reporter, r.reportId, it1, 0);
      await f.registry.addItem(r.reportId, it1, 0, sig0);
      await expect(f.registry.addItem(r.reportId, it1, 0, sig0)).to.be.revertedWithCustomError(f.registry, "BadNonce");
      const other = ethers.Wallet.createRandom();
      await expect(
        f.registry.addItem(r.reportId, it1, 1, await f.s.addItem(other, r.reportId, it1, 1))
      ).to.be.revertedWithCustomError(f.registry, "BadSignature");
    });

    it("T08 rejects an unknown section value", async function () {
      const f = await loadFixture(deploy);
      const reporter = ethers.Wallet.createRandom();
      const id = ethers.hexlify(ethers.randomBytes(32));
      const bad = [item(3, "x")];
      await expect(f.registry.registerReport(id, reporter.address, bad, await f.s.register(reporter, id, bad)))
        .to.be.revertedWithCustomError(f.registry, "BadSection");
    });

    it("T09 withdrawItem deactivates one item; integrity check then fails for it", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await f.registry.withdrawItem(r.reportId, 0, 0, await f.s.withdrawItem(r.reporter, r.reportId, 0, 0));
      expect(await f.registry.verifyIntegrity(r.reportId, 0, r.items[0].contentHash)).to.equal(false);
    });
  });

  // ------------------------------------------------------------------ alert and consent
  describe("ConsentManagement", function () {
    it("T10 every report emits a minimal alert: ID, office role, category and day only", async function () {
      const f = await loadFixture(deploy);
      const reporter = ethers.Wallet.createRandom();
      const id = ethers.hexlify(ethers.randomBytes(32));
      const list = [item()];
      await f.registry.registerReport(id, reporter.address, list, await f.s.register(reporter, id, list));
      const day = 20000;
      const until = BigInt(await time.latest()) + BigInt(DAY);
      const tx = f.consent.createConsent(id, 3, day, false, SEC.ALL, until,
        await f.s.createConsent(reporter, id, 3, day, false, SEC.ALL, until));
      await expect(tx).to.emit(f.consent, "AlertSent").withArgs(id, ROLE.OFFICE, 3, day);
      await expect(tx).not.to.emit(f.consent, "ConsentGranted");
      const ev = f.consent.interface.getEvent("AlertSent");
      expect(ev.inputs.map((i) => i.name)).to.deep.equal(["reportId", "officeRole", "category", "reportDay"]);
    });

    it("T11 'share now' creates an expiring grant for the designated office", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true, scope: SEC.SUMMARY, days: 30 });
      const g = await f.consent.viewConsent(r.reportId, ROLE.OFFICE);
      expect(g.status).to.equal(1);
      expect(g.scope).to.equal(SEC.SUMMARY);
      expect(g.validUntil).to.equal(r.validUntil);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.SUMMARY)).to.equal(true);
    });

    it("T12 a choice altered after signing is rejected", async function () {
      const f = await loadFixture(deploy);
      const reporter = ethers.Wallet.createRandom();
      const id = ethers.hexlify(ethers.randomBytes(32));
      const list = [item()];
      await f.registry.registerReport(id, reporter.address, list, await f.s.register(reporter, id, list));
      const until = BigInt(await time.latest()) + BigInt(DAY);
      const sigAlertOnly = await f.s.createConsent(reporter, id, 2, 1, false, SEC.ALL, until);
      await expect(f.consent.createConsent(id, 2, 1, true, SEC.ALL, until, sigAlertOnly))
        .to.be.revertedWithCustomError(f.consent, "BadSignature");
    });

    it("T13 grant by the reporter succeeds", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await grant(f, r, ROLE.OFFICE);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.ALL)).to.equal(true);
    });

    it("T14 the same grant signed by any other key reverts (including the backend relayer)", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const until = BigInt(await time.latest()) + BigInt(DAY);
      for (const signer of [ethers.Wallet.createRandom(), f.gateway, f.admin]) {
        await expect(
          f.consent.connect(f.gateway).grantAccess(r.reportId, ROLE.OFFICE, SEC.ALL, until, 0,
            await f.s.grant(signer, r.reportId, ROLE.OFFICE, SEC.ALL, until, 0))
        ).to.be.revertedWithCustomError(f.consent, "BadSignature");
      }
    });

    it("T15 a replayed grant signature (old nonce) reverts", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const until = BigInt(await time.latest()) + BigInt(DAY);
      const sig = await f.s.grant(r.reporter, r.reportId, ROLE.OFFICE, SEC.ALL, until, 0);
      await f.consent.grantAccess(r.reportId, ROLE.OFFICE, SEC.ALL, until, 0, sig);
      await expect(f.consent.grantAccess(r.reportId, ROLE.OFFICE, SEC.ALL, until, 0, sig))
        .to.be.revertedWithCustomError(f.consent, "BadNonce");
    });

    it("T16 checkConsent is false before a grant, for another role, after revoke and after expiry", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.SUMMARY)).to.equal(false);
      const until = await grant(f, r, ROLE.OFFICE, SEC.ALL, 1);
      expect(await f.consent.checkConsent(r.reportId, ROLE.SOCIAL, SEC.SUMMARY)).to.equal(false);

      // expiry: permitted just before, denied just after
      await time.increaseTo(until);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.SUMMARY)).to.equal(true);
      await time.increaseTo(until + 1n);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.SUMMARY)).to.equal(false);

      // revoke
      await grant(f, r, ROLE.LEGAL);
      const nonce = await f.consent.nonceOf(r.reportId);
      await f.consent.revokeConsent(r.reportId, ROLE.LEGAL, nonce, await f.s.revoke(r.reporter, r.reportId, ROLE.LEGAL, nonce));
      expect(await f.consent.checkConsent(r.reportId, ROLE.LEGAL, SEC.SUMMARY)).to.equal(false);
    });

    it("T17 revoke leaves the record readable with status Revoked", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await grant(f, r, ROLE.OFFICE);
      const nonce = await f.consent.nonceOf(r.reportId);
      await expect(
        f.consent.revokeConsent(r.reportId, ROLE.OFFICE, nonce, await f.s.revoke(r.reporter, r.reportId, ROLE.OFFICE, nonce))
      ).to.emit(f.consent, "ConsentRevoked").withArgs(r.reportId, ROLE.OFFICE);
      const g = await f.consent.viewConsent(r.reportId, ROLE.OFFICE);
      expect(g.status).to.equal(2);
      expect(g.scope).to.equal(SEC.ALL);
    });

    it("T18 revoke signed by another key reverts", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await grant(f, r, ROLE.OFFICE);
      const nonce = await f.consent.nonceOf(r.reportId);
      await expect(
        f.consent.revokeConsent(r.reportId, ROLE.OFFICE, nonce, await f.s.revoke(f.gateway, r.reportId, ROLE.OFFICE, nonce))
      ).to.be.revertedWithCustomError(f.consent, "BadSignature");
    });

    it("T19 a summary-only grant does not cover details or evidence", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await grant(f, r, ROLE.OFFICE, SEC.SUMMARY);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.SUMMARY)).to.equal(true);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.DETAILS)).to.equal(false);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.EVIDENCE)).to.equal(false);
      expect(await f.consent.checkConsent(r.reportId, ROLE.OFFICE, SEC.ALL)).to.equal(false);
    });

    it("T20 rejects grants with an expiry in the past, role 0 or empty scope", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      const now = BigInt(await time.latest());
      const cases = [
        [ROLE.OFFICE, SEC.ALL, now - 1n, "BadExpiry"],
        [0, SEC.ALL, now + 100n, "BadRole"],
        [ROLE.OFFICE, 0, now + 100n, "BadScope"],
      ];
      for (const [role, scope, until, err] of cases) {
        await expect(
          f.consent.grantAccess(r.reportId, role, scope, until, 0, await f.s.grant(r.reporter, r.reportId, role, scope, until, 0))
        ).to.be.revertedWithCustomError(f.consent, err);
      }
    });

    it("T21 a registered staff member can request access; an unregistered address cannot", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f);
      await expect(f.consent.requestAccess(r.reportId, SEC.SUMMARY, 0, await f.s.request(f.office, r.reportId, SEC.SUMMARY, 0)))
        .to.emit(f.consent, "AccessRequested")
        .withArgs(r.reportId, ROLE.OFFICE, f.staffRef("office"), f.office.address, SEC.SUMMARY);
      await expect(f.consent.requestAccess(r.reportId, SEC.SUMMARY, 0, await f.s.request(f.outsider, r.reportId, SEC.SUMMARY, 0)))
        .to.be.revertedWithCustomError(f.consent, "NotInstitution");
    });

    it("T22 only the administrator's signature can register or deactivate staff", async function () {
      const f = await loadFixture(deploy);
      const ref = f.staffRef("x");
      const nonce = await f.consent.adminNonce();
      await expect(
        f.consent.registerInstitution(f.outsider.address, ROLE.LEGAL, ref, nonce,
          await f.s.registerInst(f.gateway, f.outsider.address, ROLE.LEGAL, ref, nonce))
      ).to.be.revertedWithCustomError(f.consent, "BadSignature");
      await expect(
        f.consent.deactivateInstitution(f.office.address, nonce, await f.s.deactivateInst(f.office, f.office.address, nonce))
      ).to.be.revertedWithCustomError(f.consent, "BadSignature");
      await expect(
        f.consent.deactivateInstitution(f.office.address, nonce, await f.s.deactivateInst(f.admin, f.office.address, nonce))
      ).to.emit(f.consent, "InstitutionDeactivated").withArgs(f.office.address);
      expect((await f.consent.institutionOf(f.office.address)).active).to.equal(false);
    });
  });

  // ------------------------------------------------------------------ audit
  describe("AuditTrail", function () {
    it("T23 'alert only': the office is denied until the reporter approves, then permitted", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: false });
      expect(await attempt(f, f.office, r.reportId, SEC.SUMMARY)).to.equal(false);
      await grant(f, r, ROLE.OFFICE, SEC.SUMMARY);
      expect(await attempt(f, f.office, r.reportId, SEC.SUMMARY)).to.equal(true);
    });

    it("T24 every attempt, permitted or denied, is logged with actor, staff reference and role", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      await attempt(f, f.office, r.reportId);
      await attempt(f, f.social, r.reportId);
      await attempt(f, f.outsider, r.reportId);
      const log = await f.audit.getAuditLog(r.reportId);
      expect(log.length).to.equal(3);
      expect([log[0].permitted, log[1].permitted, log[2].permitted]).to.deep.equal([true, false, false]);
      expect(log[0].actor).to.equal(f.office.address);
      expect(log[0].staffRef).to.equal(f.staffRef("office"));
      expect(log[1].role).to.equal(ROLE.SOCIAL);
      expect(log[2].role).to.equal(0);
    });

    it("T25 only the gateway can write, and a replayed access signature reverts", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      const sig = await f.s.access(f.office, r.reportId, SEC.ALL, 0);
      await expect(f.audit.connect(f.office).logAccess(r.reportId, SEC.ALL, 0, sig))
        .to.be.revertedWithCustomError(f.audit, "OnlyGateway");
      await f.audit.connect(f.gateway).logAccess(r.reportId, SEC.ALL, 0, sig);
      await expect(f.audit.connect(f.gateway).logAccess(r.reportId, SEC.ALL, 0, sig))
        .to.be.revertedWithCustomError(f.audit, "BadNonce");
    });

    it("T26 the gateway cannot impersonate staff: a gateway-signed attempt is denied as role 0", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      expect(await attempt(f, f.gateway, r.reportId)).to.equal(false);
      const log = await f.audit.getAuditLog(r.reportId);
      expect(log[0].actor).to.equal(f.gateway.address);
      expect(log[0].role).to.equal(0);
    });

    it("T27 after revoke the first request is denied", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      expect(await attempt(f, f.office, r.reportId)).to.equal(true);
      const nonce = await f.consent.nonceOf(r.reportId);
      await f.consent.revokeConsent(r.reportId, ROLE.OFFICE, nonce, await f.s.revoke(r.reporter, r.reportId, ROLE.OFFICE, nonce));
      expect(await attempt(f, f.office, r.reportId)).to.equal(false);
    });

    it("T28 a deactivated staff account is denied even with a valid grant", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      const n = await f.consent.adminNonce();
      await f.consent.deactivateInstitution(f.office.address, n, await f.s.deactivateInst(f.admin, f.office.address, n));
      expect(await attempt(f, f.office, r.reportId)).to.equal(false);
    });

    it("T29 after the report is withdrawn every access is denied and no new consent can be given", async function () {
      const f = await loadFixture(deploy);
      const r = await fileReport(f, { shareNow: true });
      await expect(f.registry.withdrawReport(r.reportId, 0, await f.s.withdrawReport(r.reporter, r.reportId, 0)))
        .to.emit(f.registry, "ReportWithdrawn");
      expect(await f.registry.isActive(r.reportId)).to.equal(false);
      expect(await attempt(f, f.office, r.reportId)).to.equal(false);
      const until = BigInt(await time.latest()) + BigInt(DAY);
      await expect(
        f.consent.grantAccess(r.reportId, ROLE.LEGAL, SEC.ALL, until, 1, await f.s.grant(r.reporter, r.reportId, ROLE.LEGAL, SEC.ALL, until, 1))
      ).to.be.revertedWithCustomError(f.consent, "ReportNotActive");
    });

    it("T30 no contract ABI exposes a function that edits or deletes a record", async function () {
      const f = await loadFixture(deploy);
      const forbidden = /^(update|edit|delete|remove|set|clear|reset|modify|overwrite|erase)/i;
      for (const c of [f.registry, f.consent, f.audit]) {
        const writes = c.interface.fragments
          .filter((fr) => fr.type === "function" && !["view", "pure"].includes(fr.stateMutability))
          .map((fr) => fr.name);
        for (const name of writes) expect(name).not.to.match(forbidden);
      }
      const auditWrites = f.audit.interface.fragments
        .filter((fr) => fr.type === "function" && !["view", "pure"].includes(fr.stateMutability))
        .map((fr) => fr.name);
      expect(auditWrites).to.deep.equal(["logAccess"]);
    });
  });

  // ------------------------------------------------------------------ the guide's Phase 8 scenario
  describe("Phase 8 scenario", function () {
    it("T31 runs the ten-step scenario in nine state-changing transactions", async function () {
      const f = await loadFixture(deploy);
      const start = await ethers.provider.getBlockNumber();

      const r = await fileReport(f, { shareNow: false });                           // 1 register, 2 create+alert
      const n0 = await f.consent.staffNonce(f.office.address);
      await f.consent.requestAccess(r.reportId, SEC.SUMMARY, n0,
        await f.s.request(f.office, r.reportId, SEC.SUMMARY, n0));                 // 3 request
      await grant(f, r, ROLE.OFFICE, SEC.SUMMARY, 30);                              // 4 approve 30 days
      expect(await attempt(f, f.office, r.reportId, SEC.SUMMARY)).to.equal(true);   // 5 permitted
      expect(await attempt(f, f.social, r.reportId, SEC.SUMMARY)).to.equal(false);  // 6 denied
      const n = await f.consent.nonceOf(r.reportId);
      await f.consent.revokeConsent(r.reportId, ROLE.OFFICE, n,
        await f.s.revoke(r.reporter, r.reportId, ROLE.OFFICE, n));                  // 7 revoke
      expect(await attempt(f, f.office, r.reportId, SEC.SUMMARY)).to.equal(false);  // 8 denied
      await f.registry.withdrawReport(r.reportId, 0,
        await f.s.withdrawReport(r.reporter, r.reportId, 0));                       // 9 withdraw

      const end = await ethers.provider.getBlockNumber();
      expect(end - start).to.equal(9); // automine: one block per transaction
      expect(await f.audit.auditCount(r.reportId)).to.equal(3);
    });
  });
});
