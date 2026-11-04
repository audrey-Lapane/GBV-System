# GBV consent system

A blockchain-based consent management system for gender-based violence reporting, built from the *GBV Consent System: Build Guide and Technology Chapters* (Parts A, E, F and G).

- `blockchain/` Solidity 0.8.24 contracts (ReportRegistry, ConsentManagement, AuditTrail), Hardhat tests, deploy script
- `backend/` Node.js and Express API with the nine modules, MySQL schema
- `frontend/` React (Vite) web app for reporters, staff and the administrator, installable as a PWA
- `evaluation/` the Phase 8 scenario script and the anonymiser evaluation

All data you put into this system while testing must be synthetic.

---

## 1. Install once

Node.js LTS (20 or 22), Git, MySQL Server 8 with Workbench, IPFS Desktop, and the MetaMask browser extension.

```bash
cd blockchain && npm install
cd ../backend && npm install
cd ../frontend && npm install
```

## 2. Start everything (four terminals)

**Terminal 1: the chain**

```bash
cd blockchain
npx hardhat node
```

Leave it running. It prints 20 test accounts. Account #0 is the contract administrator, account #1 is the backend gateway. These keys are public test keys: never use them anywhere else.

**Terminal 2: compile, test and deploy**

```bash
cd blockchain
npx hardhat compile
npx hardhat test          # 34 tests, including browser-signature parity
npm run deploy            # writes deployed-addresses.json and copies ABIs to backend/src/contracts
```

Restarting `npx hardhat node` wipes the chain, so run `npm run deploy` again each time, and reset the database (step 3) so it does not refer to reports that no longer exist.

**Database (once, and after every chain restart)**

```bash
mysql -u root -p < backend/db/schema.sql
```

This creates the `gbv_consent` database and a least-privilege user `gbv_app`. Change its password in the last lines of `schema.sql` before running it. To reset: `DROP DATABASE gbv_consent;` then run the file again.

**IPFS:** start IPFS Desktop and wait for "Connected to IPFS". The API must be on port 5001.

**Terminal 3: the API**

```bash
cd backend
cp .env.example .env      # Windows: copy .env.example .env
```

In `.env`, set `DB_PASSWORD` to the password from `schema.sql`, and generate `MASTER_KEY`, `STAFF_REF_KEY` and `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then create the administrator once, and start:

```bash
npm run create-admin -- --staff A0001 --name "Your Name" --email you@example.ac.za --password "a long password"
npm start
```

The start-up log lists the nine modules and confirms the chain, database and IPFS connections.

**Terminal 4: the web app**

```bash
cd frontend
npm run dev
```

Open http://localhost:5173. The dev server forwards `/api` to the backend, so the browser talks to one origin only.

## 3. MetaMask

1. Add a network: RPC `http://127.0.0.1:8545`, chain ID `31337`, currency ETH.
2. Import Hardhat account #0 (private key from terminal 1). This is the administrator. Sign in at `/staff/login` with the administrator account you created.
3. For each staff member, import another account (or create one). Staff do not need test ETH: they only sign messages, and the backend gateway submits and pays for the transaction.

## 4. Try the whole flow

1. **Reporter:** Make a report, choose "Alert only", keep the ID and secret.
2. **Staff:** at `/staff/register`, register a GBV office account and click "Use my MetaMask address".
3. **Administrator:** approve it in Administration, Approvals. MetaMask asks you (account #0) to sign.
4. **Office:** sign in, see the alert (ID, category, date only), open it, Request access. Try "Open report" first: it is refused and recorded.
5. **Reporter:** Open my report, Requests, Approve.
6. **Office:** Open report: the content shows with its integrity check.
7. **Reporter:** History shows every attempt with transaction references. Who can read it, Take back access. The office's next attempt is refused.
8. **Administrator:** Statistics, and Audit check (compares the database copy with the chain).

Or run the same scenario automatically (backend running, admin created with the default password, or set `ADMIN_STAFF` and `ADMIN_PASSWORD`):

```bash
cd evaluation
node scenario.mjs
node anonymiser-eval.mjs 200
```

Outputs are saved in `evaluation/results/`.

## 5. Demonstration build and phone install (Part E step 9, Part F)

```bash
cd frontend && npm run build
```

When `frontend/dist` exists, the backend serves it, so http://localhost:4000 runs the whole app on one origin. The build adds a Content Security Policy and a service worker that caches the app shell only (no API responses, reports, IDs or secrets).

On a phone, the Web Crypto API needs HTTPS: expose port 4000 with a tunnelling tool, open it on the phone, then "Add to Home Screen". The phone only needs the reporter pages; staff and admin pages need MetaMask on a desktop browser.

## 6. Evaluation commands (Part D)

| What | Command |
| --- | --- |
| Contract tests | `cd blockchain && npx hardhat test` |
| Coverage | `npm run coverage` |
| Gas per function | `npm run gas` |
| Static analysis | `pip install slither-analyzer solc-select && solc-select install 0.8.24 && solc-select use 0.8.24 && slither .` |
| **All Part D and G metrics** | `cd evaluation && node metrics.mjs` |
| End-to-end scenario | `node scenario.mjs` |
| Anonymiser precision and recall | `node anonymiser-eval.mjs 200` |
| Rate limiting (shipped defaults) | `node ratelimit.mjs` |
| Charts for the write-up | `python3 charts.py` |
| Mirror versus chain | `cd backend && npm run reconcile` |
| Accessibility and mobile | Chrome DevTools, Lighthouse, mobile mode |

`metrics.mjs` writes `evaluation/results/metrics-latest.json` and prints a summary table. `charts.py`
draws the figures from that file, so the charts cannot drift from the measurements.

**Before running `metrics.mjs`,** raise the rate limits in `backend/.env` so the harness can make its
hundreds of trials, and put them back afterwards:

```
RATE_LIMIT_SUBMITS_PER_HOUR=5000
RATE_LIMIT_PORTAL_PER_15MIN=100000
RATE_LIMIT_LOGIN_PER_15MIN=100000
RATE_LIMIT_API_PER_MIN=1000000
```

Run `ratelimit.mjs` only with those lines removed, so that result reflects what ships.

### Responsive design (measured)

Every page was measured at 320, 360, 390, 414, 600, 768, 1024 and 1440 px: no horizontal scrolling at any width, no text under 13 px, and every control at least 44 px tall on touch screens. One layout breakpoint at 820 px turns the two-column staff and admin views into one column; a second at 560 px turns the wide tables (access record, audit mismatches, lookup record) into labelled rows so nothing hides off the edge; the top-bar links collapse under 480 px, where the Leave now button stays visible.

---

## Settings chosen (record these in Chapter 4)

| Setting | Value | Where |
| --- | --- | --- |
| Staff session (JWT) lifetime | 30 minutes | `JWT_LIFETIME_MINUTES` |
| Lockout | after 5 failed logins, for 15 minutes | `MAX_FAILED_LOGINS`, `LOCKOUT_MINUTES` |
| Password hashing | bcrypt, cost 12 | `authentication` module |
| Reporter inactivity clear | 2 minutes | `frontend/src/context/Session.jsx` |
| Reporter secret | 30 characters, 150 bits, six groups of five | `frontend/src/crypto/secret.js` |
| Reporter key | HKDF-SHA256(secret, salt = report ID) | same file |
| Evidence | up to 5 files, 10 MB each; JPEG, PNG, WebP, PDF, MP3, WAV, M4A; type checked from file contents | `.env`, `reporting/evidence.js` |
| Image metadata | removed by re-encoding (EXIF, GPS, device) | `reporting/evidence.js` |
| Evidence storage | all files from one submission bundled into one encrypted item | same |
| Unsigned submissions kept | 15 minutes, then unpinned | `PENDING_SUBMISSION_MINUTES` |
| Reporter read proof validity | 5 minutes | `REPORTER_PROOF_MAX_AGE_SECONDS` |
| Grant durations offered | 7, 30, 90 days | `frontend/src/constants.js` |
| Quick exit | button on every page and the Esc key; replaces the page so Back does not return | `Session.jsx` |
| Optional random alert delay | not implemented | see below |

## Where this build differs from the guide, and why

Each of these strengthens or clarifies a claim in the dissertation. Mention them in Chapter 4.

1. **Staff and administrator actions are signed messages relayed by the gateway**, not transactions sent from MetaMask. The contract recovers the signer, so `AccessRequested` and `InstitutionRegistered` are still attributable to the staff member's or administrator's own address, and the backend still cannot produce them. Staff therefore need no test ETH.
2. **`AuditTrail.logAccess` decides the result itself.** It recovers the staff member from their wallet signature and calls `checkConsent`, so the backend can neither forge who accessed a report nor record a permission the chain did not give. The backend releases content only when the mined `AccessLogged` event says `permitted`.
3. **Every signed digest includes an action tag** (for example `GBV.GRANT`) as well as the contract address, chain ID, report ID and nonce, so a signature for one action cannot be replayed as another. Grants and requests also carry the scope mask.
4. **Submission has two steps.** The server encrypts and pins first, then the browser signs the exact CIDs and hashes it will register. The registration and the alert choice are both signed by the reporter's key.
5. **The reporter portal requires proof of the secret**: the browser signs a short-lived read request, and the server checks it against the reporter address stored on-chain.
6. **Denying a request is recorded off-chain** (no consent exists to remove, so there is no on-chain change).
7. **OpenZeppelin 5.6 needs the Cancun EVM target**, set in `hardhat.config.js`.
8. **The guide's Phase 8 scenario produces 9 transactions.** `scenario.mjs` adds two extra refused attempts (before approval, and for evidence outside the grant), so it reports 11.
9. **The optional random alert delay (Part G3) was not built.** List it as future work.

## What was checked while building, and what you still need to do

The build was tested in a cloud sandbox, not on your machine. The figures below show the code works; **Chapter 5 must use numbers from your own runs.**

Checked in the sandbox (full output in `evaluation/results/metrics-latest.json`):

| Metric | Result | Pass rule |
| --- | --- | --- |
| Decision accuracy | **100%** (100/100 trials) | reported |
| False-grant rate | **0%** | must be 0 |
| False-deny rate | **0%** | reported |
| Revocation effect | **20/20** denied on the first attempt | 20 of 20 |
| Expiry accuracy | permitted before, denied after | correct both sides |
| Forged or replayed consent changes accepted | **0 of 20** | must be 0 |
| Identity-leak count (9 canaries, 4 surfaces) | **0** | must be 0 |
| Identity fields in reporter tables | **0** | must be 0 |
| Integrity tamper detection | **20/20** rejected | 20 of 20 |
| Erasure | retrieval fails, 0 keys left, saved ciphertext undecryptable | all three |
| Audit completeness | **156 on-chain = 156 mirrored** | 100% |
| Audit tamper detection | edit detected, named the field and both values | detected every time |
| Contract tests | **34/34 pass**, 98.44% lines, 71.25% branches | all pass |
| Anonymiser | **99.1% precision, 68.7% recall** (200 records) | report honestly |
| Latency (mean / 95th) | submit 246/263 ms, grant 440/462 ms, open 118/128 ms | reported |
| Throughput | 0 errors at 10 and 50 concurrent reads | reported |
| Attack matrix | **8 of 8** as expected | each recorded |
| Rate limiting | limited from attempt 31 | rate-limited |
| Responsive design | no overflow at 320–1440px, 44px touch targets | reported |

Two results needed a second look, and both were faults in my test code rather than the system:
one "forged" grant was accepted because on the first iteration the one-time number had not yet
been spent, so that signature was legitimately valid; and the schema scan flagged `sync_state.name`,
which holds the checkpoint label `events`, not a person's name. Both are fixed and documented
in `metrics.mjs`.

Not checked in the sandbox, so do these yourself:

- **IPFS Desktop:** the sandbox used a stand-in for the Kubo RPC API. Confirm with a real submission
  and check the raw block is unreadable ciphertext (screenshot S22).
- **MySQL 8:** tested on MariaDB 10.11, which is compatible for this schema.
- **Real MetaMask:** signing was simulated in the same message format (`personal_sign` over the
  32-byte digest). Approve one account and open one report with real MetaMask.
- **Slither, Lighthouse and a real phone install** have not been run.

## Honest limits (for Chapter 6)

- The backend encrypts, so it sees plaintext at submission and holds the wrapped keys. The defensible claim is that it cannot grant, extend or revoke consent, forge an access record, or open a report without a passing on-chain check.
- The browser cannot verify that the CIDs and hashes the server returns match what was submitted, because the server does the encryption. Client-side encryption is the fix and is future work.
- A lost secret cannot be recovered. Content read before revocation cannot be taken back.
- The anonymiser misses names in ordinary sentences, and cannot anonymise faces, voices or documents.
- Hardhat Network has no real consensus; its timings and gas prices are not production figures.
