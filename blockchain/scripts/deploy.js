// npx hardhat run scripts/deploy.js --network localhost
// Account #0 = administrator (import it into MetaMask). Account #1 = backend gateway/relayer.
// Writes deployed-addresses.json and copies the ABIs to backend/src/contracts.
// (The web app reads the public addresses from the backend's /api/config.)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [admin, gateway] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const registry = await hre.ethers.deployContract("ReportRegistry");
  await registry.waitForDeployment();
  const consent = await hre.ethers.deployContract("ConsentManagement", [await registry.getAddress(), admin.address]);
  await consent.waitForDeployment();
  const audit = await hre.ethers.deployContract("AuditTrail", [await consent.getAddress(), gateway.address]);
  await audit.waitForDeployment();

  const out = {
    network: hre.network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployBlock: await hre.ethers.provider.getBlockNumber(),
    admin: admin.address,
    gateway: gateway.address,
    ReportRegistry: await registry.getAddress(),
    ConsentManagement: await consent.getAddress(),
    AuditTrail: await audit.getAddress(),
  };

  const root = path.join(__dirname, "..", "..");
  const targets = [path.join(__dirname, ".."), path.join(root, "backend", "src", "contracts")];
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "deployed-addresses.json"), JSON.stringify(out, null, 2));
  }
  for (const name of ["ReportRegistry", "ConsentManagement", "AuditTrail"]) {
    const { abi } = await hre.artifacts.readArtifact(name);
    for (const dir of targets.slice(1)) {
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ abi }, null, 2));
    }
  }

  console.log("Network:          ", out.network, "chainId", chainId);
  console.log("Administrator:    ", out.admin);
  console.log("Gateway (backend):", out.gateway);
  console.log("ReportRegistry:   ", out.ReportRegistry);
  console.log("ConsentManagement:", out.ConsentManagement);
  console.log("AuditTrail:       ", out.AuditTrail);
  console.log("Wrote deployed-addresses.json and ABIs to backend/src/contracts");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
