// Creates the administrator account (run once).
//   npm run create-admin -- --staff A0001 --name "Admin Name" --email admin@univen.ac.za --password "a long password"
// The administrator's MetaMask must hold Hardhat account #0, which the deploy script set as
// the contract administrator; registrations are signed with it.
import bcrypt from "bcrypt";
import { pool } from "../src/db.js";
import { deployed } from "../src/modules/blockchain/index.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith("--") ? [...acc, [v.slice(2), a[i + 1]]] : acc), [])
);
const { staff, name, email, password } = args;
if (!staff || !name || !email || !password || password.length < 10) {
  console.error('Usage: npm run create-admin -- --staff A0001 --name "Name" --email you@example.ac.za --password "at least 10 chars"');
  process.exit(1);
}
await pool.query(
  `INSERT INTO institutional_users (staff_number, name, work_email, role, status, password_hash, wallet_address)
   VALUES (?,?,?,'admin','approved',?,?)`,
  [staff.toUpperCase(), name, email, await bcrypt.hash(password, 12), deployed.admin]
);
console.log(`Administrator ${staff.toUpperCase()} created. Contract administrator address: ${deployed.admin}`);
await pool.end();
process.exit(0);
