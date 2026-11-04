// npx hardhat run scripts/inspect-blocks.js --network localhost
//
// Prints every block on the local chain in a readable form: block number, timestamp,
// block hash, and for each transaction the hash, sender, recipient (named where it is
// one of our contracts), gas used, status, and the decoded contract event it carried.
//
// Optional range, passed through the environment so it works the same in PowerShell and bash:
//   FROM=4 TO=9 npx hardhat run scripts/inspect-blocks.js --network localhost
//   $env:FROM=4; $env:TO=9; npx hardhat run scripts/inspect-blocks.js --network localhost
//
// This script only reads. It sends no transactions and changes nothing on the chain.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const NAMES = ["ReportRegistry", "ConsentManagement", "AuditTrail"];

/** Human-readable UTC timestamp, so screenshots are unambiguous across machines. */
const stamp = (seconds) => new Date(seconds * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");

// These mirror backend/src/constants.js, which is the single source of truth shared
// with the contracts. Scope is a bit mask of sections, not an ordinal.
const ROLE = { 1: "GBV office (designated office)", 2: "Legal services", 3: "Campus health", 4: "Social worker" };
const SECTION = { 1: "summary", 2: "details", 4: "evidence" };
const CATEGORY = {
    1: "Sexual harassment",
    2: "Sexual assault",
    3: "Physical violence",
    4: "Emotional or psychological abuse",
    5: "Stalking",
    6: "Online abuse",
    7: "Other",
};
const DAY_SECONDS = 86400;

/** Scope is a bit mask: 7 = summary + details + evidence. */
const describeScope = (n) =>
    n === 0 ? "0 (nothing)" : `${n} (${[1, 2, 4].filter((b) => (n & b) === b).map((b) => SECTION[b]).join(" + ")})`;

function describeArg(name, value) {
    const n = Number(value);
    if (/^(role|officeRole)$/i.test(name)) return ROLE[n] ? `${n} (${ROLE[n]})` : String(n);
    if (/^scope$/i.test(name)) return describeScope(n);
    if (/^section$/i.test(name)) return SECTION[n] ? `${n} (${SECTION[n]})` : String(n);
    if (/^category$/i.test(name)) return CATEGORY[n] ? `${n} (${CATEGORY[n]})` : String(n);
    if (/^reportDay$/i.test(name)) return `${n} (${new Date(n * DAY_SECONDS * 1000).toISOString().slice(0, 10)})`;
    if (/^validUntil$/i.test(name)) return n === 0 ? "0 (no expiry)" : `${n} (${stamp(n)})`;
    return String(value);
}

async function main() {
    const file = path.join(__dirname, "..", "deployed-addresses.json");
    if (!fs.existsSync(file)) {
        throw new Error("deployed-addresses.json not found. Run `npm run deploy` first.");
    }
    const deployed = JSON.parse(fs.readFileSync(file, "utf8"));

    // Build a lookup of address -> contract name, and an interface per contract for decoding logs.
    const label = new Map();
    const interfaces = [];
    for (const name of NAMES) {
        const address = deployed[name];
        if (!address) continue;
        label.set(address.toLowerCase(), name);
        const { abi } = await hre.artifacts.readArtifact(name);
        interfaces.push({ name, iface: new hre.ethers.Interface(abi) });
    }
    label.set(String(deployed.admin).toLowerCase(), "administrator (account #0)");
    label.set(String(deployed.gateway).toLowerCase(), "gateway (account #1)");

    const provider = hre.ethers.provider;
    const latest = await provider.getBlockNumber();
    const from = Math.max(0, Number(process.env.FROM || 0));
    const to = Math.min(latest, Number(process.env.TO || latest));

    const network = await provider.getNetwork();
    console.log("");
    console.log(`Chain ID ${network.chainId}  —  blocks ${from} to ${to} of ${latest}`);
    console.log("=".repeat(96));

    let txTotal = 0;
    let eventTotal = 0;

    for (let height = from; height <= to; height++) {
        const block = await provider.getBlock(height);
        console.log("");
        console.log(`Block #${block.number}`);
        console.log(`  Timestamp   ${stamp(block.timestamp)}`);
        console.log(`  Block hash  ${block.hash}`);
        console.log(`  Parent hash ${block.parentHash}`);
        console.log(`  Transactions ${block.transactions.length}`);

        for (const hash of block.transactions) {
            txTotal++;
            const tx = await provider.getTransaction(hash);
            const receipt = await provider.getTransactionReceipt(hash);
            const target = tx.to ?
                `${tx.to}${label.has(tx.to.toLowerCase()) ? `  [${label.get(tx.to.toLowerCase())}]` : ""}`
        : `(contract deployment -> ${receipt.contractAddress})`;
      const sender = `${tx.from}${label.has(tx.from.toLowerCase()) ? `  [${label.get(tx.from.toLowerCase())}]` : ""}`;

      console.log("");
      console.log(`  Transaction ${tx.hash}`);
      console.log(`    From      ${sender}`);
      console.log(`    To        ${target}`);
      console.log(`    Gas used  ${receipt.gasUsed.toString()}`);
      console.log(`    Status    ${receipt.status === 1 ? "success" : "reverted"}`);

      for (const log of receipt.logs) {
        let decoded = null;
        let origin = label.get(log.address.toLowerCase()) ?? log.address;
        for (const { name, iface } of interfaces) {
          try {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            if (parsed) { decoded = parsed; origin = name; break; }
          } catch { /* log belongs to a different contract */ }
        }
        if (!decoded) continue;
        eventTotal++;
        console.log(`    Event     ${origin}.${decoded.name}`);
        decoded.fragment.inputs.forEach((input, i) => {
          console.log(`                ${input.name.padEnd(12)} ${describeArg(input.name, decoded.args[i])}`);
        });
      }
    }
  }

  console.log("");
  console.log("=".repeat(96));
  console.log(`${to - from + 1} blocks, ${txTotal} transactions, ${eventTotal} contract events.`);
  console.log("");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  });
}

module.exports = { describeArg, describeScope, stamp };