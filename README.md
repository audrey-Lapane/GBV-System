# GBV consent system

A blockchain-based consent management system for gender-based violence reporting, built from the *GBV Consent System:

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

